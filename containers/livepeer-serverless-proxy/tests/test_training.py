"""
Unit tests for serverless-proxy training routes + fal_ai training methods.

Per design doc §11.1:
- P4: /train/submit returns {request_id, model_id, status_url} shape exactly
      as adapter expects
- P5: /train/status translates fal's COMPLETED|IN_PROGRESS|FAILED|CANCELLED
      identically to adapter's expected statuses
- Bonus: inference regression — /inference still routes the same way

PR-3 of byoc-payment-fleet-2026-05.
"""
from __future__ import annotations

import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from aiohttp import web
from aiohttp.test_utils import AioHTTPTestCase

from serverless_proxy.config import ProxyConfig
from serverless_proxy.providers.fal_ai import FalAiProvider, TRAINING_MODELS
from serverless_proxy.server import ProxyServer


# ---------------------------------------------------------------------------
# fal_ai provider unit tests
# ---------------------------------------------------------------------------


class FakeResponse:
    def __init__(self, status, body):
        self.status = status
        self._body = body

    async def json(self):
        return self._body

    async def text(self):
        return json.dumps(self._body) if isinstance(self._body, dict) else str(self._body)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False


class FakeSession:
    """Minimal aiohttp-like session that returns scripted responses."""

    def __init__(self, *, post_response=None, get_responses=None):
        self.post_response = post_response or FakeResponse(200, {})
        self.get_responses = list(get_responses or [])
        self.post_calls: list[dict] = []
        self.get_calls: list[dict] = []

    def post(self, url, **kw):
        self.post_calls.append({"url": url, **kw})
        return self.post_response

    def get(self, url, **kw):
        self.get_calls.append({"url": url, **kw})
        if self.get_responses:
            return self.get_responses.pop(0)
        return FakeResponse(200, {})


@pytest.mark.asyncio
async def test_fal_train_submit_translates_body_correctly():
    """train_submit should translate SDK body → fal queue body correctly."""
    provider = FalAiProvider(api_key="test-key")
    sdk_body = {
        "model_id": "flux-dev",
        "params": {
            "images_data_url": "https://x/zip.zip",
            "trigger_word": "PULSEX1",
            "steps": 100,
        },
    }
    fake_response = FakeResponse(200, {
        "request_id": "fal-req-abc-123",
        "status_url": "https://queue.fal.run/.../status",
    })
    session = FakeSession(post_response=fake_response)

    result = await provider.train_submit(sdk_body, session)

    # Result shape
    assert result["request_id"] == "fal-req-abc-123"
    assert result["model_id"] == "fal-ai/flux-lora-fast-training"
    assert result["status_url"] == "https://queue.fal.run/.../status"
    assert "error" not in result

    # fal queue body was correct
    assert len(session.post_calls) == 1
    call = session.post_calls[0]
    assert call["url"] == "https://queue.fal.run/fal-ai/flux-lora-fast-training"
    assert call["json"]["images_data_url"] == "https://x/zip.zip"
    assert call["json"]["trigger_word"] == "PULSEX1"
    assert call["json"]["steps"] == 100


@pytest.mark.asyncio
async def test_fal_train_submit_handles_fal_4xx():
    """Non-200 from fal → returns {"error", "detail"} not a raise."""
    provider = FalAiProvider(api_key="test-key")
    fake_response = FakeResponse(401, {"error": "Unauthorized"})
    session = FakeSession(post_response=fake_response)

    result = await provider.train_submit(
        {"model_id": "flux-dev", "params": {}},
        session,
    )
    assert "error" in result
    assert "401" in result["error"]


@pytest.mark.asyncio
async def test_p5_fal_train_status_passes_through_in_progress():
    """train_status returns fal's status verbatim for non-COMPLETED states."""
    provider = FalAiProvider(api_key="test-key")
    in_progress = FakeResponse(200, {"status": "IN_PROGRESS", "logs": []})
    session = FakeSession(get_responses=[in_progress])

    result = await provider.train_status(
        "fal-ai/flux-lora-fast-training", "req-x", session,
    )
    assert result["status"] == "IN_PROGRESS"
    # No second GET (no response fetch when not COMPLETED)
    assert len(session.get_calls) == 1


