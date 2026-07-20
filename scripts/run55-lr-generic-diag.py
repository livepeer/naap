#!/usr/bin/env python3
"""Run 55 diag 2 — what does the LR-orch advertise generically (no cap filter)
and for its native live-video-to-video / streamdiffusion caps?

Confirms whether liverunner-staging-1 has ANY non-zero pricing configured, or is
completely unpriced for the billed ticket path.
"""
from __future__ import annotations

import os
import sys

BEARER = os.environ.get("COMPOSITE_BEARER", "").strip()
SIGNER_URL = os.environ.get("BYOC_SIGNER_URL", "").strip()
LR_ORCH = os.environ.get("LR_ORCH", "https://liverunner-staging-1.daydream.monster:8935").strip()
GATEWAY_SRC = os.environ.get(
    "GATEWAY_SRC",
    os.path.join(os.path.dirname(__file__), "..", "..", "livepeer-python-gateway", "src"),
)


def _price(pi) -> str:
    if pi is None:
        return "<none>"
    return f"{pi.pricePerUnit}/{pi.pixelsPerUnit}"


def main() -> int:
    token = BEARER[len("Bearer "):].strip() if BEARER.lower().startswith("bearer ") else BEARER
    headers = {"Authorization": f"Bearer {token}"}
    sys.path.insert(0, os.path.abspath(GATEWAY_SRC))
    from livepeer_gateway.orch_info import get_orch_info
    from livepeer_gateway.capabilities import CapabilityId, build_capabilities

    print("=== LR-orch generic get_orch_info (no capabilities filter) ===")
    info = get_orch_info(LR_ORCH, signer_url=SIGNER_URL, signer_headers=headers)
    pi = info.price_info if info.HasField("price_info") else None
    caps_prices = list(getattr(info, "capabilities_prices", []) or [])
    print(f"  recipient      : 0x{info.address.hex()}")
    print(f"  transcoder     : {info.transcoder}")
    print(f"  PriceInfo      : {_price(pi)}")
    print(f"  capsPrices (n) : {len(caps_prices)}")
    nonzero = [cp for cp in caps_prices if cp.pricePerUnit != 0]
    print(f"  nonzero caps   : {len(nonzero)}")
    for cp in caps_prices[:20]:
        cap = getattr(cp, "capability", "?")
        con = getattr(cp, "constraint", "")
        print(f"      cap={cap} constraint={con!r} price={_price(cp)}")

    for capid, model in ((CapabilityId.LIVE_VIDEO_TO_VIDEO, "streamdiffusion"),):
        print(f"\n=== LR-orch cap {int(capid)} model={model} ===")
        try:
            caps = build_capabilities(capid, model)
            i = get_orch_info(LR_ORCH, signer_url=SIGNER_URL, signer_headers=headers, capabilities=caps)
            pi2 = i.price_info if i.HasField("price_info") else None
            cps = list(getattr(i, "capabilities_prices", []) or [])
            print(f"  PriceInfo={_price(pi2)} capsPrices={len(cps)}")
            for cp in cps[:8]:
                print(f"      cap={getattr(cp,'capability','?')} constraint={getattr(cp,'constraint','')!r} price={_price(cp)}")
        except Exception as e:
            print(f"  ERR: {str(e)[:200]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
