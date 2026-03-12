"""Replicate inference and training provider."""

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

REPLICATE_API = "https://api.replicate.com/v1"


class ReplicateProvider(InferenceProvider):
    """Provider that forwards inference and training requests to the Replicate HTTP API."""

    def __init__(self, api_key: str, model_id: Optional[str] = None) -> None:
        self._api_key = api_key
        self._default_model_id = model_id or ""

    @property
    def _auth_headers(self) -> dict:
        return {"Authorization": f"Bearer {self._api_key}"}

    async def health(self) -> bool:
        """Check connectivity to the Replicate API."""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    f"{REPLICATE_API}/predictions",
                    headers=self._auth_headers,
                    timeout=aiohttp.ClientTimeout(total=5),
                ) as resp:
                    return resp.status < 500
        except Exception:
            return False

    async def inference(self, request_body: dict, session: aiohttp.ClientSession,
                        model_id: Optional[str] = None) -> dict:
        """Create a prediction on Replicate and poll until it completes."""
        model = model_id or request_body.pop("model_id", None) or self._default_model_id
        # Use model-specific endpoint for named models (owner/name format)
        if model and "/" in model:
            url = f"{REPLICATE_API}/models/{model}/predictions"
            payload = {"input": request_body}
        else:
            url = f"{REPLICATE_API}/predictions"
            payload = {"version": model, "input": request_body}
        headers = {**self._auth_headers, "Content-Type": "application/json"}

        async with session.post(url, json=payload, headers=headers) as resp:
            prediction = await resp.json()
            if resp.status >= 400:
                return {"error": f"Replicate returned {resp.status}", "detail": prediction}

        prediction_url = prediction.get("urls", {}).get("get", f"{url}/{prediction['id']}")

        elapsed = 0
        result = prediction
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

    async def train(self, request_body: dict, session: aiohttp.ClientSession) -> dict:
        """Submit a training job and poll until completion (synchronous)."""
        model = request_body.pop("model_id", None) or self._default_model_id
        poll_timeout = request_body.pop("poll_timeout", _TRAIN_POLL_TIMEOUT)

        headers = {**self._auth_headers, "Content-Type": "application/json"}

        logger.info("Submitting Replicate training: model=%s", model)
        # Use model-specific endpoint for named models
        if model and "/" in model:
            url = f"{REPLICATE_API}/models/{model}/predictions"
            payload = {"input": request_body}
        else:
            url = f"{REPLICATE_API}/predictions"
            payload = {"version": model, "input": request_body}

        async with session.post(url, json=payload, headers=headers) as resp:
            if resp.status >= 400:
                body = await resp.text()
                return {"error": f"Replicate returned {resp.status}", "detail": body}
            prediction = await resp.json()

        prediction_id = prediction.get("id")
        if not prediction_id:
            return {"error": "Replicate did not return a prediction id", "detail": prediction}

        prediction_url = prediction.get("urls", {}).get(
            "get", f"{REPLICATE_API}/predictions/{prediction_id}")

        logger.info("Replicate training submitted: id=%s", prediction_id)

        elapsed = 0
        result = prediction
        while elapsed < poll_timeout:
            await asyncio.sleep(_TRAIN_POLL_INTERVAL)
            elapsed += _TRAIN_POLL_INTERVAL

            try:
                async with session.get(prediction_url, headers=self._auth_headers) as resp:
                    result = await resp.json()
            except Exception as e:
                logger.warning("Replicate status poll failed (elapsed=%ds): %s", elapsed, e)
                continue

            status = result.get("status", "unknown")
            logger.info("Replicate training status: %s (elapsed=%ds)", status, elapsed)

            if status == "succeeded":
                result["_training_meta"] = {
                    "request_id": prediction_id,
                    "model_id": model,
                    "elapsed_seconds": elapsed,
                    "predict_time": result.get("metrics", {}).get("predict_time"),
                }
                return result

            if status in ("failed", "canceled"):
                return {"error": f"Replicate training {status}", "detail": result,
                        "request_id": prediction_id, "model_id": model}

        return {"error": "Replicate training timed out",
                "detail": {"last_status": result.get("status"), "elapsed": elapsed},
                "request_id": prediction_id, "model_id": model}

    async def train_submit(self, request_body: dict, session: aiohttp.ClientSession) -> dict:
        """Submit a training job without polling -- returns immediately."""
        model = request_body.pop("model_id", None) or self._default_model_id
        headers = {**self._auth_headers, "Content-Type": "application/json"}

        # Use model-specific endpoint for named models
        if model and "/" in model:
            url = f"{REPLICATE_API}/models/{model}/predictions"
            payload = {"input": request_body}
        else:
            url = f"{REPLICATE_API}/predictions"
            payload = {"version": model, "input": request_body}

        logger.info("Submitting Replicate async training: model=%s", model)
        async with session.post(url, json=payload, headers=headers) as resp:
            if resp.status >= 400:
                body = await resp.text()
                return {"error": f"Replicate returned {resp.status}", "detail": body}
            data = await resp.json()

        return {
            "request_id": data.get("id"),
            "status": data.get("status", "starting"),
            "model_id": model,
            "urls": data.get("urls", {}),
        }

    async def train_status(self, request_id: str, model_id: str,
                           session: aiohttp.ClientSession) -> dict:
        """Check Replicate training job status."""
        url = f"{REPLICATE_API}/predictions/{request_id}"

        async with session.get(url, headers=self._auth_headers) as resp:
            data = await resp.json()

        replicate_status = data.get("status", "unknown")

        # Map Replicate statuses to normalized statuses
        status_map = {
            "starting": "IN_QUEUE",
            "processing": "IN_PROGRESS",
            "succeeded": "COMPLETED",
            "failed": "FAILED",
            "canceled": "CANCELLED",
        }
        data["status"] = status_map.get(replicate_status, replicate_status)

        if data["status"] == "COMPLETED":
            output = data.get("output")
            if isinstance(output, dict):
                output["status"] = "COMPLETED"
                output["_training_meta"] = {
                    "request_id": request_id,
                    "model_id": model_id,
                    "predict_time": data.get("metrics", {}).get("predict_time"),
                }
                return output
            return {
                "status": "COMPLETED",
                "output": output,
                "_training_meta": {"request_id": request_id, "model_id": model_id},
            }

        return data
