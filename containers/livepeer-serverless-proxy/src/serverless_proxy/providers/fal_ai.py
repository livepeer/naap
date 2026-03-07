"""fal.ai inference provider."""

from __future__ import annotations

import logging

import aiohttp

from .base import InferenceProvider

logger = logging.getLogger(__name__)


class FalAiProvider(InferenceProvider):
    """Provider that forwards inference requests to the fal.ai REST API."""

    def __init__(self, api_key: str, model_id: str) -> None:
        self._api_key = api_key
        self._model_id = model_id

    async def health(self) -> bool:
        """Check connectivity to fal.ai."""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    "https://fal.run",
                    timeout=aiohttp.ClientTimeout(total=5),
                ) as resp:
                    return resp.status == 200
        except Exception:
            return False

    async def inference(self, request_body: dict, session: aiohttp.ClientSession) -> dict:
        """Send an inference request to the fal.ai queue API.

        Posts the request body as-is to the fal endpoint and returns the
        response JSON.
        """
        url = f"https://queue.fal.run/{self._model_id}"
        headers = {
            "Authorization": f"Key {self._api_key}",
            "Content-Type": "application/json",
        }

        async with session.post(url, json=request_body, headers=headers) as resp:
            if resp.status != 200:
                body = await resp.text()
                logger.error("fal.ai returned %d: %s", resp.status, body)
                return {"error": f"fal.ai returned {resp.status}", "detail": body}
            return await resp.json()
