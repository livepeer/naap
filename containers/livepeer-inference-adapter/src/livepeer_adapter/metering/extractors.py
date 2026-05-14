"""
Extractor registry — PR-B of pricing-metering-design.md §5.2.

Each extractor is a pure function:
    (request_body: dict, response_body: dict, elapsed_seconds: float) -> float

Industry alignment (see design doc §2):
- Image gen / edit → output.image_megapixels   (fal, Stability)
- Video gen / i2v  → output.video_seconds      (fal, Pika, Runway)
- TTS              → input.text_kilo_chars     (ElevenLabs, OpenAI TTS)
- Music            → output.audio_seconds      (Stable Audio)
- 3D mesh          → output.mesh_count         (Tripo3D, Meshy)
- LLM text         → llm.tokens_io             (split input/output)
- Generic compute  → time.seconds              (Lambda, Vercel Active CPU)
- API proxy / MCP  → flat.1                    (Zapier-style)

EXTRACTORS maps name → (function, default_unit_kind).
Adding a new extractor: write the function, add an entry to EXTRACTORS.
"""
from __future__ import annotations

import math
from typing import Callable

ExtractorFn = Callable[[dict, dict, float], float]


# ─── output extractors ───────────────────────────────────────────────


def _output_image_megapixels(req: dict, resp: dict, _elapsed: float) -> float:
    """Sum (w × h / 1MP) across all output images.

    Handles fal/Flux/Stability shape (`images: [{width, height, url}]`),
    nested-dict shape (`{image: {width, height}}`), and the bare-URL
    fallback (defaults to 1 MP when dimensions absent — typical
    1024×1024).
    """
    total_pixels = 0.0
    images = []

    # Common shapes the inference backend returns
    if isinstance(resp.get("images"), list):
        images = resp["images"]
    elif isinstance(resp.get("image"), dict):
        images = [resp["image"]]
    elif isinstance(resp.get("data"), dict):
        data = resp["data"]
        if isinstance(data.get("images"), list):
            images = data["images"]
        elif isinstance(data.get("image"), dict):
            images = [data["image"]]

    if not images:
        # Bare URL fallback — assume 1 MP for the typical 1024² output
        return 1.0

    for img in images:
        if not isinstance(img, dict):
            continue
        w = img.get("width") or img.get("w")
        h = img.get("height") or img.get("h")
        if isinstance(w, (int, float)) and isinstance(h, (int, float)) and w > 0 and h > 0:
            total_pixels += float(w) * float(h)
        else:
            # Image present but no dimensions — count as 1 MP default
            total_pixels += 1_048_576.0

    return total_pixels / 1_048_576.0


def _output_image_count(req: dict, resp: dict, _elapsed: float) -> float:
    if isinstance(resp.get("images"), list):
        return float(len(resp["images"]))
    if isinstance(resp.get("data"), dict) and isinstance(resp["data"].get("images"), list):
        return float(len(resp["data"]["images"]))
    if resp.get("image") or resp.get("url"):
        return 1.0
    return 1.0


def _output_video_seconds(req: dict, resp: dict, _elapsed: float) -> float:
    """Sum duration over output videos. Falls back to request `duration`
    if response doesn't include it (common for fal video models).
    """
    # Try common response shapes
    candidates = []
    if isinstance(resp.get("video"), dict):
        candidates.append(resp["video"])
    if isinstance(resp.get("videos"), list):
        candidates.extend([v for v in resp["videos"] if isinstance(v, dict)])
    if isinstance(resp.get("data"), dict):
        if isinstance(resp["data"].get("video"), dict):
            candidates.append(resp["data"]["video"])
        if isinstance(resp["data"].get("videos"), list):
            candidates.extend([v for v in resp["data"]["videos"] if isinstance(v, dict)])

    total = 0.0
    for v in candidates:
        d = v.get("duration") or v.get("duration_seconds")
        if isinstance(d, (int, float)) and d > 0:
            total += float(d)

    if total > 0:
        return total

    # Fall back to request — many fal video models echo the requested duration
    d = req.get("duration") or req.get("duration_seconds")
    if isinstance(d, (int, float)) and d > 0:
        return float(d)
    if isinstance(d, str):
        try:
            return float(d)
        except ValueError:
            pass

    # Last resort: standard 5-second default
    return 5.0


def _output_audio_seconds(req: dict, resp: dict, _elapsed: float) -> float:
    candidates = []
    if isinstance(resp.get("audio"), dict):
        candidates.append(resp["audio"])
    if isinstance(resp.get("audio_file"), dict):
        candidates.append(resp["audio_file"])
    if isinstance(resp.get("data"), dict):
        for k in ("audio", "audio_file"):
            if isinstance(resp["data"].get(k), dict):
                candidates.append(resp["data"][k])

    for a in candidates:
        d = a.get("duration") or a.get("duration_seconds")
        if isinstance(d, (int, float)) and d > 0:
            return float(d)

    # Music/SFX default
    d = req.get("duration")
    if isinstance(d, (int, float)) and d > 0:
        return float(d)
    return 10.0


def _output_mesh_count(req: dict, resp: dict, _elapsed: float) -> float:
    if isinstance(resp.get("meshes"), list):
        return float(len(resp["meshes"]) or 1)
    if resp.get("mesh") or resp.get("model_url") or resp.get("model_mesh"):
        return 1.0
    if isinstance(resp.get("data"), dict):
        if isinstance(resp["data"].get("meshes"), list):
            return float(len(resp["data"]["meshes"]) or 1)
    return 1.0


