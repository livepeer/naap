#!/usr/bin/env python3
"""Run 53 — expanded multi-capability billed BYOC probe (price + unit + label correctness).

For each capability in CAP_LIST, drive the *billed composite signer path* (unaffected by the
NaaP validate 503): caps-aware `get_orch_info` against byoc-staging-1, then
`/generate-live-payment`, decode the `net.Payment`, and compare:

  - orch requested-cap price (PriceInfo, overhead-adjusted) vs payment ExpectedPrice
  - advertised base price from SDK /capabilities (price_per_unit / price_scaling) × 1% overhead
  - pixelsPerUnit / unit kind (per-megapixel image vs per-second video vs per-1k-char TTS)

Secrets are env-only (never echoed / committed):
  COMPOSITE_BEARER  "Bearer app_<24hex>_pmth_<secret>"   (billed composite session)
  BYOC_SIGNER_URL   signer base url
  BYOC_ORCH_URL     orchestrator gRPC (default byoc-staging-1:8935)
  GATEWAY_SRC       path to livepeer-python-gateway/src
  CAPS_JSON         path to SDK /capabilities dump (for advertised price cross-check)
"""
from __future__ import annotations

import base64
import json
import os
import sys
import urllib.request
import urllib.error
import urllib.parse
from fractions import Fraction

BEARER = os.environ.get("COMPOSITE_BEARER", "").strip()
SIGNER_URL = os.environ.get("BYOC_SIGNER_URL", "").strip()
ORCH = os.environ.get("BYOC_ORCH_URL", "https://byoc-staging-1.daydream.monster:8935").strip()
GATEWAY_SRC = os.environ.get(
    "GATEWAY_SRC",
    os.path.join(os.path.dirname(__file__), "..", "..", "livepeer-python-gateway", "src"),
)
CAPS_JSON = os.environ.get("CAPS_JSON", "/tmp/caps.json")

# Randomized varied selection across price tiers + unit kinds (image/video/tts).
CAP_LIST = os.environ.get(
    "CAP_LIST",
    "flux-schnell,flux-dev,nano-banana,recraft-v4,ltx-t2v,seedance-mini-t2v,gemini-tts",
).split(",")


def _frac(pi):
    if pi is None or pi.pixelsPerUnit == 0:
        return None
    return Fraction(pi.pricePerUnit, pi.pixelsPerUnit)


def _price(pi):
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
    from livepeer_gateway import lp_rpc_pb2
    from livepeer_gateway.capabilities import byoc_capabilities_from_app
    from livepeer_gateway.orch_info import get_orch_info

    advertised = {}
    try:
        for c in json.load(open(CAPS_JSON)):
            advertised[c["name"]] = c
    except Exception:
        pass

    parsed = urllib.parse.urlparse(SIGNER_URL)
    signer_origin = f"{parsed.scheme}://{parsed.netloc}"

    results = []
    for cap in CAP_LIST:
        cap = cap.strip()
        if not cap:
            continue
        row = {"cap": cap}
        adv = advertised.get(cap, {})
        row["unit_kind"] = adv.get("unit_kind")
        row["display_unit"] = adv.get("display_unit")
        row["display_price_usd"] = adv.get("display_price_usd")
        # advertised base per-unit price (scaled) from SDK /capabilities
        ppu = adv.get("price_per_unit")
        scale = adv.get("price_scaling") or 1
        adv_base = Fraction(ppu, scale) if ppu is not None else None
        row["adv_base"] = str(adv_base) if adv_base is not None else None
        row["adv_x_overhead"] = str(adv_base * Fraction(101, 100)) if adv_base is not None else None

        try:
            byoc_caps = byoc_capabilities_from_app(cap)
            info = get_orch_info(ORCH, signer_url=SIGNER_URL, signer_headers=headers, capabilities=byoc_caps)
            orch_price = info.price_info if info.HasField("price_info") else None
            row["orch_PriceInfo"] = _price(orch_price)
            row["orch_recipient"] = "0x" + info.address.hex()
        except Exception as exc:
            row["orch_err"] = str(exc)[:200]
            results.append(row)
            print(json.dumps(row)); print("-" * 60)
            continue

        # generate-live-payment
        payload = {
            "orchestrator": base64.b64encode(info.SerializeToString()).decode("ascii"),
            "type": "byoc",
            "capabilities": base64.b64encode(byoc_caps.SerializeToString()).decode("ascii"),
        }
        req = urllib.request.Request(
            f"{signer_origin}/generate-live-payment",
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json", "Livepeer-Capability": cap, **headers},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                pay = json.loads(r.read())
            row["paygen_http"] = 200
        except urllib.error.HTTPError as e:
            row["paygen_http"] = e.code
            row["paygen_err"] = e.read().decode()[:200]
            results.append(row)
            print(json.dumps(row)); print("-" * 60)
            continue

        raw = base64.b64decode(pay["payment"])
        payment = lp_rpc_pb2.Payment()
        payment.ParseFromString(raw)
        exp = payment.expected_price if payment.HasField("expected_price") else None
        row["ExpectedPrice"] = _price(exp)
        row["sender"] = "0x" + payment.sender.hex()
        # price match orch (requested cap) vs payment expected price
        of = _frac(orch_price)
        ef = _frac(exp)
        row["price_match_orch"] = (of == ef) if (of is not None and ef is not None) else None
        # payment expected price vs advertised base × overhead
        if ef is not None and adv_base is not None:
            row["match_advertised_x_overhead"] = (ef == adv_base * Fraction(101, 100))
        results.append(row)
        print(json.dumps(row)); print("-" * 60)

    print("\n===== SUMMARY TABLE =====")
    print(f"{'cap':<20}{'unit':<12}{'usd':<10}{'orchPrice':<14}{'ExpPrice':<14}{'match':<7}{'advOK':<7}{'paygen'}")
    for r in results:
        print(f"{r['cap']:<20}{str(r.get('unit_kind')):<12}{str(r.get('display_price_usd')):<10}"
              f"{str(r.get('orch_PriceInfo','-')):<14}{str(r.get('ExpectedPrice','-')):<14}"
              f"{str(r.get('price_match_orch','-')):<7}{str(r.get('match_advertised_x_overhead','-')):<7}"
              f"{r.get('paygen_http', r.get('orch_err','ERR'))}")
    json.dump(results, open("/tmp/run53_results.json", "w"), indent=1)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
