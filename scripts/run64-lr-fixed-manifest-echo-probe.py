#!/usr/bin/env python3
"""Run 64 — NATIVE v0.9.0 live-runner ``type=fixed`` **manifest-echo** confirming
probe against the **PRODUCTION** pymthouse DMZ signer
``https://pymthouse-production.up.railway.app`` (remote_ip ``69.46.46.126``) on the
clean v0.9.0 orch ``:8936`` (``liverunner-v09-orch``, VM ``liverunner-staging-1``,
IP 136.66.21.17).

WHY THIS RUN EXISTS
-------------------
``run63`` hand-built the ``/generate-live-payment`` request and **OMITTED the
``ManifestID`` field entirely** (``run63`` L92 payload has no ``ManifestID`` key).
That empty field is the *one and only* condition under which a pre-#4006 signer
mints a fresh ``RandomManifestID()`` (``remote_signer.go`` ~L401/L437) — producing
the observed ``segCreds.manifestId = 8d6eea88 != session_id 381b5a15`` and the
downstream orch ``403 mismatched manifest and auth token`` (``ai_http.go`` L284).

The real SDK does NOT omit it: it reads the orch challenge ``manifest_id``
(= ``AuthToken.SessionId``, ``ai_http.go`` L448), and forwards it to the signer as
``ManifestID`` (``live_runner.py`` L851 -> ``remote_signer.py`` L298). The signer
COPIES ``req.ManifestID`` (``remote_signer.go`` L401), so ``segCreds.manifestId``
should then EQUAL ``session_id`` and the 403 should not arise.

THE ONE SUBSTANTIVE CHANGE VS run63
-----------------------------------
Build the Stage-B sign request with ``ManifestID`` explicitly POPULATED to the
challenge's ``session_id`` (exactly what the real SDK forwards) instead of omitting
it. Everything else mirrors run63.

VERDICT LOGIC (see PR4006-NECESSITY-INVESTIGATION.md, verdict A)
---------------------------------------------------------------
  * decoded ``segCreds.manifestId == session_id``  -> signer ECHOES a supplied
    ManifestID. #4006 is NOT necessary; the earlier 403 was purely the run63
    harness omission. => verdict (A) EMPIRICALLY CONFIRMED.
  * decoded ``segCreds.manifestId != session_id``  -> signer ignores a populated
    ManifestID. verdict (A) is REFUTED; #4006 (or equivalent) IS needed. => FLAG.

Flow (native ``/apps/{runner}/app/generate`` payment-gated single-shot):
  A. native 402 challenge from ``:8936`` (per-cap price, TicketParams, SessionId,
     challenge ``manifest_id``). Captures ``session_id`` from both the JSON
     ``manifest_id`` field and the decoded ``OrchestratorInfo.auth_token``.
  B. mint ``type:"fixed"`` (+``inPixels:1``) **WITH ``ManifestID=session_id``**
     bound to that challenge on the PRODUCTION signer -> ``payment`` + ``segCreds``
     + ``state``. Decodes numTickets + expected_price + ``segCreds.manifestId``,
     and asserts ``manifestId == session_id``.
  C. paid native re-POST (``Livepeer-Payment`` + ``Livepeer-Segment``) -> observe
     whether the 403 is GONE (success / different downstream error).

FAIL-SAFE / SPEND
-----------------
Read/test-only. The orch verifies ``segCreds`` BEFORE ``ProcessPayment``/ticket
redemption, so a rejected mint spends nothing. As an extra hard guard this script
ABORTS Stage C if the minted payment carries more than ``MAX_TICKETS`` tickets
(env ``MAX_TICKETS``, default 5) — the fixed path is expected to mint ~2. Expected
actual spend: ``$0.00`` (fixed price ~$0.00315 per unit; a single successful
single-shot generation would be a fraction of a cent, well under any cap).

No deploy/rebuild/mutation. Secrets env-only (never echoed). ``byoc-staging-1`` /
``sdk-staging-1`` are NOT touched (this is a direct native probe, no SDK container).

Env: COMPOSITE_BEARER, BYOC_SIGNER_URL, RUNNER_APP_URL (…/apps/<id>/app),
     PAYER_ADDRESS, GATEWAY_SRC, BYOC_CAPABILITY, PROMPT, APP_PATH, MAX_TICKETS
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
MAX_TICKETS = int(os.environ.get("MAX_TICKETS", "5"))    # fail-safe cap

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


def _decode_session_id(pp_b64: str):
    """Decode the challenge OrchestratorInfo.auth_token.session_id for evidence."""
    try:
        oi = lp_rpc_pb2.OrchestratorInfo()
        oi.ParseFromString(base64.b64decode(pp_b64))
        return oi.auth_token.session_id or None
    except Exception as e:  # pragma: no cover - best effort
        return f"<decode_err: {str(e)[:120]}>"


print("=" * 74)
print("RUN 64 — type=fixed manifest-ECHO confirming probe (PRODUCTION signer, :8936)")
print(f"  orch app : {APP}{APP_PATH}")
print(f"  signer   : {origin}")
print(f"  cap      : {CAP}")
print("  change vs run63: sign request ManifestID = challenge session_id (populated)")
print("=" * 74)

result: dict = {"run": "run64", "signer": origin, "orch_app": f"{APP}{APP_PATH}"}

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
chal_manifest_id = chal.get("manifest_id")          # orch sets this == AuthToken.SessionId
decoded_session_id = _decode_session_id(pp) if pp else None
# The value the real SDK forwards is exactly the challenge manifest_id.
session_id = chal_manifest_id or decoded_session_id
result["A"] = {"http": 402, "payment_params_len": len(pp) if pp else 0,
               "challenge_manifest_id": chal_manifest_id,
               "decoded_session_id": decoded_session_id}
print(f"[A challenge] PASS  HTTP 402  payment_params(len={len(pp) if pp else 0})")
print(f"              challenge manifest_id = {chal_manifest_id}")
print(f"              decoded  session_id   = {decoded_session_id}")
if not session_id:
    print("[A challenge] FAIL — no session_id/manifest_id to bind; cannot run echo probe")
    sys.exit(1)

# ── Stage B: mint type=fixed (+inPixels:1) WITH ManifestID = session_id ──────
caps_b64 = base64.b64encode(byoc_capabilities_from_app(CAP).SerializeToString()).decode()
# *** THE ONE SUBSTANTIVE CHANGE VS run63: populate ManifestID (run63 omitted it) ***
payload = {"orchestrator": pp, "type": "fixed", "capabilities": caps_b64,
           "inPixels": 1, "ManifestID": session_id}
print("-" * 74)
print(f"[B mint fixed] sign payload keys = {list(payload.keys())}  (ManifestID populated)")
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
    result["B"] = {"error": "mint_failed"}
    json.dump(result, open("/tmp/run64_fixed_echo.json", "w"), indent=1)
    sys.exit(2)
pay, seg = sc.get("payment"), sc.get("segCreds")

# decode payment (sender / numTickets / expected_price)
num_tickets = None
try:
    p = lp_rpc_pb2.Payment()
    p.ParseFromString(base64.b64decode(pay))
    num_tickets = len(list(p.ticket_sender_params))
    print(f"[B mint fixed] sender=0x{p.sender.hex()}  numTickets={num_tickets}  "
          f"expected_price={p.expected_price.pricePerUnit}/{p.expected_price.pixelsPerUnit}")
    result["B_payment"] = {"sender": "0x" + p.sender.hex(), "numTickets": num_tickets,
                           "expected_price": f"{p.expected_price.pricePerUnit}/{p.expected_price.pixelsPerUnit}"}
except Exception as ex:
    print(f"[B mint fixed] payment decode err: {ex}")

# *** THE DECISIVE DECODE: segCreds.manifestId vs challenge session_id ***
minted_manifest = None
seg_session = None
try:
    sd = lp_rpc_pb2.SegData()
    sd.ParseFromString(base64.b64decode(seg))
    minted_manifest = sd.manifestId
    seg_session = sd.auth_token.session_id or None
except Exception as ex:
    print(f"[B mint fixed] segCreds decode err: {ex}")
echoed = (minted_manifest is not None and minted_manifest == session_id)
result["B_segcreds"] = {"minted_manifestId": minted_manifest,
                        "segcreds_session_id": seg_session,
                        "challenge_session_id": session_id,
                        "manifestId_equals_session_id": echoed}
print("-" * 74)
print(f"[B DECODE] segCreds.manifestId      = {minted_manifest}")
print(f"[B DECODE] segCreds.auth.session_id = {seg_session}")
print(f"[B DECODE] challenge  session_id    = {session_id}")
print(f"[B DECODE] manifestId == session_id ? {echoed}")
if echoed:
    print("[B VERDICT] ECHOED — signer copied the supplied ManifestID. "
          "This empirically CONFIRMS verdict (A): #4006 is NOT necessary; "
          "the earlier 403 was the run63 harness omission.")
else:
    print("[B VERDICT] *** NOT ECHOED *** — signer ignored a populated ManifestID. "
          "verdict (A) is REFUTED; #4006 (or equivalent) IS needed. FLAG LOUDLY.")

# ── fail-safe guard before spending anything ────────────────────────────────
if num_tickets is not None and num_tickets > MAX_TICKETS:
    print(f"[SAFETY ABORT] numTickets {num_tickets} > MAX_TICKETS {MAX_TICKETS}; "
          "aborting BEFORE generation to stay under cap. No spend.")
    result["C"] = {"skipped": "numTickets_over_cap", "numTickets": num_tickets,
                   "max_tickets": MAX_TICKETS}
    json.dump(result, open("/tmp/run64_fixed_echo.json", "w"), indent=1)
    sys.exit(0)

# ── Stage C: paid native generation ─────────────────────────────────────────
gen_hdrs = {"Content-Type": "application/json", "Livepeer-Payer-Address": PAYER,
            "Livepeer-Payment": pay, "Livepeer-Segment": seg}
print("-" * 74)
try:
    with _post(f"{APP}{APP_PATH}", body, gen_hdrs, 600) as r:
        out = r.read().decode()
        result["C"] = {"status": r.status, "headers": _hdrs(r.headers), "body": out[:2000]}
        print(f"[C generate] HTTP {r.status}  headers={json.dumps(_hdrs(r.headers))}")
        print(f"[C generate] body(verbatim, head 800): {out[:800]}")
        try:
            j = json.loads(out)
            for k in ("image_url", "images", "url", "video_url", "audio_url", "output", "media_url"):
                if k in j:
                    print(f"[C generate] ASSET {k}={str(j[k])[:200]}")
        except Exception:
            pass
        print("RESULT: GENERATION_PASS (403 is GONE)")
        result["C"]["verdict"] = "GENERATION_PASS"
except urllib.error.HTTPError as e:
    eb = e.read().decode()
    result["C"] = {"status": e.code, "headers": _hdrs(e.headers), "body": eb[:2000]}
    print(f"[C generate] HTTP {e.code}  headers={json.dumps(_hdrs(e.headers))}")
    print(f"[C generate] body(verbatim): {eb[:800]}")
    is403mismatch = (e.code == 403 and "mismatched manifest" in eb.lower())
    if is403mismatch:
        print("RESULT: STILL_403_MANIFEST_MISMATCH — verdict (A) would be REFUTED. FLAG.")
        result["C"]["verdict"] = "STILL_403_MANIFEST_MISMATCH"
    else:
        print(f"RESULT: GENERATION_FAIL (DIFFERENT downstream error, not the manifest 403): HTTP {e.code}")
        result["C"]["verdict"] = "DIFFERENT_DOWNSTREAM_ERROR"

# ── final one-line verdict ──────────────────────────────────────────────────
print("=" * 74)
c_verdict = result.get("C", {}).get("verdict", "n/a")
print(f"FINAL: manifestId==session_id? {echoed}  |  Stage C: {c_verdict}")
print("=" * 74)
json.dump(result, open("/tmp/run64_fixed_echo.json", "w"), indent=1)
print("wrote /tmp/run64_fixed_echo.json")
