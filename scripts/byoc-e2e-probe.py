#!/usr/bin/env python3
"""BYOC E2E probe for Run 29 — requires NAAP_KEY env (naap_… key with validate front door ON)."""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

NAAP_VALIDATE = os.environ.get(
    "NAAP_VALIDATE_URL", "https://operator.livepeer.org/api/v1/keys/validate"
)
DMZ = os.environ.get("BYOC_SIGNER_URL", "https://pymthouse-production.up.railway.app")
ORCH = os.environ.get("BYOC_ORCH_URL", "https://byoc-staging-1.daydream.monster:8935")
CAP = os.environ.get("BYOC_CAPABILITY", "flux-schnell")


def _post(url: str, body: dict, headers: dict | None = None) -> tuple[int, str]:
    data = json.dumps(body).encode()
    hdrs = {"Content-Type": "application/json", **(headers or {})}
    req = urllib.request.Request(url, data=data, headers=hdrs, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.status, resp.read().decode("utf-8", errors="replace")[:500]
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", errors="replace")[:500]


def main() -> int:
    naap_key = os.environ.get("NAAP_KEY", "").strip()
    if not naap_key:
        print("SKIP: set NAAP_KEY to run integration probes")
        return 2

    # Front door requires Authorization: Bearer naap_… (not JSON {key}).
    code, body = _post(NAAP_VALIDATE, {}, headers={"Authorization": f"Bearer {naap_key}"})
    print(f"validate: HTTP {code}")
    if code != 200:
        print(body[:300])
        return 1
    data = json.loads(body)
    signer = data.get("data", {}).get("signerSession", {})
    # BYOC_SIGNER_URL overrides validate's signerSession.url (staging canary without routing flip).
    signer_url = os.environ.get("BYOC_SIGNER_URL", "").strip() or signer.get("url", DMZ)
    auth = (signer.get("headers") or {}).get("Authorization", "")
    if not auth:
        print("validate OK but no signerSession Authorization")
        return 1

    headers = {"Authorization": auth}

    # Probe 1: type byoc via gateway (if installed)
    try:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "livepeer-python-gateway", "src"))
        from livepeer_gateway.byoc import ByocJobRequest, submit_byoc_job

        req = ByocJobRequest(capability=CAP, payload={"prompt": "probe", "width": 512, "height": 512})
        try:
            submit_byoc_job(
                req,
                orch_url=ORCH,
                signer_url=signer_url,
                signer_headers=headers,
                timeout=120.0,
            )
            print("submit_byoc_job: PASS")
        except Exception as exc:
            msg = str(exc)
            print(f"submit_byoc_job: FAIL — {msg[:300]}")
            if "invalid job type" in msg:
                print("  → signer PR not deployed yet")
            if "Could not verify job creds" in msg:
                print("  → orch V1 verify PR not deployed yet")
    except ImportError as exc:
        print(f"gateway import skipped: {exc}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
