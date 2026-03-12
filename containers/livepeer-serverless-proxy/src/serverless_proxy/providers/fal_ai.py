"""fal.ai inference provider."""

from __future__ import annotations

import asyncio
import logging
from typing import Optional

import aiohttp

from .base import InferenceProvider

logger = logging.getLogger(__name__)

_POLL_INTERVAL = 2
_POLL_TIMEOUT = 300


class FalAiProvider(InferenceProvider):
    """Provider that forwards inference requests to the fal.ai REST API.

    Supports both single-model mode (model_id set at init) and multi-model
    mode (model_id passed per-request).
    """

    def __init__(self, api_key: str, model_id: Optional[str] = None) -> None:
        self._api_key = api_key
        self._default_model_id = model_id

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

    def _resolve_model(self, model_id: Optional[str]) -> str:
        """Resolve model ID from per-request override or default."""
        resolved = model_id or self._default_model_id
        if not resolved:
            raise ValueError("No model_id provided and no default configured")
        return resolved

    async def inference(self, request_body: dict, session: aiohttp.ClientSession,
                        model_id: Optional[str] = None) -> dict:
        """Send an inference request to fal.ai.

        Uses the synchronous fal.run endpoint first. If the provider returns
        a queue response (IN_QUEUE), polls until completion.
        """
        mid = self._resolve_model(model_id)
        url = f"https://fal.run/{mid}"
        headers = {
            "Authorization": f"Key {self._api_key}",
            "Content-Type": "application/json",
        }

        logger.info("fal.ai inference: model=%s", mid)

        async with session.post(url, json=request_body, headers=headers) as resp:
            body = await resp.text()
            if resp.status == 200:
                import json
                return json.loads(body)

            # Some models return 422 but still include results in body
            if resp.status == 422:
                try:
                    import json
                    result = json.loads(body)
                    # If it has output keys, it's actually a success
                    if any(k in result for k in ("images", "video", "output", "text")):
                        return result
                except Exception:
                    pass

            logger.error("fal.ai returned %d: %s", resp.status, body[:200])

        # Fallback: try queue API with polling
        return await self._queue_inference(mid, request_body, session)

    async def _queue_inference(self, model_id: str, request_body: dict,
                               session: aiohttp.ClientSession) -> dict:
        """Submit via queue API and poll for completion."""
        queue_url = f"https://queue.fal.run/{model_id}"
        headers = {
            "Authorization": f"Key {self._api_key}",
            "Content-Type": "application/json",
        }

        async with session.post(queue_url, json=request_body, headers=headers) as resp:
            if resp.status not in (200, 201):
                body = await resp.text()
                return {"error": f"fal.ai queue returned {resp.status}", "detail": body}
            queue_resp = await resp.json()

        request_id = queue_resp.get("request_id")
        if not request_id:
            return queue_resp

        status_url = queue_resp.get("status_url",
                                    f"https://queue.fal.run/{model_id}/requests/{request_id}/status")
        response_url = queue_resp.get("response_url",
                                      f"https://queue.fal.run/{model_id}/requests/{request_id}")

        logger.info("fal.ai queued: request_id=%s", request_id)

        elapsed = 0
        while elapsed < _POLL_TIMEOUT:
            await asyncio.sleep(_POLL_INTERVAL)
            elapsed += _POLL_INTERVAL

            async with session.get(status_url, headers=headers) as resp:
                status_resp = await resp.json()

            status = status_resp.get("status")
            if status == "COMPLETED":
                async with session.get(response_url, headers=headers) as resp:
                    return await resp.json()
            if status in ("FAILED",):
                return {"error": "fal.ai job failed", "detail": status_resp}

            logger.debug("fal.ai polling: status=%s elapsed=%ds", status, elapsed)

        return {"error": "fal.ai job timed out", "detail": status_resp}