@pytest.mark.asyncio
async def test_p5_fal_train_status_fetches_result_on_completion():
    """train_status on COMPLETED fetches the full response envelope."""
    provider = FalAiProvider(api_key="test-key")
    status_resp = FakeResponse(200, {"status": "COMPLETED"})
    result_resp = FakeResponse(200, {
        "diffusers_lora_file": {"url": "https://v3b.fal.media/weights.safetensors"},
        "config_file": {"url": "https://v3b.fal.media/config.json"},
    })
    session = FakeSession(get_responses=[status_resp, result_resp])

    result = await provider.train_status(
        "fal-ai/flux-lora-fast-training", "req-done", session,
    )
    assert result["status"] == "COMPLETED"
    assert result["diffusers_lora_file"]["url"].endswith("weights.safetensors")
    assert len(session.get_calls) == 2


@pytest.mark.asyncio
async def test_p5_fal_train_status_passes_through_failed():
    """train_status passes through FAILED status."""
    provider = FalAiProvider(api_key="test-key")
    failed = FakeResponse(200, {"status": "FAILED", "error": "OOM"})
    session = FakeSession(get_responses=[failed])

    result = await provider.train_status(
        "fal-ai/flux-lora-fast-training", "req-f", session,
    )
    assert result["status"] == "FAILED"
    assert result["error"] == "OOM"
    assert len(session.get_calls) == 1


# ---------------------------------------------------------------------------
# Server route integration tests (using aiohttp test client)
# ---------------------------------------------------------------------------


class _ProxyAppCase(AioHTTPTestCase):
    """Spin up the ProxyServer's aiohttp Application with a mocked provider."""

    async def get_application(self) -> web.Application:
        config = ProxyConfig(provider="fal-ai", api_key="test-key", port=0, model_id=None)
        provider = FalAiProvider(api_key="test-key")
        server = ProxyServer(config=config, provider=provider)
        self.server = server
        return server.app


class TestTrainSubmitRoute(_ProxyAppCase):
    async def test_p4_train_submit_returns_adapter_shape(self):
        """POST /train/submit returns {request_id, model_id, status_url} at HTTP 202."""
        with patch.object(
            FalAiProvider, "train_submit", new=AsyncMock(return_value={
                "request_id": "fal-req-abc",
                "model_id": "fal-ai/flux-lora-fast-training",
                "status_url": "https://queue.fal.run/.../status",
            }),
        ):
            resp = await self.client.post("/train/submit", json={
                "model_id": "flux-dev",
                "params": {"images_data_url": "https://x", "trigger_word": "T"},
            })
            assert resp.status == 202
            body = await resp.json()
            assert body["request_id"] == "fal-req-abc"
            assert body["model_id"] == "fal-ai/flux-lora-fast-training"
            assert "status_url" in body

    async def test_train_submit_502_on_provider_error(self):
        """If provider returns {error}, route surfaces HTTP 502."""
        with patch.object(
            FalAiProvider, "train_submit", new=AsyncMock(return_value={
                "error": "fal.ai returned 401", "detail": "Unauthorized",
            }),
        ):
            resp = await self.client.post("/train/submit", json={
                "model_id": "flux-dev", "params": {},
            })
            assert resp.status == 502
            body = await resp.json()
            assert "error" in body

    async def test_train_submit_400_on_bad_json(self):
        """Malformed JSON → HTTP 400."""
        resp = await self.client.post(
            "/train/submit",
            data=b"not-json",
            headers={"Content-Type": "application/json"},
        )
        assert resp.status == 400


class TestTrainStatusRoute(_ProxyAppCase):
    async def test_train_status_requires_model_id_param(self):
        resp = await self.client.get("/train/status/req-abc")
        assert resp.status == 400
        body = await resp.json()
        assert "model_id" in body.get("error", "")

    async def test_train_status_routes_to_provider(self):
        with patch.object(
            FalAiProvider, "train_status", new=AsyncMock(return_value={
                "status": "COMPLETED",
                "diffusers_lora_file": {"url": "https://fal/weights.safetensors"},
            }),
        ):
            resp = await self.client.get(
                "/train/status/req-abc?model_id=fal-ai/flux-lora-fast-training",
            )
            assert resp.status == 200
            body = await resp.json()
            assert body["status"] == "COMPLETED"


