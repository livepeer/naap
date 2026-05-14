"""
Pricing metering — PR-B of pricing-metering-design.md.

Public API:
    compute_units(meter, request_body, response_body, elapsed_seconds)
        → (units: float, kind: str)

Where `meter` is the per-cap config dict from CAPABILITIES_JSON. Returns
the units count the adapter should advertise via X-Livepeer-Units-Consumed.

When `meter` is None or `meter.extractor` is missing → returns (0.0, "")
which signals "don't set the header" — orch falls back to seconds.
"""
from __future__ import annotations

from typing import Optional

from .extractors import EXTRACTORS

# Public re-exports
__all__ = ["compute_units", "EXTRACTORS"]


def compute_units(
    meter: Optional[dict],
    request_body: dict,
    response_body: dict,
    elapsed_seconds: float,
) -> tuple[float, str]:
    """Resolve units + kind from cap meter config.

    Returns (units, kind). If meter is None or extractor name is
    unknown, returns (0.0, "") to signal "no header" — orch will
    fall back to seconds-as-units (current behavior preserved).

    On extractor failure (raises exception), returns
    (meter.fallback, extractor_kind) so the cap still bills SOMETHING
    instead of failing silently.
    """
    if not meter or not isinstance(meter, dict):
        return (0.0, "")

    name = meter.get("extractor")
    if not name or name not in EXTRACTORS:
        return (0.0, "")

    extractor_fn, kind = EXTRACTORS[name]
    fallback = float(meter.get("fallback", 1.0))
    min_units = meter.get("min_units")
    max_units = meter.get("max_units")

    try:
        units = float(extractor_fn(request_body, response_body, elapsed_seconds))
    except Exception:
        units = fallback

    if units < 0:
        units = fallback

    # Apply clamps
    if min_units is not None:
        units = max(units, float(min_units))
    if max_units is not None:
        units = min(units, float(max_units))

    return (units, kind)
