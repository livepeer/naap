"""Proxy server -- receives requests from the orchestrator and forwards them to the inference backend."""

from __future__ import annotations

import logging
from typing import Optional

from aiohttp import web, ClientSession, ClientTimeout

from .config import AdapterConfig

logger = logging.getLogger(__name__)


class ProxyServer:
    """HTTP server that proxies inference requests to the backend."""

    def __init__(self, config: AdapterConfig, session: Optional[ClientSession] = None) -> None:
        self._config = config
        self._session = session
        self._owns_session = session is None
        self._app = web.Application()
        self._app.router.add_get("/health", self._handle_health)
        self._app.router.add_post("/inference", self._handle_inference)
        self._app.router.add_post("/inference/{path:.*}", self._handle_inference)
        self._runner: Optional[web.AppRunner] = None
        self._backend_healthy = False

    @property
    def app(self) -> web.Application:
        return self._app

    @property
    def backend_healthy(self) -> bool:
        return self._backend_healthy

    @backend_healthy.setter
    def backend_healthy(self, value: bool) -> None:
        self._backend_healthy = value

    async def _get_session(self) -> ClientSession:
        if self._session is None or self._session.closed:
            self._session = ClientSession()
            self._owns_session = True
        return self._session

    async def _handle_health(self, request: web.Request) -> web.Response:
        """Health endpoint -- returns 200 if backend is healthy, 503 otherwise."""
        if self._backend_healthy:
            return web.json_response({"status": "healthy", "capability": self._config.capability_name})
        return web.json_response({"status": "unhealthy"}, status=503)

    async def _handle_inference(self, request: web.Request) -> web.StreamResponse:
        """Forward inference request to backend, streaming SSE if applicable."""
        session = await self._get_session()

        # Build backend URL
        extra_path = request.match_info.get("path", "")
        if extra_path:
            backend_url = f"{self._config.backend_url}{self._config.backend_inference_path}/{extra_path}"
        else:
            backend_url = f"{self._config.backend_url}{self._config.backend_inference_path}"

        # Read request body
        body = await request.read()

        # Forward headers (Content-Type, Accept, etc.) but not Livepeer-specific ones
        forward_headers = {}
        for header in ("Content-Type", "Accept", "Authorization"):
            if header in request.headers:
                forward_headers[header] = request.headers[header]

        timeout = ClientTimeout(total=self._config.backend_timeout)

        try:
            async with session.post(backend_url, data=body, headers=forward_headers, timeout=timeout) as resp:
                content_type = resp.headers.get("Content-Type", "")

                # SSE streaming response
                if "text/event-stream" in content_type:
                    response = web.StreamResponse(
                        status=resp.status,
                        headers={"Content-Type": "text/event-stream", "Cache-Control": "no-cache"},
                    )
                    await response.prepare(request)

                    async for chunk in resp.content.iter_any():
                        await response.write(chunk)

                    await response.write_eof()
                    return response

                # Regular response
                response_body = await resp.read()
                return web.Response(
                    body=response_body,
                    status=resp.status,
                    content_type=content_type or "application/json",
                )

        except Exception as e:
            logger.error("Backend request failed: %s", e)
            return web.json_response(
                {"error": "Backend request failed", "detail": str(e)},
                status=502,
            )

    async def start(self) -> None:
        """Start the HTTP server."""
        self._runner = web.AppRunner(self._app)
        await self._runner.setup()
        site = web.TCPSite(self._runner, self._config.adapter_host, self._config.adapter_port)
        await site.start()
        logger.info("Proxy server listening on %s:%d", self._config.adapter_host, self._config.adapter_port)

    async def stop(self) -> None:
        """Stop the HTTP server and clean up."""
        if self._runner:
            await self._runner.cleanup()
        if self._owns_session and self._session and not self._session.closed:
            await self._session.close()
