"""
Unit tests for adapter's filesystem-backed TrainingJobStore (PR-7).

Mirrors the orch-side training_store_test.go (PR-6) shape:
- backward-compat in-memory mode
- atomic disk write on insertion
- sweep marks in-flight jobs as failed_adapter_restart
- corrupt JSON files skipped
"""
from __future__ import annotations

import asyncio
import json
import os
import time

import pytest

from livepeer_adapter.training_store import TrainingJobStore


# -- Helper job class for tests (mimics TrainingJob's interface) -----


class _FakeJob:
    def __init__(self, job_id: str, status: str = "submitted", **kw):
        self.job_id = job_id
        self.status = status
        self.error = kw.get("error")
        self.result = kw.get("result")
        self.progress = kw.get("progress", 0)
        self.updated_at = kw.get("updated_at", time.time())
        self.capability = kw.get("capability", "test-cap")
        self.model_id = kw.get("model_id", "test-model")

    def to_dict(self):
        return {
            "job_id": self.job_id, "status": self.status,
            "error": self.error, "result": self.result,
            "progress": self.progress, "updated_at": self.updated_at,
            "capability": self.capability, "model_id": self.model_id,
        }

    @classmethod
    def from_dict(cls, d):
        return cls(**{k: v for k, v in d.items() if k in (
            "job_id", "status", "error", "result", "progress",
            "updated_at", "capability", "model_id",
        )})


# -- Tests ------------------------------------------------------------


def test_inmemory_mode_no_persistence_dir():
    """Backward-compat: no checkpoint_dir = pure in-memory dict."""
    store = TrainingJobStore(checkpoint_dir=None)
    job = _FakeJob("j-1", status="submitted")
    store["j-1"] = job
    assert store["j-1"] is job
    assert "j-1" in store
    assert len(store) == 1
    assert list(store.values()) == [job]


def test_disk_write_on_insert(tmp_path):
    """Setting [job_id] = job writes JSON to checkpoint dir."""
    store = TrainingJobStore(
        checkpoint_dir=str(tmp_path),
        job_to_dict=lambda j: j.to_dict(),
        dict_to_job=_FakeJob.from_dict,
    )
    job = _FakeJob("j-disk", status="running", progress=42)
    store["j-disk"] = job
    path = tmp_path / "j-disk.json"
    assert path.exists()
    data = json.loads(path.read_text())
    assert data["job_id"] == "j-disk"
    assert data["status"] == "running"
    assert data["progress"] == 42


def test_sweep_marks_inflight_as_failed(tmp_path):
    """Pre-existing in-flight checkpoint → marked failed_adapter_restart."""
    # Seed disk with a "running" job
    inflight = {
        "job_id": "running-job",
        "status": "running",
        "progress": 50,
        "capability": "flux-lora-training",
        "model_id": "flux-dev",
        "updated_at": time.time() - 60,
    }
    (tmp_path / "running-job.json").write_text(json.dumps(inflight))

    # And a terminal job
    done = {
        "job_id": "done-job",
        "status": "completed",
        "progress": 100,
        "updated_at": time.time() - 60,
    }
    (tmp_path / "done-job.json").write_text(json.dumps(done))

    store = TrainingJobStore(
        checkpoint_dir=str(tmp_path),
        job_to_dict=lambda j: j.to_dict(),
        dict_to_job=_FakeJob.from_dict,
    )
    marked = store.sweep_on_startup()

    assert marked == 1, f"expected 1 marked, got {marked}"
    assert store["running-job"].status == "failed_adapter_restart"
    assert store["running-job"].error == "Adapter restarted while job was in-flight"
    assert store["done-job"].status == "completed"

    # The checkpoint on disk for the in-flight job is rewritten
    rewrite = json.loads((tmp_path / "running-job.json").read_text())
    assert rewrite["status"] == "failed_adapter_restart"


def test_sweep_skips_corrupt_json(tmp_path):
    """Corrupt JSON file logged + skipped, no exception raised."""
    (tmp_path / "bad.json").write_text("not-valid-json{{{")
    good = {"job_id": "ok", "status": "completed", "updated_at": time.time()}
    (tmp_path / "ok.json").write_text(json.dumps(good))

    store = TrainingJobStore(
        checkpoint_dir=str(tmp_path),
        job_to_dict=lambda j: j.to_dict(),
        dict_to_job=_FakeJob.from_dict,
    )
    store.sweep_on_startup()  # must not raise
    assert "ok" in store
    assert "bad" not in store


def test_sweep_no_checkpoint_dir_is_noop(tmp_path):
    """No checkpoint_dir → sweep is a no-op, returns 0."""
    store = TrainingJobStore(checkpoint_dir=None)
    assert store.sweep_on_startup() == 0


@pytest.mark.asyncio
async def test_snapshot_loop_persists_attribute_mutations(tmp_path):
    """
    The proxy mutates `job.status = "running"` directly. Snapshot loop
    needs to pick those up between Store() calls. This test puts a job in,
    mutates it without re-Store, and verifies the disk reflects after one
    snapshot tick.
    """
    store = TrainingJobStore(
        checkpoint_dir=str(tmp_path),
        snapshot_interval=0.05,  # fast for the test
        job_to_dict=lambda j: j.to_dict(),
        dict_to_job=_FakeJob.from_dict,
    )
    job = _FakeJob("j-mut", status="submitted")
    store["j-mut"] = job
    # Initial state on disk
    initial = json.loads((tmp_path / "j-mut.json").read_text())
    assert initial["status"] == "submitted"

    # Mutate without re-storing
    job.status = "running"
    job.progress = 33

    await store.start_snapshot_loop()
    await asyncio.sleep(0.15)  # 3 snapshot ticks
    await store.stop_snapshot_loop()

    after = json.loads((tmp_path / "j-mut.json").read_text())
    assert after["status"] == "running"
    assert after["progress"] == 33


def test_atomic_write_no_leftover_tmp(tmp_path):
    """Insertions don't leave .tmp files behind on success."""
    store = TrainingJobStore(
        checkpoint_dir=str(tmp_path),
        job_to_dict=lambda j: j.to_dict(),
        dict_to_job=_FakeJob.from_dict,
    )
    for i in range(5):
        store[f"j-{i}"] = _FakeJob(f"j-{i}", status="submitted")

    tmp_files = list(tmp_path.glob("*.tmp"))
    assert tmp_files == [], f"tmp files leaked: {tmp_files}"
    json_files = sorted(p.name for p in tmp_path.glob("*.json"))
    assert json_files == [f"j-{i}.json" for i in range(5)]
