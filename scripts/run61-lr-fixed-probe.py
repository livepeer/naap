#!/usr/bin/env python3
"""Run 61 — pymthouse signer ``type=fixed`` decisive probe on the clean v0.9.0
live-runner orch ``:8936`` (``liverunner-v09-orch``, VM ``liverunner-staging-1``,
IP 136.66.21.17).

Purpose: CONFIRM EMPIRICALLY whether the deployed pymthouse DMZ signer accepts a
``RemoteType_Fixed`` payment mint for a native single-shot per-cap challenge, or
rejects it (``400 invalid job type`` / other). Prior analysis expects the Jul-11
build ``sha-4214202f`` supports ``lv2v``+``byoc`` but NOT ``fixed`` — this run
catches a possible newer John deploy too.

Flow (native v0.9.0 ``/apps/{runner}/app/generate`` payment-gated single-shot):
  Stage A — native 402 challenge from ``:8936`` (per-cap price, TicketParams,
            AuthToken/SessionId). SHOULD PASS.
  Stage B — POST ``/generate-live-payment`` to the pymthouse signer with
            ``type:"fixed"`` bound to that challenge. THE DECISIVE STEP.
            Records raw HTTP status + full body verbatim.
  Stage C — for the matrix, the same mint with ``type:"byoc"`` and ``type:"lv2v"``
            (read-only comparison; catches signer build drift).

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
import urllib.error
import urllib.parse
import urllib.request

GW = os.environ["GATEWAY_SRC"]
sys.path.insert(0, os.path.abspath(GW))
from livepeer_gateway.capabilities import byoc_capabilities_from_app  # noqa: E402

BEARER = os.environ["COMPOSITE_BEARER"].strip()
SIGNER = os.environ["BYOC_SIGNER_URL"].strip()
APP = os.environ["RUNNER_APP_URL"].rstrip("/")           # …/apps/<id>/app
PAYER = os.environ.get("PAYER_ADDRESS", "0x0000000000000000000000000000000000000000").strip()
CAP = os.environ.get("BYOC_CAPABILITY", "flux-schnell")
PROMPT = os.environ.get("PROMPT", "a small red cube on a white table, studio light")
APP_PATH = os.environ.get("APP_PATH", "/generate")

tok = BEARER[7:].strip() if BEARER.lower().startswith("bearer ") else BEARER
H = {"Authorization": f"Bearer {tok}"}
origin = "{u.scheme}://{u.netloc}".format(u=urllib.parse.urlparse(SIGNER))
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE


def _post(url, data, headers, timeout=120):
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    return urllib.request.urlopen(req, timeout=timeout, context=ctx)


def _decode_orchinfo(pp_b64: str):
    """Best-effort decode of the challenge OrchestratorInfo for evidence."""
    try:
        from livepeer_gateway import lp_rpc_pb2
        raw = base64.b64decode(pp_b64)
        oi = lp_rpc_pb2.OrchestratorInfo()
        oi.ParseFromString(raw)
        price = None
        if oi.HasField("price_info"):
            price = f"{oi.price_info.pricePerUnit}/{oi.price_info.pixelsPerUnit}"
        sess = None
        try:
            sess = oi.auth_token.session_id
        except Exception:
            sess = None
        has_tp = oi.HasField("ticket_params")
        return {"price": price, "session_id": sess, "has_ticket_params": has_tp,
                "recipient": "0x" + oi.address.hex() if oi.address else None}
    except Exception as e:
        return {"decode_err": str(e)[:160]}


print("=" * 74)
print("RUN 61 — pymthouse signer type=fixed decisive probe on :8936")
print(f"  orch app : {APP}{APP_PATH}")
print(f"  signer   : {origin}")
print(f"  cap      : {CAP}")
print("=" * 74)

# ── Stage A: native 402 challenge ───────────────────────────────────────────
body = json.dumps({"prompt": PROMPT}).encode()
chal = None
try:
    _post(f"{APP}{APP_PATH}", body,
          {"Content-Type": "application/json", "Livepeer-Payer-Address": PAYER})
    print("[A challenge] UNEXPECTED non-402 (no payment gate)")
    sys.exit(1)
except urllib.error.HTTPError as e:
    code = e.code
    raw = e.read().decode()
    if code != 402:
        print(f"[A challenge] FAIL HTTP {code}: {raw[:300]}")
        sys.exit(1)
    chal = json.loads(raw)
pp = chal.get("payment_params")
ev = _decode_orchinfo(pp) if pp else {}
print(f"[A challenge] PASS  HTTP 402  payment_params(len={len(pp) if pp else 0})")
print(f"              manifest_id={chal.get('manifest_id')}")
print(f"              per-cap price={ev.get('price')}  session_id={ev.get('session_id')}")
print(f"              ticket_params={ev.get('has_ticket_params')}  recipient={ev.get('recipient')}")

# ── Stage B/C: mint with each type; type=fixed is decisive ───────────────────
caps_b64 = base64.b64encode(byoc_capabilities_from_app(CAP).SerializeToString()).decode()


def mint(sig_type: str) -> dict:
    payload = {"orchestrator": pp, "type": sig_type, "capabilities": caps_b64}
    hdrs = {"Content-Type": "application/json", "Livepeer-Capability": CAP, **H}
    try:
        with _post(f"{origin}/generate-live-payment", json.dumps(payload).encode(), hdrs, 60) as r:
            txt = r.read().decode()
            keys = None
            try:
                keys = list(json.loads(txt).keys())
            except Exception:
                pass
            return {"type": sig_type, "status": r.status, "body_head": txt[:300], "keys": keys}
    except urllib.error.HTTPError as e:
        return {"type": sig_type, "status": e.code, "body": e.read().decode()}
    except Exception as e:
        return {"type": sig_type, "status": "ERR", "body": str(e)[:300]}


print("-" * 74)
print("[B mint type=fixed]  DECISIVE")
r_fixed = mint("fixed")
print(f"   HTTP {r_fixed['status']}")
print(f"   body: {r_fixed.get('body', r_fixed.get('body_head'))}")
if r_fixed.get("keys"):
    print(f"   keys: {r_fixed['keys']}")

print("-" * 74)
print("[C matrix — comparison mints]")
for t in ("byoc", "lv2v"):
    r = mint(t)
    print(f"   type={t:5s} -> HTTP {r['status']}  body: {r.get('body', r.get('body_head'))[:220]}")

# ── Verdict ─────────────────────────────────────────────────────────────────
print("=" * 74)
st = r_fixed["status"]
b = r_fixed.get("body", r_fixed.get("body_head", "")) or ""
if st == 200 and (r_fixed.get("keys")):
    print("VERDICT: type=fixed ACCEPTED (200 mint) — signer supports RemoteType_Fixed")
elif st == 400 and "invalid job type" in b.lower():
    print("VERDICT: type=fixed REJECTED — 400 invalid job type (RemoteType_Fixed NOT supported)")
else:
    print(f"VERDICT: type=fixed -> HTTP {st} (see body above)")
print("=" * 74)

json.dump({"challenge": ev, "fixed": r_fixed}, open("/tmp/run61_fixed.json", "w"), indent=1)
