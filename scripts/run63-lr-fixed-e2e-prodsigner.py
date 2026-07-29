#!/usr/bin/env python3
"""Run 63 — NATIVE v0.9.0 live-runner single-shot **paid** e2e via ``type=fixed``
against the **PRODUCTION** pymthouse DMZ signer
``https://pymthouse-production.up.railway.app`` (NOT ``pymthouse-signer-test-
production``) on the clean v0.9.0 orch ``:8936`` (``liverunner-v09-orch``, VM
``liverunner-staging-1``, IP 136.66.21.17).

Context: run61/run62 hit the *test-production* signer, which rejects ``type=fixed``
with ``400 invalid job type``. run62 re-pointed at ``pymthouse-production`` and got
a **200** ``{payment,segCreds,state}`` mint (``numTickets~2``, ``Type:"fixed"``).
This run carries that fixed mint through to **generation + metering**.

Flow (native ``/apps/{runner}/app/generate`` payment-gated single-shot):
  A. native 402 challenge from ``:8936`` (per-cap price, TicketParams, SessionId).
  B. mint ``type:"fixed"`` (+``inPixels:1``) bound to that challenge on the
     PRODUCTION signer -> ``payment`` + ``segCreds`` + ``state``. Decodes numTickets.
  C. paid native re-POST (``Livepeer-Payment`` + ``Livepeer-Segment``) -> real asset.

Test-only. No deploy/rebuild/mutation. Secrets env-only (never echoed).

Env: COMPOSITE_BEARER, BYOC_SIGNER_URL, RUNNER_APP_URL (…/apps/<id>/app),
     PAYER_ADDRESS, GATEWAY_SRC, BYOC_CAPABILITY, PROMPT, APP_PATH
"""
from __future__ import annotations
import base64
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

GW = os.environ["GATEWAY_SRC"]
sys.path.insert(0, os.path.abspath(GW))
from livepeer_gateway.capabilities import byoc_capabilities_from_app  # noqa: E402
from livepeer_gateway import lp_rpc_pb2  # noqa: E402

BEARER = os.environ["COMPOSITE_BEARER"].strip()
SIGNER = os.environ["BYOC_SIGNER_URL"].strip()
APP = os.environ["RUNNER_APP_URL"].rstrip("/")           # …/apps/<id>/app
PAYER = os.environ["PAYER_ADDRESS"].strip()
CAP = os.environ.get("BYOC_CAPABILITY", "flux-schnell")
PROMPT = os.environ.get("PROMPT", "a small red cube on a white table, studio light")
APP_PATH = os.environ.get("APP_PATH", "/generate")

tok = BEARER[7:].strip() if BEARER.lower().startswith("bearer ") else BEARER
H = {"Authorization": f"Bearer {tok}"}
origin = "{u.scheme}://{u.netloc}".format(u=urllib.parse.urlparse(SIGNER))
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

NOTABLE_HDRS = ("server", "content-type", "content-length", "x-railway-request-id",
                "x-railway-edge", "date")


def _post(url, data, headers, timeout=600):
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    return urllib.request.urlopen(req, timeout=timeout, context=ctx)


def _hdrs(msg):
    return {k.lower(): v for (k, v) in msg.items() if k.lower() in NOTABLE_HDRS}


print("=" * 74)
print("RUN 63 — type=fixed PAID native e2e via PRODUCTION signer on :8936")
print(f"  orch app : {APP}{APP_PATH}")
print(f"  signer   : {origin}")
print(f"  cap      : {CAP}")
print("=" * 74)

# ── Stage A: native 402 challenge ───────────────────────────────────────────
body = json.dumps({"prompt": PROMPT}).encode()
try:
    _post(f"{APP}{APP_PATH}", body,
          {"Content-Type": "application/json", "Livepeer-Payer-Address": PAYER})
    print("[A challenge] UNEXPECTED non-402 (no payment gate)")
    sys.exit(1)
except urllib.error.HTTPError as e:
    if e.code != 402:
        print(f"[A challenge] FAIL HTTP {e.code}: {e.read().decode()[:300]}")
        sys.exit(1)
    chal = json.loads(e.read().decode())
pp = chal.get("payment_params")
print(f"[A challenge] PASS  HTTP 402  payment_params(len={len(pp) if pp else 0})  manifest_id={chal.get('manifest_id')}")

# ── Stage B: mint type=fixed (+inPixels:1) bound to the challenge ────────────
caps_b64 = base64.b64encode(byoc_capabilities_from_app(CAP).SerializeToString()).decode()
payload = {"orchestrator": pp, "type": "fixed", "capabilities": caps_b64, "inPixels": 1}
hdrs = {"Content-Type": "application/json", "Livepeer-Capability": CAP, **H}
sc = None
for attempt in range(6):
    try:
        with _post(f"{origin}/generate-live-payment", json.dumps(payload).encode(), hdrs, 60) as r:
            sc = json.loads(r.read().decode())
            print(f"[B mint fixed] PASS  HTTP {r.status}  keys={list(sc.keys())}  hdrs={json.dumps(_hdrs(r.headers))}")
            break
    except urllib.error.HTTPError as e:
        print(f"[B mint fixed] attempt {attempt}: HTTP {e.code}  body={e.read().decode()[:200]}")
        time.sleep(2)
if not sc:
    print("[B mint fixed] FAILED all attempts")
    sys.exit(2)
pay, seg = sc.get("payment"), sc.get("segCreds")
try:
    p = lp_rpc_pb2.Payment()
    p.ParseFromString(base64.b64decode(pay))
    print(f"[B mint fixed] sender=0x{p.sender.hex()}  numTickets={len(list(p.ticket_sender_params))}  "
          f"expected_price={p.expected_price.pricePerUnit}/{p.expected_price.pixelsPerUnit}")
except Exception as ex:
    print(f"[B mint fixed] payment decode err: {ex}")

# ── Stage C: paid native generation ─────────────────────────────────────────
gen_hdrs = {"Content-Type": "application/json", "Livepeer-Payer-Address": PAYER,
            "Livepeer-Payment": pay, "Livepeer-Segment": seg}
result = {"stage": "C"}
try:
    with _post(f"{APP}{APP_PATH}", body, gen_hdrs, 600) as r:
        out = r.read().decode()
        result.update({"status": r.status, "headers": _hdrs(r.headers), "body": out})
        print(f"[C generate] HTTP {r.status}  headers={json.dumps(_hdrs(r.headers))}")
        print(f"[C generate] body(verbatim, head 800): {out[:800]}")
        try:
            j = json.loads(out)
            for k in ("image_url", "images", "url", "video_url", "audio_url", "output", "media_url"):
                if k in j:
                    print(f"[C generate] ASSET {k}={str(j[k])[:200]}")
        except Exception:
            pass
        print("RESULT: GENERATION_PASS")
except urllib.error.HTTPError as e:
    eb = e.read().decode()
    result.update({"status": e.code, "headers": _hdrs(e.headers), "body": eb})
    print(f"[C generate] HTTP {e.code}  headers={json.dumps(_hdrs(e.headers))}")
    print(f"[C generate] body(verbatim): {eb[:800]}")
    print("RESULT: GENERATION_FAIL")

json.dump(result, open("/tmp/run63_fixed_e2e.json", "w"), indent=1)
