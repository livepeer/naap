"""Custom HTTP endpoint inference provider."""

from __future__ import annotations

import logging

import aiohttp

from .base import InferenceProvider

logger = logging.getLogger(__name__)


class CustomProvider(InferenceProvider):
    """Provider that forwards inference requests to an arbitrary HTTP endpoint."""

    def __init__(self, endpoint_url: str) -> None:
        self._endpoint_url = endpoint_url

    async def health(self) -> bool:
        """Check connectivity to the custom endpoint."""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    self._endpoint_url,
                    timeout=aiohttp.ClientTimeout(total=5),
                ) as resp:
                    return resp.status == 200
        except Exception:
            return False

    async def inference(self, request_body: dict, session: aiohttp.ClientSession,
                        model_id: str | None = None) -> dict:
        """Forward the request body to the custom endpoint as-is.

        Simple passthrough -- posts JSON to the configured URL and returns
        the response JSON.
        """
        headers = {"Content-Type": "application/json"}

        async with session.post(
            self._endpoint_url, json=request_body, headers=headers
        ) as resp:
            return await resp.json()
