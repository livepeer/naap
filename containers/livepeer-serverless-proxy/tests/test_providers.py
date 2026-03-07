"""Tests for inference providers."""

import pytest
import aiohttp
from aioresponses import aioresponses

from serverless_proxy.providers.fal_ai import FalAiProvider
from serverless_proxy.providers.replicate import ReplicateProvider
from serverless_proxy.providers.runpod import RunPodProvider
from serverless_proxy.providers.custom import CustomProvider


class TestFalAiProvider:
    """Tests for FalAiProvider."""

    @pytest.fixture
    def provider(self):
        return FalAiProvider(api_key="test-key", model_id="test/model")

    async def test_inference_sends_correct_headers_and_url(self, provider):
        with aioresponses() as m:
            m.post(
                "https://queue.fal.run/test/model",
                status=200,
                payload={"result": "ok"},
            )

            async with aiohttp.ClientSession() as session:
                result = await provider.inference({"prompt": "hello"}, session)

            assert result == {"result": "ok"}

            # Verify the request was made with correct headers
            call = m.requests[("POST", "https://queue.fal.run/test/model")]
            request_kwargs = call[0].kwargs
            assert request_kwargs["headers"]["Authorization"] == "Key test-key"
            assert request_kwargs["headers"]["Content-Type"] == "application/json"

    async def test_health_returns_true_on_200(self, provider):
        with aioresponses() as m:
            m.get("https://fal.run", status=200)
            assert await provider.health() is True

    async def test_returns_error_dict_on_non_200(self, provider):
        with aioresponses() as m:
            m.post(
                "https://queue.fal.run/test/model",
                status=500,
                body="Internal Server Error",
            )

            async with aiohttp.ClientSession() as session:
                result = await provider.inference({"prompt": "hello"}, session)

            assert "error" in result
            assert "500" in result["error"]


class TestReplicateProvider:
    """Tests for ReplicateProvider."""

    @pytest.fixture
    def provider(self):
        return ReplicateProvider(api_key="test-key", model_id="owner/model:version")

    async def test_inference_creates_prediction(self, provider):
        with aioresponses() as m:
            # Initial prediction creation
            m.post(
                "https://api.replicate.com/v1/predictions",
                status=201,
                payload={
                    "id": "pred-123",
                    "status": "starting",
                    "urls": {"get": "https://api.replicate.com/v1/predictions/pred-123"},
                },
            )
            # Poll returns completed
            m.get(
                "https://api.replicate.com/v1/predictions/pred-123",
                status=200,
                payload={"id": "pred-123", "status": "succeeded", "output": "result"},
            )

            async with aiohttp.ClientSession() as session:
                result = await provider.inference({"prompt": "hello"}, session)

            assert result["status"] == "succeeded"
            assert result["output"] == "result"


class TestRunPodProvider:
    """Tests for RunPodProvider."""

    @pytest.fixture
    def provider(self):
        return RunPodProvider(api_key="test-key", model_id="endpoint-id")

    async def test_inference_submits_job(self, provider):
        with aioresponses() as m:
            # Job submission
            m.post(
                "https://api.runpod.ai/v2/endpoint-id/run",
                status=200,
                payload={"id": "job-123", "status": "IN_QUEUE"},
            )
            # Poll returns completed
            m.get(
                "https://api.runpod.ai/v2/endpoint-id/status/job-123",
                status=200,
                payload={"id": "job-123", "status": "COMPLETED", "output": {"text": "done"}},
            )

            async with aiohttp.ClientSession() as session:
                result = await provider.inference({"prompt": "hello"}, session)

            assert result["status"] == "COMPLETED"
            assert result["output"] == {"text": "done"}


class TestCustomProvider:
    """Tests for CustomProvider."""

    @pytest.fixture
    def provider(self):
        return CustomProvider(endpoint_url="http://my-endpoint.local/predict")

    async def test_inference_forwards_to_endpoint(self, provider):
        with aioresponses() as m:
            m.post(
                "http://my-endpoint.local/predict",
                status=200,
                payload={"output": "result"},
            )

            async with aiohttp.ClientSession() as session:
                result = await provider.inference({"input": "data"}, session)

            assert result == {"output": "result"}

    async def test_health_returns_true_on_200(self, provider):
        with aioresponses() as m:
            m.get("http://my-endpoint.local/predict", status=200)
            assert await provider.health() is True

    async def test_health_returns_false_on_connection_error(self, provider):
        with aioresponses() as m:
            m.get("http://my-endpoint.local/predict", exception=ConnectionError("refused"))
            assert await provider.health() is False


class TestFalAiHealthFailure:
    """Test that provider health returns False on connection error."""

    async def test_health_returns_false_on_error(self):
        provider = FalAiProvider(api_key="key", model_id="model")
        with aioresponses() as m:
            m.get("https://fal.run", exception=ConnectionError("refused"))
            assert await provider.health() is False
