"""Tests for the proxy server module."""

import pytest
from aiohttp import web
from aiohttp.test_utils import AioHTTPTestCase, TestServer
from aioresponses import aioresponses

from livepeer_adapter.config import AdapterConfig
from livepeer_adapter.proxy import ProxyServer


def make_config(**overrides) -> AdapterConfig:
    defaults = dict(
        orch_url="http://localhost:7935",
        orch_secret="test-secret",
        capability_name="test-model",
        backend_url="http://localhost:8080",
        backend_inference_path="/v1/chat/completions",
    )
    defaults.update(overrides)
    return AdapterConfig(**defaults)


class TestProxyServer:
    """Tests for ProxyServer endpoints."""

    @pytest.fixture
    def config(self):
        return make_config()

    @pytest.fixture
    def proxy(self, config):
        return ProxyServer(config)

    async def test_health_returns_200_when_healthy(self, aiohttp_client, proxy):
        proxy.backend_healthy = True
        client = await aiohttp_client(proxy.app)

        resp = await client.get("/health")
        assert resp.status == 200
        data = await resp.json()
        assert data["status"] == "healthy"
        assert data["capability"] == "test-model"

    async def test_health_returns_503_when_unhealthy(self, aiohttp_client, proxy):
        proxy.backend_healthy = False
        client = await aiohttp_client(proxy.app)

        resp = await client.get("/health")
        assert resp.status == 503
        data = await resp.json()
        assert data["status"] == "unhealthy"

    async def test_inference_forwards_to_backend(self, aiohttp_client, proxy):
        proxy.backend_healthy = True
        client = await aiohttp_client(proxy.app)

        with aioresponses() as m:
            m.post(
                "http://localhost:8080/v1/chat/completions",
                status=200,
                payload={"choices": [{"message": {"content": "Hello!"}}]},
                headers={"Content-Type": "application/json"},
            )

            resp = await client.post(
                "/inference",
                json={"messages": [{"role": "user", "content": "Hi"}]},
            )

            assert resp.status == 200
            data = await resp.json()
            assert data["choices"][0]["message"]["content"] == "Hello!"

    async def test_inference_with_subpath(self, aiohttp_client, proxy):
        proxy.backend_healthy = True
        client = await aiohttp_client(proxy.app)

        with aioresponses() as m:
            m.post(
                "http://localhost:8080/v1/chat/completions/extra",
                status=200,
                payload={"result": "ok"},
                headers={"Content-Type": "application/json"},
            )

            resp = await client.post("/inference/extra", json={"prompt": "test"})
            assert resp.status == 200

    async def test_inference_returns_502_on_backend_error(self, aiohttp_client, proxy):
        proxy.backend_healthy = True
        client = await aiohttp_client(proxy.app)

        with aioresponses() as m:
            m.post(
                "http://localhost:8080/v1/chat/completions",
                exception=ConnectionError("refused"),
            )

            resp = await client.post("/inference", json={"prompt": "test"})
            assert resp.status == 502
            data = await resp.json()
            assert "Backend request failed" in data["error"]

    async def test_inference_forwards_content_type(self, aiohttp_client, proxy):
        proxy.backend_healthy = True
        client = await aiohttp_client(proxy.app)

        with aioresponses() as m:
            m.post(
                "http://localhost:8080/v1/chat/completions",
                status=200,
                body=b"image data",
                headers={"Content-Type": "image/png"},
            )

            resp = await client.post("/inference", json={"prompt": "generate image"})
            assert resp.status == 200
            assert "image/png" in resp.content_type

    async def test_inference_streams_sse(self, aiohttp_client):
        """Test that SSE responses are streamed through."""
        config = make_config()
        proxy = ProxyServer(config)
        proxy.backend_healthy = True
        client = await aiohttp_client(proxy.app)

        sse_data = b"data: {\"token\": \"Hello\"}\n\ndata: {\"token\": \" world\"}\n\ndata: [DONE]\n\n"

        with aioresponses() as m:
            m.post(
                "http://localhost:8080/v1/chat/completions",
                status=200,
                body=sse_data,
                headers={"Content-Type": "text/event-stream"},
            )

            resp = await client.post(
                "/inference",
                json={"messages": [{"role": "user", "content": "Hi"}]},
                headers={"Accept": "text/event-stream"},
            )

            assert resp.status == 200
            assert "text/event-stream" in resp.content_type
            body = await resp.read()
            assert b"Hello" in body
            assert b"world" in body
