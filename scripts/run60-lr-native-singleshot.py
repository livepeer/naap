#!/usr/bin/env python3
"""Run 60 — NATIVE v0.9.0 live-runner single-shot e2e (NOT the byoc job path).

Flow (clean v0.9.0 `/apps/{runner_id}/app/{app_path}` payment-gated single-shot):
  1. POST the runner app endpoint with only `Livepeer-Payer-Address` → HTTP 402
     challenge whose body carries `payment_params` = base64 `net.OrchestratorInfo`
     (per-cap `price_info`, `ticket_params`, `auth_token`).
  2. Mint a payment BOUND TO THAT CHALLENGE via the pymthouse signer
     `/generate-live-payment` (pass the challenge OrchestratorInfo) → returns
     `payment` (base64 net.Payment, ExpectedPrice == the per-cap price) AND
     `segCreds` (base64 SegData whose ManifestID == AuthToken.SessionId).
  3. Re-POST with `Livepeer-Payer-Address` + `Livepeer-Payment` + `Livepeer-Segment`
     → orch verifies seg-creds, ProcessPayment (funded reserve), proxies to the fal
     runner → real asset returned.

Env: COMPOSITE_BEARER, BYOC_SIGNER_URL, RUNNER_APP_URL (…/apps/<id>/app),
     PAYER_ADDRESS, GATEWAY_SRC, BYOC_CAPABILITY, PROMPT
"""
from __future__ import annotations
import base64, json, os, ssl, sys, time, urllib.request, urllib.error, urllib.parse

GW = os.environ["GATEWAY_SRC"]; sys.path.insert(0, GW)
from livepeer_gateway.capabilities import byoc_capabilities_from_app

BEARER = os.environ["COMPOSITE_BEARER"].strip()
SIGNER = os.environ["BYOC_SIGNER_URL"].strip()
APP = os.environ["RUNNER_APP_URL"].rstrip("/")            # …/apps/<id>/app
PAYER = os.environ["PAYER_ADDRESS"].strip()
CAP = os.environ.get("BYOC_CAPABILITY", "flux-schnell")
PROMPT = os.environ.get("PROMPT", "a small red cube on a white table, studio light")
APP_PATH = os.environ.get("APP_PATH", "/generate")

tok = BEARER[7:].strip() if BEARER.lower().startswith("bearer ") else BEARER
H = {"Authorization": f"Bearer {tok}"}
origin = "{u.scheme}://{u.netloc}".format(u=urllib.parse.urlparse(SIGNER))
ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE


def _post(url, data, headers, timeout=600):
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    return urllib.request.urlopen(req, timeout=timeout, context=ctx)


# ---- Stage 3a: native challenge -------------------------------------------------
body = json.dumps({"prompt": PROMPT}).encode()
try:
    _post(f"{APP}{APP_PATH}", body, {"Content-Type": "application/json",
                                     "Livepeer-Payer-Address": PAYER})
    print("[3a challenge] unexpected non-402"); sys.exit(1)
except urllib.error.HTTPError as e:
    if e.code != 402:
        print(f"[3a challenge] HTTP {e.code}: {e.read().decode()[:200]}"); sys.exit(1)
    chal = json.loads(e.read().decode())
pp = chal.get("payment_params")
print(f"[3a challenge] 402 OK  payment_params(len={len(pp)})  manifest_id={chal.get('manifest_id')}")

# ---- Stage 3b: mint payment + segCreds bound to the challenge -------------------
caps = byoc_capabilities_from_app(CAP)
SIGNER_TYPE = os.environ.get("SIGNER_TYPE", "byoc").strip()
payload = {"orchestrator": pp, "type": SIGNER_TYPE,
           "capabilities": base64.b64encode(caps.SerializeToString()).decode()}
print(f"[3b sign] signer type={SIGNER_TYPE}")
sc = None
for attempt in range(10):
    try:
        with _post(f"{origin}/generate-live-payment", json.dumps(payload).encode(),
                   {"Content-Type": "application/json", "Livepeer-Capability": CAP, **H}, 60) as r:
            sc = json.loads(r.read().decode()); break
    except urllib.error.HTTPError as e:
        print(f"[3b sign] attempt {attempt}: HTTP {e.code} (flaky signer, retry)"); time.sleep(2)
if not sc:
    print("[3b sign] FAILED all attempts (flaky signer 500)"); sys.exit(2)
pay = sc.get("payment"); seg = sc.get("segCreds")
print(f"[3b sign] 200 OK  payment(len={len(pay) if pay else 0})  segCreds(len={len(seg) if seg else 0})")
if not pay or not seg:
    print("[3b sign] missing payment/segCreds keys:", list(sc.keys())); sys.exit(2)

# ---- Stage 3c: paid native generation ------------------------------------------
hdrs = {"Content-Type": "application/json", "Livepeer-Payer-Address": PAYER,
        "Livepeer-Payment": pay, "Livepeer-Segment": seg}
try:
    with _post(f"{APP}{APP_PATH}", body, hdrs, 600) as r:
        out = r.read().decode()
        print(f"[3c generate] HTTP {r.status}  body(head)={out[:400]}")
        try:
            j = json.loads(out)
            for k in ("image_url", "images", "url", "video_url", "audio_url", "output"):
                if k in j:
                    print(f"[3c generate] ASSET {k}={str(j[k])[:160]}")
        except Exception:
            pass
        print("RESULT: GENERATION_PASS")
except urllib.error.HTTPError as e:
    print(f"[3c generate] HTTP {e.code}: {e.read().decode()[:400]}")
    print("RESULT: GENERATION_FAIL")
