"""Google Gemini inference provider -- image generation via Gemini API."""

from __future__ import annotations

import asyncio
import base64
import logging
import uuid
from typing import Optional

import aiohttp

from .base import InferenceProvider

logger = logging.getLogger(__name__)

_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"
_POLL_INTERVAL = 5
_POLL_TIMEOUT = 300


class GeminiProvider(InferenceProvider):
    """Provider that calls Google Gemini API for image and text generation.

    Supports:
      - gemini-2.0-flash (text)
      - gemini-2.0-flash-preview-image-generation (image gen via generateContent)
      - imagen-3.0-generate-002 (image gen via predict)
      - veo-2.0-generate-001 (video gen via predictLongRunning)
    """

    def __init__(self, api_key: str, model_id: Optional[str] = None) -> None:
        self._api_key = api_key
        self._default_model_id = model_id

    async def health(self) -> bool:
        try:
            async with aiohttp.ClientSession() as session:
                url = f"{_BASE_URL}/models?key={self._api_key}"
                async with session.get(url, timeout=aiohttp.ClientTimeout(total=5)) as resp:
                    return resp.status == 200
        except Exception:
            return False

    def _resolve_model(self, model_id: Optional[str]) -> str:
        resolved = model_id or self._default_model_id
        if not resolved:
            raise ValueError("No model_id provided and no default configured")
        return resolved

    async def inference(self, request_body: dict, session: aiohttp.ClientSession,
                        model_id: Optional[str] = None) -> dict:
        mid = self._resolve_model(model_id)
        logger.info("Gemini inference: model=%s", mid)

        # Route to appropriate API based on model
        if "imagen" in mid:
            return await self._imagen_predict(mid, request_body, session)
        elif "veo" in mid:
            return await self._veo_generate(mid, request_body, session)
        else:
            return await self._gemini_generate(mid, request_body, session)

    async def _gemini_generate(self, model_id: str, request_body: dict,
                               session: aiohttp.ClientSession) -> dict:
        """Use generateContent API for Gemini models (text + image output)."""
        url = f"{_BASE_URL}/models/{model_id}:generateContent?key={self._api_key}"

        prompt = request_body.get("prompt", "")
        parts = [{"text": prompt}]

        # If image_url provided, include it as input
        if "image_url" in request_body:
            img_url = request_body["image_url"]
            async with session.get(img_url) as resp:
                img_data = await resp.read()
                ct = resp.headers.get("Content-Type", "image/png")
            parts.append({
                "inline_data": {
                    "mime_type": ct,
                    "data": base64.b64encode(img_data).decode(),
                }
            })

        gen_config = {"responseModalities": ["TEXT", "IMAGE"]}
        if "aspect_ratio" in request_body:
            gen_config["imageConfig"] = {"aspectRatio": request_body["aspect_ratio"]}

        payload = {
            "contents": [{"parts": parts}],
            "generationConfig": gen_config,
        }

        async with session.post(url, json=payload, timeout=aiohttp.ClientTimeout(total=120)) as resp:
            body = await resp.json()
            if resp.status != 200:
                return {"error": f"Gemini API returned {resp.status}", "detail": body}

        # Parse response -- extract images and text
        images = []
        text_parts = []
        candidates = body.get("candidates", [])
        for candidate in candidates:
            for part in candidate.get("content", {}).get("parts", []):
                if "text" in part:
                    text_parts.append(part["text"])
                if "inlineData" in part:
                    data = part["inlineData"]
                    img_id = uuid.uuid4().hex[:12]
                    images.append({
                        "base64": data["data"],
                        "mime_type": data.get("mimeType", "image/png"),
                        "id": img_id,
                    })

        result = {}
        if images:
            result["images"] = images
        if text_parts:
            result["text"] = "\n".join(text_parts)
        return result

    async def _imagen_predict(self, model_id: str, request_body: dict,
                              session: aiohttp.ClientSession) -> dict:
        """Use predict API for Imagen models."""
        url = f"{_BASE_URL}/models/{model_id}:predict?key={self._api_key}"

        prompt = request_body.get("prompt", "")
        num_images = request_body.get("num_images", 1)

        payload = {
            "instances": [{"prompt": prompt}],
            "parameters": {
                "sampleCount": num_images,
                "aspectRatio": request_body.get("aspect_ratio", "1:1"),
            },
        }

        async with session.post(url, json=payload, timeout=aiohttp.ClientTimeout(total=120)) as resp:
            body = await resp.json()
            if resp.status != 200:
                return {"error": f"Imagen API returned {resp.status}", "detail": body}

        images = []
        for pred in body.get("predictions", []):
            img_id = uuid.uuid4().hex[:12]
            images.append({
                "base64": pred.get("bytesBase64Encoded", ""),
                "mime_type": pred.get("mimeType", "image/png"),
                "id": img_id,
            })

        return {"images": images}

    async def _veo_generate(self, model_id: str, request_body: dict,
                            session: aiohttp.ClientSession) -> dict:
        """Use predictLongRunning API for Veo video models."""
        url = f"{_BASE_URL}/models/{model_id}:predictLongRunning?key={self._api_key}"

        prompt = request_body.get("prompt", "")
        instance = {"prompt": prompt}

        if "image_url" in request_body:
            img_url = request_body["image_url"]
            async with session.get(img_url) as resp:
                img_data = await resp.read()
                ct = resp.headers.get("Content-Type", "image/png")
            instance["image"] = {
                "bytesBase64Encoded": base64.b64encode(img_data).decode(),
                "mimeType": ct,
            }

        payload = {
            "instances": [instance],
            "parameters": {
                "aspectRatio": request_body.get("aspect_ratio", "16:9"),
                "durationSeconds": request_body.get("duration", "5"),
                "numberOfVideos": 1,
            },
        }

        async with session.post(url, json=payload, timeout=aiohttp.ClientTimeout(total=30)) as resp:
            body = await resp.json()
            if resp.status != 200:
                return {"error": f"Veo API returned {resp.status}", "detail": body}

        op_name = body.get("name")
        if not op_name:
            return body

        # Poll for completion
        poll_url = f"{_BASE_URL}/{op_name}?key={self._api_key}"
        elapsed = 0
        while elapsed < _POLL_TIMEOUT:
            await asyncio.sleep(_POLL_INTERVAL)
            elapsed += _POLL_INTERVAL

            async with session.get(poll_url) as resp:
                status = await resp.json()

            if status.get("done"):
                response = status.get("response", {})
                vr = response.get("generateVideoResponse", {})
                samples = vr.get("generatedSamples", [])
                if samples:
                    video = samples[0].get("video", {})
                    return {"video": {"url": video.get("uri", ""), "source": "veo"}}
                return {"error": "Veo returned no samples", "detail": status}

            logger.debug("Veo polling: elapsed=%ds", elapsed)

        return {"error": "Veo timed out", "elapsed": elapsed}
