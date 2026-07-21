#!/usr/bin/env python3
"""Run 55 diag — dump full OrchestratorInfo (price_info + capabilities_prices +
ticket_params + transcoder) from the LR-orchestrator (liverunner-staging-1) vs
byoc-staging-1 for the same caps, using the billed composite signer.

Answers: does the LR-orch advertise per-cap BYOC prices at all, or return zero
PriceInfo (why `/generate-live-payment` → 400 "missing or zero priceInfo")?

Secrets env-only (never echoed/committed):
  COMPOSITE_BEARER  "Bearer app_<24hex>_pmth_<secret>"
  BYOC_SIGNER_URL   signer base url
  LR_ORCH           live-runner orch gRPC url
  BYOC_ORCH_URL     byoc-staging-1 gRPC url (compare)
  GATEWAY_SRC       path to livepeer-python-gateway/src
"""
from __future__ import annotations

import os
import sys

BEARER = os.environ.get("COMPOSITE_BEARER", "").strip()
SIGNER_URL = os.environ.get("BYOC_SIGNER_URL", "").strip()
LR_ORCH = os.environ.get("LR_ORCH", "https://liverunner-staging-1.daydream.monster:8935").strip()
BYOC_ORCH = os.environ.get("BYOC_ORCH_URL", "https://byoc-staging-1.daydream.monster:8935").strip()
GATEWAY_SRC = os.environ.get(
    "GATEWAY_SRC",
    os.path.join(os.path.dirname(__file__), "..", "..", "livepeer-python-gateway", "src"),
)
CAPS = os.environ.get("CAP_LIST", "flux-schnell,flux-dev,gpt-image,kontext-edit").split(",")


def _price(pi) -> str:
    if pi is None:
        return "<none>"
    return f"{pi.pricePerUnit}/{pi.pixelsPerUnit}"


def main() -> int:
    if not BEARER or not SIGNER_URL:
        print("FATAL: set COMPOSITE_BEARER + BYOC_SIGNER_URL")
        return 2
    token = BEARER[len("Bearer "):].strip() if BEARER.lower().startswith("bearer ") else BEARER
    headers = {"Authorization": f"Bearer {token}"}

    sys.path.insert(0, os.path.abspath(GATEWAY_SRC))
    from livepeer_gateway.capabilities import byoc_capabilities_from_app
    from livepeer_gateway.orch_info import get_orch_info

    for label, orch in (("LR-orch liverunner-staging-1", LR_ORCH), ("byoc-staging-1", BYOC_ORCH)):
        print("=" * 72)
        print(f"{label}  {orch}")
        print("=" * 72)
        for cap in CAPS:
            cap = cap.strip()
            if not cap:
                continue
            try:
                byoc_caps = byoc_capabilities_from_app(cap)
                info = get_orch_info(orch, signer_url=SIGNER_URL, signer_headers=headers, capabilities=byoc_caps)
            except Exception as exc:
                print(f"  [{cap:<16}] get_orch_info ERR: {str(exc)[:160]}")
                continue
            pi = info.price_info if info.HasField("price_info") else None
            caps_prices = list(getattr(info, "capabilities_prices", []) or [])
            tp = info.HasField("ticket_params")
            print(f"  [{cap:<16}] recipient=0x{info.address.hex()[:12]}… "
                  f"PriceInfo={_price(pi):<12} capsPrices={len(caps_prices)} "
                  f"ticket_params={'Y' if tp else 'N'} transcoder={info.transcoder or '-'}")
            for cp in caps_prices[:6]:
                print(f"        capsPrice: {_price(cp)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
