"""HTTP server -- routes health and inference requests to the configured provider."""

from __future__ import annotations

import json
import logging
from typing import Optional

from aiohttp import web, ClientSession

from .config import ProxyConfig
from .providers.base import InferenceProvider
from .providers.fal_ai import FalAiProvider
from .providers.replicate import ReplicateProvider
from .providers.runpod import RunPodProvider
from .providers.custom import CustomProvider
from .providers.gemini import GeminiProvider

logger = logging.getLogger(__name__)


def create_provider(config: ProxyConfig) -> InferenceProvider:
    """Instantiate the appropriate provider based on configuration.

    For serverless providers (fal-ai, replicate, runpod), model_id is
    optional at init time -- it can be passed per-request for multi-model.
    """
    if config.provider == "fal-ai":
        return FalAiProvider(api_key=config.api_key, model_id=config.model_id)
    if config.provider == "replicate":
        return ReplicateProvider(api_key=config.api_key, model_id=config.model_id)
    if config.provider == "runpod":
        return RunPodProvider(api_key=config.api_key, model_id=config.model_id)
    if config.provider == "gemini":
        return GeminiProvider(api_key=config.api_key, model_id=config.model_id)
    if config.provider == "custom":
        return CustomProvider(endpoint_url=config.endpoint_url)
    raise ValueError(f"Unknown provider: {config.provider}")


def create_extra_providers(config: ProxyConfig) -> dict[str, InferenceProvider]:
    """Create additional providers from EXTRA_PROVIDERS env var (JSON).

    Format: {"gemini": {"api_key": "..."}, "fal-ai": {"api_key": "..."}}
    """
    import os
    extra = {}
    extra_json = os.environ.get("EXTRA_PROVIDERS")
    if extra_json:
        import json as _json
        for name, cfg in _json.loads(extra_json).items():
            if name == "gemini":
                extra[name] = GeminiProvider(api_key=cfg["api_key"])
            elif name == "fal-ai":
                extra[name] = FalAiProvider(api_key=cfg["api_key"])
            elif name == "replicate":
                extra[name] = ReplicateProvider(api_key=cfg["api_key"])
    return extra


class ProxyServer:
    """HTTP server that translates inference requests into provider API calls."""

    def __init__(self, config: ProxyConfig, provider: InferenceProvider,
                 session: Optional[ClientSession] = None,
                 extra_providers: Optional[dict[str, InferenceProvider]] = None) -> None:
        self._config = config
        self._provider = provider
        self._extra_providers = extra_providers or {}
        self._session = session
        self._owns_session = session is None
        self._app = web.Application()
        self._app.router.add_get("/health", self._handle_health)
        self._app.router.add_post("/inference", self._handle_inference)
        self._app.router.add_post("/inference/{model_path:.+}", self._handle_inference)
        self._runner: Optional[web.AppRunner] = None

    @property
    def app(self) -> web.Application:
        return self._app

    @property
    def provider(self) -> InferenceProvider:
        return self._provider

    async def _get_session(self) -> ClientSession:
        if self._session is None or self._session.closed:
            self._session = ClientSession()
            self._owns_session = True
        return self._session

    async def _handle_health(self, request: web.Request) -> web.Response:
        """Health endpoint -- returns provider name and status."""
        return web.json_response({"status": "ok", "provider": self._config.provider})

    async def _handle_inference(self, request: web.Request) -> web.Response:
        """Inference endpoint -- forwards request to the configured provider.

        Model resolution precedence:
          1. URL path: /inference/fal-ai/flux/dev
          2. Request body: {"model_id": "fal-ai/flux/dev", ...}
          3. Config default: MODEL_ID env var
        """
        try:
            body = await request.json()
        except (json.JSONDecodeError, Exception):
            return web.json_response(
                {"error": "Invalid JSON in request body"}, status=400
            )

        # Resolve model_id: URL path > body field > config default
        model_path = request.match_info.get("model_path")
        model_id = model_path or body.pop("model_id", None) or self._config.model_id

        session = await self._get_session()

        # Route to the right provider based on model_id prefix
        provider = self._provider
        if model_id:
            for prefix, prov in self._extra_providers.items():
                if model_id.startswith(f"{prefix}/"):
                    provider = prov
                    # Strip the provider prefix from model_id
                    model_id = model_id[len(prefix) + 1:]
                    break

        try:
            result = await provider.inference(body, session, model_id=model_id)
            return web.json_response(result)
        except Exception as e:
            logger.error("Provider inference failed (model=%s): %s", model_id, e)
            return web.json_response(
                {"error": "Provider request failed", "detail": str(e)},
                status=502,
            )

    async def start(self) -> None:
        """Start the HTTP server."""
        self._runner = web.AppRunner(self._app)
        await self._runner.setup()
        site = web.TCPSite(self._runner, "0.0.0.0", self._config.port)
        await site.start()
        logger.info("Proxy server listening on 0.0.0.0:%d", self._config.port)

    async def stop(self) -> None:
        """Stop the HTTP server and clean up."""
        if self._runner:
            await self._runner.cleanup()
        if self._owns_session and self._session and not self._session.closed:
            await self._session.close()
