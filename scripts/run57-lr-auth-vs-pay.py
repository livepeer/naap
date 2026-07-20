#!/usr/bin/env python3
"""Run 57 — explicit auth-vs-payment stage split on the LR-orch path.

Proves, with the composite bearer (PR #430 design):
  - /sign-orchestrator-info (unbilled auth gate) -> 200  (composite ACCEPTED)
  - /generate-live-payment  (billed)             -> exact status + body

Env: COMPOSITE_BEARER, BYOC_SIGNER_URL, LR_ORCH, GATEWAY_SRC
"""
from __future__ import annotations
import base64, json, os, sys, urllib.request, urllib.error, urllib.parse

BEARER = os.environ["COMPOSITE_BEARER"].strip()
SIGNER = os.environ["BYOC_SIGNER_URL"].strip()
LR = os.environ.get("LR_ORCH", "https://liverunner-staging-1.daydream.monster:8935").strip()
GW = os.environ["GATEWAY_SRC"]
CAP = os.environ.get("BYOC_CAPABILITY", "flux-schnell")

sys.path.insert(0, os.path.abspath(GW))
from livepeer_gateway.capabilities import byoc_capabilities_from_app
from livepeer_gateway.orch_info import get_orch_info

tok = BEARER[7:].strip() if BEARER.lower().startswith("bearer ") else BEARER
H = {"Authorization": f"Bearer {tok}"}
origin = "{u.scheme}://{u.netloc}".format(u=urllib.parse.urlparse(SIGNER))
byoc_caps = byoc_capabilities_from_app(CAP)

# get_orch_info internally calls /sign-orchestrator-info against the signer with the composite bearer.
info = get_orch_info(LR, signer_url=SIGNER, signer_headers=H, capabilities=byoc_caps)
print(f"[STAGE signer-auth] /sign-orchestrator-info via get_orch_info: PASS 200 "
      f"(composite ACCEPTED) recipient=0x{info.address.hex()[:12]} "
      f"PriceInfo={info.price_info.pricePerUnit if info.HasField('price_info') else '<none>'}/"
      f"{info.price_info.pixelsPerUnit if info.HasField('price_info') else '-'}")

# Now the billed endpoint with the same composite bearer.
payload = {
    "orchestrator": base64.b64encode(info.SerializeToString()).decode(),
    "type": "byoc",
    "capabilities": base64.b64encode(byoc_caps.SerializeToString()).decode(),
}
req = urllib.request.Request(
    f"{origin}/generate-live-payment",
    data=json.dumps(payload).encode(),
    headers={"Content-Type": "application/json", "Livepeer-Capability": CAP, **H},
    method="POST",
)
try:
    with urllib.request.urlopen(req, timeout=60) as r:
        print(f"[STAGE payment] /generate-live-payment: HTTP {r.status} (unexpected PASS)")
except urllib.error.HTTPError as e:
    body = e.read().decode()[:200]
    verdict = "AUTH-REJECT (#430 regression)" if "not a jwt" in body.lower() else \
              "LR CONFIG (zero price)" if "priceinfo" in body.lower() else "OTHER"
    print(f"[STAGE payment] /generate-live-payment: HTTP {e.code} body={body.strip()} -> {verdict}")
