"""Tests for the proxy server module."""

from unittest.mock import AsyncMock

import pytest
from aiohttp import web

from serverless_proxy.config import ProxyConfig
from serverless_proxy.server import ProxyServer, create_provider
from serverless_proxy.providers.base import InferenceProvider
from serverless_proxy.providers.fal_ai import FalAiProvider
from serverless_proxy.providers.replicate import ReplicateProvider
from serverless_proxy.providers.runpod import RunPodProvider
from serverless_proxy.providers.custom import CustomProvider


def make_config(**overrides) -> ProxyConfig:
    defaults = dict(provider="fal-ai", api_key="test-key", model_id="test-model")
    defaults.update(overrides)
    return ProxyConfig(**defaults)


class MockProvider(InferenceProvider):
    """Test provider that returns canned responses."""

    def __init__(self, inference_result=None, should_raise=False):
        self._inference_result = inference_result or {"output": "mock-result"}
        self._should_raise = should_raise

    async def health(self) -> bool:
        return True

    async def inference(self, request_body, session):
        if self._should_raise:
            raise ConnectionError("provider unreachable")
        return self._inference_result


class TestProxyServer:
    """Tests for ProxyServer endpoints."""

    @pytest.fixture
    def config(self):
        return make_config()

    @pytest.fixture
    def mock_provider(self):
        return MockProvider()

    @pytest.fixture
    def server(self, config, mock_provider):
        return ProxyServer(config, provider=mock_provider)

    async def test_health_returns_200(self, aiohttp_client, server):
        client = await aiohttp_client(server.app)
        resp = await client.get("/health")

        assert resp.status == 200
        data = await resp.json()
        assert data["status"] == "ok"

    async def test_inference_forwards_to_provider(self, aiohttp_client, server):
        client = await aiohttp_client(server.app)
        resp = await client.post("/inference", json={"prompt": "hello"})

        assert resp.status == 200
        data = await resp.json()
        assert data["output"] == "mock-result"

    async def test_inference_returns_502_on_provider_error(self, aiohttp_client, config):
        error_provider = MockProvider(should_raise=True)
        server = ProxyServer(config, provider=error_provider)
        client = await aiohttp_client(server.app)

        resp = await client.post("/inference", json={"prompt": "hello"})

        assert resp.status == 502
        data = await resp.json()
        assert "Provider request failed" in data["error"]

    async def test_health_includes_provider_name(self, aiohttp_client, server):
        client = await aiohttp_client(server.app)
        resp = await client.get("/health")

        data = await resp.json()
        assert data["provider"] == "fal-ai"

    async def test_invalid_json_returns_400(self, aiohttp_client, server):
        client = await aiohttp_client(server.app)
        resp = await client.post(
            "/inference",
            data=b"not json",
            headers={"Content-Type": "application/json"},
        )

        assert resp.status == 400
        data = await resp.json()
        assert "Invalid JSON" in data["error"]

    def test_create_provider_returns_correct_type(self):
        assert isinstance(
            create_provider(make_config(provider="fal-ai")), FalAiProvider
        )
        assert isinstance(
            create_provider(make_config(provider="replicate")), ReplicateProvider
        )
        assert isinstance(
            create_provider(make_config(provider="runpod")), RunPodProvider
        )
        assert isinstance(
            create_provider(
                make_config(provider="custom", endpoint_url="http://localhost:5000")
            ),
            CustomProvider,
        )
