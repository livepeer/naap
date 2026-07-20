#!/usr/bin/env python3
"""Run 50 — direct BYOC signer-path probe using a composite session bundle.

Bypasses the NaaP `naap_` validate front door entirely: feeds the decoded
signer-session bundle (signer_url + composite Authorization bearer) straight
into the gateway `submit_byoc_job` chain. This isolates whether the composite
`app_<24hex>_pmth_<secret>` bearer passes the pymthouse remote-signer webhook
auth and whether payment generation + BYOC image generation complete.

Secrets come from env only (never echoed in full, never committed):
  BYOC_SIGNER_URL      decoded signer base url
  COMPOSITE_BEARER     "Bearer app_<24hex>_pmth_<secret>"
  BYOC_ORCH_URL        orchestrator (default byoc-staging-1)
  BYOC_CAPABILITY      capability (default flux-schnell)
  GATEWAY_SRC          path to livepeer-python-gateway/src
"""
from __future__ import annotations

import os
import sys
import time

SIGNER_URL = os.environ.get("BYOC_SIGNER_URL", "").strip()
BEARER = os.environ.get("COMPOSITE_BEARER", "").strip()
ORCH = os.environ.get("BYOC_ORCH_URL", "https://byoc-staging-1.daydream.monster:8935").strip()
CAP = os.environ.get("BYOC_CAPABILITY", "flux-schnell").strip()
GATEWAY_SRC = os.environ.get(
    "GATEWAY_SRC",
    os.path.join(os.path.dirname(__file__), "..", "..", "livepeer-python-gateway", "src"),
)


def _mask(bearer: str) -> str:
    if not bearer:
        return "<empty>"
    return bearer[:40] + "..." + bearer[-6:]


def main() -> int:
    if not SIGNER_URL or not BEARER:
        print("SKIP: set BYOC_SIGNER_URL and COMPOSITE_BEARER env vars")
        return 2

    print(f"signer_url : {SIGNER_URL}")
    print(f"orch_url   : {ORCH}")
    print(f"capability : {CAP}")
    print(f"bearer     : {_mask(BEARER)}")

    sys.path.insert(0, os.path.abspath(GATEWAY_SRC))
    from livepeer_gateway.byoc import ByocJobRequest, submit_byoc_job

    headers = {"Authorization": BEARER}
    req = ByocJobRequest(
        capability=CAP,
        payload={"prompt": "a red fox in a snowy forest, cinematic", "width": 512, "height": 512},
    )

    t0 = time.time()
    try:
        resp = submit_byoc_job(
            req,
            orch_url=ORCH,
            signer_url=SIGNER_URL,
            signer_headers=headers,
            timeout=180.0,
        )
        dt = time.time() - t0
        print(f"submit_byoc_job: PASS ({dt:.1f}s) HTTP {resp.status_code}")
        print(f"  orch     : {resp.orchestrator_url}")
        print(f"  balance  : {resp.balance}")
        img = resp.image_url
        print(f"  image_url: {img}")
        if not img:
            print(f"  data(500): {str(resp.data)[:500]}")
        return 0
    except Exception as exc:
        dt = time.time() - t0
        msg = str(exc)
        print(f"submit_byoc_job: FAIL ({dt:.1f}s) — {msg[:400]}")
        low = msg.lower()
        if "not a jwt" in low:
            print("  -> webhook auth REJECTED composite bearer (#255 still needed)")
        elif "incompleteread" in low:
            print("  -> payment gen truncated (reserve/signer payment bug; auth likely passed)")
        elif "invalid job type" in low:
            print("  -> signer type:byoc gate not deployed")
        elif "could not verify job creds" in low:
            print("  -> orch V1 verify (#3980) missing")
        elif "reserve" in low:
            print("  -> sender reserve unfunded")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
