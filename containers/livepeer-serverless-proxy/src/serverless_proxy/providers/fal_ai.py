"""fal.ai inference + training provider."""

from __future__ import annotations

import asyncio
import logging
from typing import Optional

import aiohttp

from .base import InferenceProvider

logger = logging.getLogger(__name__)

_POLL_INTERVAL = 2
_POLL_TIMEOUT = 300


# Map of base model (what SDK sends as `model_id` in training body) to the
# fal training model URL. flux-dev + flux-schnell both train via the same
# fal-ai/flux-lora-fast-training endpoint. New base models can be added by
# operators via runtime CAPABILITIES_JSON; this dict is the default for
# fal-hosted training when no override is provided.
TRAINING_MODELS = {
    "flux-dev": "fal-ai/flux-lora-fast-training",
    "flux-schnell": "fal-ai/flux-lora-fast-training",
}


class FalAiProvider(InferenceProvider):
    """Provider that forwards inference + training requests to fal.ai.

    Inference: synchronous /run, queue fallback on non-200.
    Training: async via /queue submit + poll status by request_id.

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

    # -----------------------------------------------------------------------
    # Training (PR-3 of byoc-payment-fleet-2026-05)
    # -----------------------------------------------------------------------

    async def train_submit(self, body: dict, session: aiohttp.ClientSession) -> dict:
        """Submit a LoRA training job to fal.ai's queue.

        Called by serverless-proxy's /train/submit handler when the inference-
        adapter forwards a training request from the BYOC orch. Body shape
        matches what the SDK sent: {"model_id": "flux-dev", "params": {...}}.

        Returns the queue envelope in the shape adapter expects:
        {"request_id", "model_id", "status_url"}.

        On failure returns {"error": "...", "detail": "..."} which the
        adapter surfaces as a backend submit failure.
        """
        base_model = body.get("model_id") or ""
        fal_model = TRAINING_MODELS.get(base_model, "fal-ai/flux-lora-fast-training")
        params = body.get("params", {})

        # Forward all caller-provided params to fal, then apply defaults
        # for the three required fields. fal-ai/flux-lora-fast-training
        # accepts many optional inputs (learning_rate, is_style,
        # data_archive_format, resume_from_checkpoint, etc.) — silently
        # dropping unknown params would prevent callers from using them.
        # Strategy: spread params first, then setdefault for required keys
        # so callers can override defaults if needed.
        queue_body: dict = dict(params)  # shallow copy, preserves all fields
        queue_body.setdefault("images_data_url", "")
        queue_body.setdefault("trigger_word", "TOK")
        queue_body.setdefault("steps", 1000)
        # Coerce steps to int — SDK callers sometimes pass strings
        if isinstance(queue_body.get("steps"), str):
            try:
                queue_body["steps"] = int(queue_body["steps"])
            except ValueError:
                queue_body["steps"] = 1000  # fall back to default
        if "create_masks" in queue_body:
            queue_body["create_masks"] = bool(queue_body["create_masks"])

        queue_url = f"https://queue.fal.run/{fal_model}"
        headers = {
            "Authorization": f"Key {self._api_key}",
            "Content-Type": "application/json",
        }

        logger.info("fal.ai training submit: base=%s fal_model=%s", base_model, fal_model)

        try:
            async with session.post(
                queue_url, json=queue_body, headers=headers,
                timeout=aiohttp.ClientTimeout(total=30),
            ) as resp:
                if resp.status not in (200, 201):
                    err_body = await resp.text()
                    return {
                        "error": f"fal.ai training submit returned {resp.status}",
                        "detail": err_body[:500],
                    }
                envelope = await resp.json()
        except asyncio.TimeoutError:
            return {"error": "fal.ai training submit timed out"}
        except aiohttp.ClientError as e:
            return {"error": f"fal.ai client error: {type(e).__name__}", "detail": str(e)}

        if "request_id" not in envelope:
            return {
                "error": "fal.ai training submit: unexpected envelope shape",
                "detail": str(envelope)[:300],
            }

        # If fal omits status_url, build the canonical URL ourselves. The
        # adapter doesn't actually use status_url (it builds its own URL
        # from {backend_url}/train/status/{request_id}?model_id=X), but
        # the contract advertises this field — populate it so external
        # callers (debug tools, logs) see a consistent response shape.
        status_url = envelope.get("status_url") or (
            f"https://queue.fal.run/{fal_model}/requests/{envelope['request_id']}/status"
        )
        return {
            "request_id": envelope["request_id"],
            "model_id": fal_model,
            "status_url": status_url,
        }

    async def train_status(self, fal_model: str, request_id: str,
                           session: aiohttp.ClientSession) -> dict:
        """Poll a fal training job by request_id.

        Returns fal's native status shape (`{"status": "IN_PROGRESS"|"COMPLETED"|...}`)
        directly. The adapter knows how to translate from these statuses to
        its own job state.

        On COMPLETED, fetches the full response (which includes
        diffusers_lora_file URL) and merges it into the status dict.
        """
        headers = {"Authorization": f"Key {self._api_key}"}
        status_url = f"https://queue.fal.run/{fal_model}/requests/{request_id}/status"

        try:
            async with session.get(
                status_url, headers=headers,
                timeout=aiohttp.ClientTimeout(total=15),
            ) as resp:
                if resp.status != 200:
                    text = await resp.text()
                    return {
                        "status": "FAILED",
                        "error": f"status check returned {resp.status}",
                        "detail": text[:300],
                    }
                status_data = await resp.json()
        except (asyncio.TimeoutError, aiohttp.ClientError) as e:
            return {"status": "FAILED", "error": f"status poll error: {e}"}

        if status_data.get("status") != "COMPLETED":
            return status_data  # IN_PROGRESS, IN_QUEUE, FAILED, etc.

        # On COMPLETED, fetch full response envelope (has the LoRA weights URL)
        response_url = f"https://queue.fal.run/{fal_model}/requests/{request_id}"
        try:
            async with session.get(
                response_url, headers=headers,
                timeout=aiohttp.ClientTimeout(total=15),
            ) as resp:
                if resp.status == 200:
                    result = await resp.json()
                    return {"status": "COMPLETED", **result}
        except (asyncio.TimeoutError, aiohttp.ClientError):
            pass
        # Best-effort: if we can't fetch result, return what we have
        return status_data
