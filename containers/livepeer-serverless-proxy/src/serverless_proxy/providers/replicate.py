"""Replicate inference provider."""

from __future__ import annotations

import asyncio
import logging

import aiohttp

from .base import InferenceProvider

logger = logging.getLogger(__name__)

_POLL_INTERVAL = 1
_POLL_TIMEOUT = 120


class ReplicateProvider(InferenceProvider):
    """Provider that forwards inference requests to the Replicate HTTP API."""

    def __init__(self, api_key: str, model_id: str) -> None:
        self._api_key = api_key
        self._model_id = model_id

    @property
    def _auth_headers(self) -> dict:
        return {"Authorization": f"Bearer {self._api_key}"}

    async def health(self) -> bool:
        """Check connectivity to the Replicate API."""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    "https://api.replicate.com/v1/predictions",
                    headers=self._auth_headers,
                    timeout=aiohttp.ClientTimeout(total=5),
                ) as resp:
                    return resp.status < 500
        except Exception:
            return False

    async def inference(self, request_body: dict, session: aiohttp.ClientSession) -> dict:
        """Create a prediction on Replicate and poll until it completes.

        Submits the request and then polls the prediction status endpoint
        every second until the prediction reaches a terminal state or the
        timeout is exceeded.
        """
        url = "https://api.replicate.com/v1/predictions"
        payload = {"model": self._model_id, "input": request_body}
        headers = {**self._auth_headers, "Content-Type": "application/json"}

        async with session.post(url, json=payload, headers=headers) as resp:
            prediction = await resp.json()
            if resp.status >= 400:
                return {"error": f"Replicate returned {resp.status}", "detail": prediction}

        prediction_url = prediction.get("urls", {}).get("get", f"{url}/{prediction['id']}")

        elapsed = 0
        while elapsed < _POLL_TIMEOUT:
            await asyncio.sleep(_POLL_INTERVAL)
            elapsed += _POLL_INTERVAL

            async with session.get(prediction_url, headers=self._auth_headers) as resp:
                result = await resp.json()

            status = result.get("status")
            if status == "succeeded":
                return result
            if status in ("failed", "canceled"):
                return {"error": f"Prediction {status}", "detail": result}

        return {"error": "Prediction timed out", "detail": result}
