"""
Filesystem-backed training job store for inference-adapter (PR-7).

Same deviation rationale as go-livepeer PR-6: design §3.D specified
Redis; filesystem JSON checkpoint gives equivalent recovery semantics
for the single-instance adapter without a new container dependency.

Behavior:
- TrainingJobStore wraps a dict + a checkpoint directory.
- Periodic background task snapshots all active jobs every 5s.
- On startup (sweep), reads existing checkpoints; in-flight jobs
  (submitted/running) are marked `failed_adapter_restart` with an
  explanatory error.
- Terminal jobs (completed/failed/cancelled) are loaded as-is until
  their TTL expires.

Trade-offs vs Redis: single-instance only; <5s window of progress
loss on crash. Acceptable for adapter (orch-owned recovery via PR-6
covers the cross-component case).
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import tempfile
from typing import Any, Callable, Dict, Optional

logger = logging.getLogger(__name__)


class TrainingJobStore:
    """Dict-like store with optional filesystem-backed persistence."""

    def __init__(
        self,
        checkpoint_dir: Optional[str] = None,
        *,
        ttl_seconds: int = 24 * 3600,
        snapshot_interval: float = 5.0,
        job_to_dict: Optional[Callable[[Any], dict]] = None,
        dict_to_job: Optional[Callable[[dict], Any]] = None,
    ) -> None:
        """
        Args:
            checkpoint_dir: if set, persistence is active. If None,
                store is in-memory only (backward compat).
            ttl_seconds: how long to keep terminal jobs around.
            snapshot_interval: how often the background snapshot loop
                runs (seconds).
            job_to_dict / dict_to_job: serialization callbacks. Tests
                inject these; production uses TrainingJob.to_dict() and
                a reverse constructor.
        """
        self._jobs: Dict[str, Any] = {}
        self._checkpoint_dir = checkpoint_dir
        self._ttl_seconds = ttl_seconds
        self._snapshot_interval = snapshot_interval
        self._job_to_dict = job_to_dict
        self._dict_to_job = dict_to_job
        self._snapshot_task: Optional[asyncio.Task] = None

        if checkpoint_dir:
            os.makedirs(checkpoint_dir, exist_ok=True)

    # ------------------------------------------------------------------
    # Dict-like access for backward compat with `self._training_jobs[...]`
    # ------------------------------------------------------------------
    def __setitem__(self, job_id: str, job: Any) -> None:
        """Synchronous insertion (memory only). For checkpoint write,
        callers in async paths SHOULD prefer `await aset(job_id, job)`
        which offloads fs I/O to a thread. The synchronous path here
        still works but blocks the event loop for fs latency."""
        self._jobs[job_id] = job
        # Eager persist on insertion (most important moment to checkpoint)
        self._persist_one(job_id, job)

    async def aset(self, job_id: str, job: Any) -> None:
        """Async insertion — same as __setitem__ but offloads fs write
        to a worker thread so the event loop isn't blocked by disk
        latency. Use this from aiohttp handlers under load.

        Reviewer Q4 fix (PR-7): `__setitem__` does synchronous fs I/O,
        which on slow disks stalls all concurrent requests on the
        adapter. `aset` does the same logical insert but the fs write
        is dispatched to `asyncio.to_thread`.
        """
        self._jobs[job_id] = job
        if self._checkpoint_dir and self._job_to_dict:
            await asyncio.to_thread(self._persist_one, job_id, job)

    def __getitem__(self, job_id: str) -> Any:
        return self._jobs[job_id]

    def __contains__(self, job_id: str) -> bool:
        return job_id in self._jobs

    def get(self, job_id: str, default: Any = None) -> Any:
        return self._jobs.get(job_id, default)

    def values(self):
        return self._jobs.values()

    def items(self):
        return self._jobs.items()

    def __iter__(self):
        return iter(self._jobs)

    def __len__(self) -> int:
        return len(self._jobs)

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------
    def _persist_one(self, job_id: str, job: Any) -> None:
        if not self._checkpoint_dir or not self._job_to_dict:
            return
        try:
            data = json.dumps(self._job_to_dict(job))
            path = os.path.join(self._checkpoint_dir, f"{job_id}.json")
            # atomic write: tmp file in same dir + rename
            fd, tmp = tempfile.mkstemp(
                prefix=f"{job_id}.", suffix=".json.tmp",
                dir=self._checkpoint_dir,
            )
            try:
                with os.fdopen(fd, "w") as f:
                    f.write(data)
                os.replace(tmp, path)
            except Exception:
                # If anything fails between mkstemp and replace, clean up
                try:
                    os.unlink(tmp)
                except OSError:
                    pass
                raise
        except Exception as e:
            logger.warning("training-store: checkpoint write %s failed: %s", job_id, e)

    def _remove_one(self, job_id: str) -> None:
        if not self._checkpoint_dir:
            return
        try:
            os.unlink(os.path.join(self._checkpoint_dir, f"{job_id}.json"))
        except FileNotFoundError:
            pass
        except OSError as e:
            logger.warning("training-store: checkpoint remove %s failed: %s", job_id, e)

    def sweep_on_startup(self) -> int:
        """Load existing checkpoints. Returns count of in-flight jobs
        marked as failed_adapter_restart."""
        if not self._checkpoint_dir or not self._dict_to_job:
            return 0
        try:
            entries = os.listdir(self._checkpoint_dir)
        except FileNotFoundError:
            return 0
        marked_failed = 0
        for name in entries:
            if not name.endswith(".json"):
                continue
            path = os.path.join(self._checkpoint_dir, name)
            try:
                with open(path) as f:
                    data = json.load(f)
            except (OSError, json.JSONDecodeError) as e:
                logger.warning("training-store: skip corrupt %s: %s", name, e)
                continue
            try:
                job = self._dict_to_job(data)
            except Exception as e:
                logger.warning("training-store: skip unparseable %s: %s", name, e)
                continue
            # Mark in-flight as failed_adapter_restart
            current_status = getattr(job, "status", data.get("status", ""))
            if current_status in ("submitted", "running"):
                job.status = "failed_adapter_restart"
                job.error = "Adapter restarted while job was in-flight"
                import time
                job.updated_at = time.time()
                marked_failed += 1
                self._persist_one(getattr(job, "job_id", data.get("job_id", "")), job)
            jid = getattr(job, "job_id", data.get("job_id"))
            if jid:
                self._jobs[jid] = job
        if self._jobs:
            logger.info(
                "training-store: swept %d jobs from %s (marked %d as failed_adapter_restart)",
                len(self._jobs), self._checkpoint_dir, marked_failed,
            )
        return marked_failed

    # ------------------------------------------------------------------
    # Background snapshot loop (catches attribute mutations on jobs
    # already in the store without callsite changes)
    # ------------------------------------------------------------------
    async def start_snapshot_loop(self) -> None:
        if not self._checkpoint_dir:
            return
        if self._snapshot_task and not self._snapshot_task.done():
            return
        self._snapshot_task = asyncio.create_task(self._snapshot_loop())

    async def stop_snapshot_loop(self) -> None:
        if self._snapshot_task and not self._snapshot_task.done():
            self._snapshot_task.cancel()
            try:
                await self._snapshot_task
            except asyncio.CancelledError:
                pass

    async def _snapshot_loop(self) -> None:
        import time
        try:
            while True:
                await asyncio.sleep(self._snapshot_interval)
                now = time.time()
                to_remove = []
                for jid, job in list(self._jobs.items()):
                    self._persist_one(jid, job)
                    # TTL cleanup for terminal jobs
                    status = getattr(job, "status", "")
                    updated_at = getattr(job, "updated_at", now)
                    if status in (
                        "completed", "failed", "cancelled",
                        "failed_adapter_restart",
                    ):
                        if now - updated_at > self._ttl_seconds:
                            to_remove.append(jid)
                for jid in to_remove:
                    self._jobs.pop(jid, None)
                    self._remove_one(jid)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.exception("training-store: snapshot loop error: %s", e)
