"""RunPod inference and training provider."""

from __future__ import annotations

import asyncio
import logging
from typing import Optional

import aiohttp

from .base import InferenceProvider

logger = logging.getLogger(__name__)

_POLL_INTERVAL = 1
_POLL_TIMEOUT = 120
_TRAIN_POLL_INTERVAL = 5
_TRAIN_POLL_TIMEOUT = 28800  # 8 hours


class RunPodProvider(InferenceProvider):
    """Provider that forwards inference and training requests to the RunPod serverless API."""

    def __init__(self, api_key: str, model_id: Optional[str] = None) -> None:
        self._api_key = api_key
        self._default_model_id = model_id or ""

    @property
    def _auth_headers(self) -> dict:
        return {"Authorization": f"Bearer {self._api_key}"}

    def _endpoint_id(self, request_body: dict, model_id: Optional[str] = None) -> str:
        """Extract endpoint_id from model_id override, request, or default."""
        return model_id or request_body.pop("endpoint_id", None) or self._default_model_id

    async def health(self) -> bool:
        """Check health of the RunPod endpoint."""
        try:
            async with aiohttp.ClientSession() as session:
                url = f"https://api.runpod.ai/v2/{self._default_model_id}/health"
                async with session.get(
                    url,
                    headers=self._auth_headers,
                    timeout=aiohttp.ClientTimeout(total=5),
                ) as resp:
                    return resp.status < 500
        except Exception:
            return False

    async def inference(self, request_body: dict, session: aiohttp.ClientSession,
                        model_id: Optional[str] = None) -> dict:
        """Submit a job to RunPod and poll until it completes."""
        endpoint_id = self._endpoint_id(request_body, model_id)
        run_url = f"https://api.runpod.ai/v2/{endpoint_id}/run"
        payload = {"input": request_body}
        headers = {**self._auth_headers, "Content-Type": "application/json"}

        async with session.post(run_url, json=payload, headers=headers) as resp:
            job = await resp.json()
            if resp.status >= 400:
                return {"error": f"RunPod returned {resp.status}", "detail": job}

        job_id = job.get("id")
        status_url = f"https://api.runpod.ai/v2/{endpoint_id}/status/{job_id}"

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
            if status in ("FAILED", "CANCELLED", "TIMED_OUT"):
                return {"error": f"RunPod job {status}", "detail": result}

        return {"error": "RunPod job timed out", "detail": result}

    async def train(self, request_body: dict, session: aiohttp.ClientSession) -> dict:
        """Submit a training job and poll until completion (synchronous)."""
        endpoint_id = request_body.pop("model_id", None) or self._default_model_id
        poll_timeout = request_body.pop("poll_timeout", _TRAIN_POLL_TIMEOUT)

        run_url = f"https://api.runpod.ai/v2/{endpoint_id}/run"
        payload = {"input": request_body}
        headers = {**self._auth_headers, "Content-Type": "application/json"}

        logger.info("Submitting RunPod training job to %s", run_url)
        async with session.post(run_url, json=payload, headers=headers) as resp:
            if resp.status >= 400:
                body = await resp.text()
                return {"error": f"RunPod returned {resp.status}", "detail": body}
            job = await resp.json()

        job_id = job.get("id")
        if not job_id:
            return {"error": "RunPod did not return a job id", "detail": job}

        logger.info("RunPod training job submitted: id=%s", job_id)
        status_url = f"https://api.runpod.ai/v2/{endpoint_id}/status/{job_id}"

        elapsed = 0
        result = job
        while elapsed < poll_timeout:
            await asyncio.sleep(_TRAIN_POLL_INTERVAL)
            elapsed += _TRAIN_POLL_INTERVAL

            try:
                async with session.get(status_url, headers=self._auth_headers) as resp:
                    result = await resp.json()
            except Exception as e:
                logger.warning("RunPod status poll failed (elapsed=%ds): %s", elapsed, e)
                continue

            status = result.get("status", "UNKNOWN")
            logger.info("RunPod training status: %s (elapsed=%ds)", status, elapsed)

            if status == "COMPLETED":
                output = result.get("output", {})
                if isinstance(output, dict):
                    output["_training_meta"] = {
                        "request_id": job_id,
                        "model_id": endpoint_id,
                        "elapsed_seconds": elapsed,
                        "execution_time": result.get("executionTime"),
                    }
                    return output
                return result

            if status in ("FAILED", "CANCELLED", "TIMED_OUT"):
                return {"error": f"RunPod training {status}", "detail": result,
                        "request_id": job_id, "model_id": endpoint_id}

        return {"error": "RunPod training timed out",
                "detail": {"last_status": result.get("status"), "elapsed": elapsed},
                "request_id": job_id, "model_id": endpoint_id}

    async def train_submit(self, request_body: dict, session: aiohttp.ClientSession) -> dict:
        """Submit a training job without polling -- returns immediately."""
        endpoint_id = request_body.pop("model_id", None) or self._default_model_id
        run_url = f"https://api.runpod.ai/v2/{endpoint_id}/run"
        payload = {"input": request_body}
        headers = {**self._auth_headers, "Content-Type": "application/json"}

        logger.info("Submitting RunPod async training to %s", run_url)
        async with session.post(run_url, json=payload, headers=headers) as resp:
            if resp.status >= 400:
                body = await resp.text()
                return {"error": f"RunPod returned {resp.status}", "detail": body}
            result = await resp.json()

        return {
            "request_id": result.get("id"),
            "status": result.get("status", "IN_QUEUE"),
            "model_id": endpoint_id,
        }

    async def train_status(self, request_id: str, model_id: str,
                           session: aiohttp.ClientSession) -> dict:
        """Check RunPod training job status."""
        endpoint_id = model_id or self._default_model_id
        status_url = f"https://api.runpod.ai/v2/{endpoint_id}/status/{request_id}"

        async with session.get(status_url, headers=self._auth_headers) as resp:
            data = await resp.json()

        status = data.get("status", "UNKNOWN")

        # Map RunPod statuses to normalized statuses
        status_map = {
            "IN_QUEUE": "IN_QUEUE",
            "IN_PROGRESS": "IN_PROGRESS",
            "COMPLETED": "COMPLETED",
            "FAILED": "FAILED",
            "TIMED_OUT": "FAILED",
            "CANCELLED": "CANCELLED",
        }
        data["status"] = status_map.get(status, status)

        if data["status"] == "COMPLETED":
            output = data.get("output", {})
            if isinstance(output, dict):
                output["status"] = "COMPLETED"
                output["_training_meta"] = {
                    "request_id": request_id,
                    "model_id": model_id,
                    "execution_time": data.get("executionTime"),
                }
                return output

        return data
