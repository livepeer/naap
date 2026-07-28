#!/usr/bin/env python3
"""Run 58 — full billed generation against the NEW live-runner-v2 orch on a non-8935 port.

Reuses the real gateway ``submit_byoc_job`` end-to-end (sign job -> get_orch_info ->
/generate-live-payment -> POST /process/request), but corrects one production
assumption: ``byoc._create_byoc_payment`` hardcodes the gRPC discovery port to
``:8935`` (``grpc_url = https://{hostname}:8935``). The live-runner-v2 orch is
brought up ADDITIVELY on ``:8936`` (so it does not collide with the existing
:8935 orch), so we patch ``orch_info.get_orch_info`` to rewrite ``:8935`` -> the
orch's real port for this process only. Everything else (payment, /process HTTP)
already honors the given orch_url port.

Env: BYOC_SIGNER_URL, COMPOSITE_BEARER, BYOC_ORCH_URL (the :8936 orch),
     BYOC_CAPABILITY, GATEWAY_SRC.
"""
from __future__ import annotations

import os
import sys
import time
from urllib.parse import urlparse

SIGNER_URL = os.environ["BYOC_SIGNER_URL"].strip()
BEARER = os.environ["COMPOSITE_BEARER"].strip()
ORCH = os.environ["BYOC_ORCH_URL"].strip()
CAP = os.environ.get("BYOC_CAPABILITY", "flux-schnell").strip()
GATEWAY_SRC = os.environ["GATEWAY_SRC"]

sys.path.insert(0, os.path.abspath(GATEWAY_SRC))

# Point the (otherwise :8935-hardcoded) gRPC discovery at the new orch's real port.
_orch_port = urlparse(ORCH if "://" in ORCH else f"https://{ORCH}").port or 8935
import livepeer_gateway.orch_info as _oi  # noqa: E402

_real_get_orch_info = _oi.get_orch_info


def _port_corrected_get_orch_info(orch_url, **kwargs):
    if _orch_port != 8935:
        orch_url = orch_url.replace(":8935", f":{_orch_port}")
    return _real_get_orch_info(orch_url, **kwargs)


_oi.get_orch_info = _port_corrected_get_orch_info

from livepeer_gateway.byoc import ByocJobRequest, submit_byoc_job  # noqa: E402


def main() -> int:
    print(f"orch_url   : {ORCH} (gRPC discovery port -> {_orch_port})")
    print(f"capability : {CAP}")
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
            signer_headers={"Authorization": BEARER},
            timeout=180.0,
        )
        dt = time.time() - t0
        print(f"submit_byoc_job: PASS ({dt:.1f}s) HTTP {resp.status_code}")
        print(f"  orch     : {resp.orchestrator_url}")
        print(f"  balance  : {resp.balance}")
        print(f"  image_url: {resp.image_url}")
        if not resp.image_url:
            print(f"  data(500): {str(resp.data)[:500]}")
        return 0 if resp.image_url else 1
    except Exception as exc:
        dt = time.time() - t0
        print(f"submit_byoc_job: FAIL ({dt:.1f}s) — {str(exc)[:400]}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