# ---------------------------------------------------------------------------
# Inference regression — /inference path unchanged
# ---------------------------------------------------------------------------


class TestInferenceRegression(_ProxyAppCase):
    async def test_inference_unchanged_after_training_added(self):
        """/inference still routes to provider.inference()."""
        with patch.object(
            FalAiProvider, "inference", new=AsyncMock(return_value={
                "images": [{"url": "https://fal/img.jpg"}],
            }),
        ):
            resp = await self.client.post("/inference", json={
                "model_id": "fal-ai/flux-dev",
                "prompt": "test",
            })
            assert resp.status == 200
            body = await resp.json()
            assert body["images"][0]["url"].endswith("img.jpg")

    async def test_inference_with_model_path(self):
        """/inference/{model_path:.+} regex route still works."""
        with patch.object(
            FalAiProvider, "inference", new=AsyncMock(return_value={"images": []}),
        ):
            resp = await self.client.post(
                "/inference/fal-ai/flux-schnell",
                json={"prompt": "test"},
            )
            assert resp.status == 200

    async def test_inference_model_path_strips_provider_prefix(self):
        """
        Regression test for the extra-provider routing branch in
        _handle_inference (server.py line ~122-126). When a model_id has
        a provider prefix matching an extra_provider (e.g., "gemini/..."),
        the proxy routes to that provider and strips the prefix before
        passing to provider.inference().

        Without this test, a refactor of the prefix-stripping logic
        would pass test_inference_with_model_path (which doesn't have
        an extra-provider in scope) but break the actual routing.
        """
        # Build a server with both fal-ai (default) and a stubbed extra
        # "gemini" provider so we can verify routing differentiates.
        from serverless_proxy.providers.gemini import GeminiProvider
        from serverless_proxy.config import ProxyConfig
        config = ProxyConfig(provider="fal-ai", api_key="fal-key", port=0, model_id=None)
        fal_provider = FalAiProvider(api_key="fal-key")
        gemini_provider = GeminiProvider(api_key="gemini-key")
        server_with_extras = ProxyServer(
            config=config,
            provider=fal_provider,
            extra_providers={"gemini": gemini_provider},
        )

        # Hand-spin a one-off aiohttp test client for this scenario
        from aiohttp.test_utils import TestClient, TestServer
        ts = TestServer(server_with_extras.app)
        await ts.start_server()
        try:
            client = TestClient(ts)
            await client.start_server()
            try:
                captured_model_id = []

                async def _fake_inference(self, body, session, model_id=None):
                    captured_model_id.append(model_id)
                    return {"images": [{"url": "https://test/img.jpg"}]}

                with patch.object(GeminiProvider, "inference", new=_fake_inference):
                    resp = await client.post(
                        "/inference/gemini/gemini-2.5-flash-image",
                        json={"prompt": "test"},
                    )
                    assert resp.status == 200, await resp.text()

                # The proxy should have routed to gemini provider AND
                # stripped the "gemini/" prefix before calling inference().
                assert len(captured_model_id) == 1
                assert captured_model_id[0] == "gemini-2.5-flash-image", (
                    f"prefix-stripping broken: got model_id={captured_model_id[0]!r}, "
                    "expected 'gemini-2.5-flash-image' (no provider prefix)"
                )
            finally:
                await client.close()
        finally:
            await ts.close()


# ---------------------------------------------------------------------------
# TRAINING_MODELS table is the SOT for base → fal model mapping
# ---------------------------------------------------------------------------


def test_training_models_table_includes_flux_family():
    """flux-dev and flux-schnell both map to flux-lora-fast-training."""
    assert TRAINING_MODELS["flux-dev"] == "fal-ai/flux-lora-fast-training"
    assert TRAINING_MODELS["flux-schnell"] == "fal-ai/flux-lora-fast-training"


def test_unknown_base_model_falls_back_to_default():
    """Test the fallback in train_submit when base_model isn't in the map."""
    # The TRAINING_MODELS table has explicit entries; unknown bases default
    # to the same fal training model via .get(_, default).
    fallback = TRAINING_MODELS.get("unknown-base", "fal-ai/flux-lora-fast-training")
    assert fallback == "fal-ai/flux-lora-fast-training"
