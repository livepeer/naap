"""RunPod inference provider."""

from __future__ import annotations

import asyncio
import logging

import aiohttp

from .base import InferenceProvider

logger = logging.getLogger(__name__)

_POLL_INTERVAL = 1
_POLL_TIMEOUT = 120


class RunPodProvider(InferenceProvider):
    """Provider that forwards inference requests to the RunPod serverless API."""

    def __init__(self, api_key: str, model_id: str) -> None:
        self._api_key = api_key
        self._model_id = model_id

    @property
    def _auth_headers(self) -> dict:
        return {"Authorization": f"Bearer {self._api_key}"}

    async def health(self) -> bool:
        """Check health of the RunPod endpoint."""
        try:
            async with aiohttp.ClientSession() as session:
                url = f"https://api.runpod.ai/v2/{self._model_id}/health"
                async with session.get(
                    url,
                    headers=self._auth_headers,
                    timeout=aiohttp.ClientTimeout(total=5),
                ) as resp:
                    return resp.status < 500
        except Exception:
            return False

    async def inference(self, request_body: dict, session: aiohttp.ClientSession) -> dict:
        """Submit a job to RunPod and poll until it completes.

        Submits the job via the /run endpoint, then polls the /status
        endpoint every second until the job reaches COMPLETED or a
        terminal error state, or the timeout is exceeded.
        """
        run_url = f"https://api.runpod.ai/v2/{self._model_id}/run"
        payload = {"input": request_body}
        headers = {**self._auth_headers, "Content-Type": "application/json"}

        async with session.post(run_url, json=payload, headers=headers) as resp:
            job = await resp.json()
            if resp.status >= 400:
                return {"error": f"RunPod returned {resp.status}", "detail": job}

        job_id = job.get("id")
        status_url = f"https://api.runpod.ai/v2/{self._model_id}/status/{job_id}"

        elapsed = 0
        result = job
        while elapsed < _POLL_TIMEOUT:
            await asyncio.sleep(_POLL_INTERVAL)
            elapsed += _POLL_INTERVAL

            async with session.get(status_url, headers=self._auth_headers) as resp:
                result = await resp.json()

            status = result.get("status")
            if status == "COMPLETED":
                return result
            if status in ("FAILED", "CANCELLED"):
                return {"error": f"RunPod job {status}", "detail": result}

        return {"error": "RunPod job timed out", "detail": result}