def _output_text_kilo_tokens(req: dict, resp: dict, _elapsed: float) -> float:
    """Crude tokenizer-free approximation: ~4 chars / token."""
    text = ""
    if isinstance(resp.get("text"), str):
        text = resp["text"]
    elif isinstance(resp.get("data"), dict) and isinstance(resp["data"].get("text"), str):
        text = resp["data"]["text"]
    return max(0.001, len(text) / 4 / 1000)


# ─── input extractors ────────────────────────────────────────────────


def _input_text_kilo_chars(req: dict, _resp: dict, _elapsed: float) -> float:
    text = req.get("text") or req.get("prompt") or ""
    if not isinstance(text, str):
        return 0.0
    return max(0.001, len(text) / 1000)


def _input_text_chars(req: dict, _resp: dict, _elapsed: float) -> float:
    text = req.get("text") or req.get("prompt") or ""
    return float(len(text)) if isinstance(text, str) else 0.0


def _input_image_megapixels(req: dict, _resp: dict, _elapsed: float) -> float:
    """For upscale/edit caps where input image area drives cost.

    Without parsing the image bytes, we accept dimensions in the
    request (width/height) or default to 1 MP.
    """
    w = req.get("width") or req.get("image_width")
    h = req.get("height") or req.get("image_height")
    if isinstance(w, (int, float)) and isinstance(h, (int, float)) and w > 0 and h > 0:
        return (float(w) * float(h)) / 1_048_576.0
    return 1.0


def _input_video_seconds(req: dict, _resp: dict, _elapsed: float) -> float:
    """Duration of input video, e.g. for ffmpeg-trim / ffmpeg-export."""
    d = (
        req.get("duration")
        or req.get("input_duration")
        or req.get("video_duration_seconds")
    )
    if isinstance(d, (int, float)) and d > 0:
        return float(d)
    return 1.0


def _input_video_seconds_total(req: dict, _resp: dict, _elapsed: float) -> float:
    """Sum input durations across multiple inputs, e.g. ffmpeg-concat."""
    items = req.get("inputs") or req.get("clips") or req.get("video_urls") or []
    total = 0.0
    if isinstance(items, list):
        for item in items:
            if isinstance(item, dict):
                d = item.get("duration") or item.get("duration_seconds")
                if isinstance(d, (int, float)) and d > 0:
                    total += float(d)
    # Fallback if `total_duration` is in the request
    if total <= 0:
        d = req.get("total_duration") or req.get("duration")
        if isinstance(d, (int, float)) and d > 0:
            return float(d)
    return max(total, 1.0)


# ─── special / generic ───────────────────────────────────────────────


def _llm_tokens_io(req: dict, resp: dict, _elapsed: float) -> float:
    """Returns total tokens. Split input/output via the adapter
    setting X-Livepeer-Units-Input + X-Livepeer-Units-Output headers
    is a future enhancement; for now we return the sum so a single
    price_per_unit works.
    """
    in_tok = 0
    out_tok = 0
    usage = resp.get("usage") if isinstance(resp, dict) else None
    if isinstance(usage, dict):
        in_tok = int(usage.get("input_tokens") or usage.get("prompt_tokens") or 0)
        out_tok = int(usage.get("output_tokens") or usage.get("completion_tokens") or 0)
    if in_tok == 0 and out_tok == 0:
        # Crude fallback: estimate from prompt + completion length
        prompt = req.get("prompt") or req.get("text") or ""
        completion = resp.get("text") or ""
        if isinstance(prompt, str):
            in_tok = max(1, len(prompt) // 4)
        if isinstance(completion, str):
            out_tok = max(0, len(completion) // 4)
    return float(in_tok + out_tok)


def _time_seconds(_req: dict, _resp: dict, elapsed_seconds: float) -> float:
    """Wall-clock seconds — fallback / training-style billing."""
    return max(1.0, math.ceil(elapsed_seconds))


def _flat_one(_req: dict, _resp: dict, _elapsed: float) -> float:
    """Flat 1-per-call. For MCP-bridged tools, per-call APIs."""
    return 1.0


# ─── registry ────────────────────────────────────────────────────────

EXTRACTORS: dict[str, tuple[ExtractorFn, str]] = {
    # output extractors
    "output.image_megapixels":   (_output_image_megapixels,    "megapixel"),
    "output.image_count":        (_output_image_count,         "image"),
    "output.video_seconds":      (_output_video_seconds,       "second"),
    "output.audio_seconds":      (_output_audio_seconds,       "second"),
    "output.mesh_count":         (_output_mesh_count,          "mesh"),
    "output.text_kilo_tokens":   (_output_text_kilo_tokens,    "1000_tokens"),
    # input extractors
    "input.text_kilo_chars":     (_input_text_kilo_chars,      "1000_characters"),
    "input.text_chars":          (_input_text_chars,           "character"),
    "input.image_megapixels":    (_input_image_megapixels,     "megapixel"),
    "input.video_seconds":       (_input_video_seconds,        "second"),
    "input.video_seconds_total": (_input_video_seconds_total,  "second"),
    # special
    "llm.tokens_io":             (_llm_tokens_io,              "1000_tokens"),
    "time.seconds":              (_time_seconds,               "second"),
    "flat.1":                    (_flat_one,                   "call"),
}
