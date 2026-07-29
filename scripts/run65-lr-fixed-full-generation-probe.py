#!/usr/bin/env python3
"""Run 65 — FINAL closing e2e probe: NATIVE v0.9.0 live-runner ``type=fixed``
**FULL GENERATION + METERING** probe against the PRODUCTION pymthouse DMZ signer
``https://pymthouse-production.up.railway.app`` (remote_ip ``69.46.46.126``) on the
clean v0.9.0 orch ``:8936`` (``liverunner-v09-orch``, VM ``liverunner-staging-1``,
IP 136.66.21.17).

WHY THIS RUN EXISTS (continuation of run64)
-------------------------------------------
``run64`` proved every link GREEN except the final generation: validate→prod
signer, discovery/price (``1641786221713/1``), 402 challenge, ``type=fixed`` mint
(HTTP 200, numTickets=2), and the manifest binding (``segCreds.manifestId ==
session_id`` → the 403 is RESOLVED). ``run64`` stopped at ``400 model_id is
required`` because its native generation payload sent only ``{"prompt": …}`` and
omitted ``model_id`` — the fal-app runner (`_handle_generate`) requires it. THAT
is the single remaining gap this run closes.

THE SUBSTANTIVE CHANGES VS run64
--------------------------------
1. DERIVE (not guess) the runner ``model_id`` from what the orch/runner actually
   advertises:
     - GET ``:8936/discovery`` → find the runner for the fixed cap under test →
       read its ``app`` (e.g. ``storyboard/fal-flux-schnell``) + ``price_info``.
     - Load the DEPLOYED capability descriptor (``runners.json``, byte-identical
       to what ``:8936`` mounts) → resolve ``app`` → ``capability.name`` +
       ``io.endpoint`` + required ``io.inputs``.
     - Resolve the fal ``model_id`` from the SDK's authoritative offering table
       (``lr_offerings.load_offerings`` over ``LR_MODEL_IDS`` extracted from the
       deployed SDK ``app.py`` via ``ast`` — the exact map the production SDK
       injects), then build the runner body via ``lr_offerings.build_lr_payload``.
   The full resolution chain (app → cap → model_id) is logged.
2. Send the paid generation request WITH ``model_id`` populated (plus ``prompt``
   and any other required runner fields), carrying the accepted ``type=fixed``
   mint (``ManifestID = session_id``, exactly as run64).
3. HARD SPEND CAP (~$1): keep the ``MAX_TICKETS`` fail-safe AND compute the mint's
   expected total USD from the descriptor's ``$/wei`` ratio; ABORT before
   generation if it would exceed ``MAX_SPEND_USD`` (default $1). faceValue /
   winProb exposure is decoded + reported for transparency.
4. Capture VERBATIM the generation HTTP status, whether a real ASSET is returned
   (url/id/bytes), and any error.
5. METERING VERIFICATION: after a successful generation, attempt to read the
   pymthouse/OpenMeter debit for this app via the documented pymthouse usage API
   (``GET {PYMTHOUSE_APP_URL}/api/v1/apps/{clientId}/usage``) — the same surface
   the NaaP usage-pull reads. Record verbatim whether a usage/debit record
   appeared, the metered quantity / networkFee if available, or an explicit
   "could not read with available creds".

FAIL-SAFE / SPEND
-----------------
The orch verifies ``segCreds`` BEFORE ``ProcessPayment``/ticket redemption. Hard
guards: (a) ABORT if ``numTickets > MAX_TICKETS`` (default 5); (b) ABORT if the
computed expected mint USD ≥ ``MAX_SPEND_USD`` (default $1). Expected actual spend
for a single fixed flux-schnell generation is a fraction of a cent.

No deploy/rebuild/mutation. Secrets env-only (never echoed). ``byoc-staging-1`` /
``sdk-staging-1`` are NOT touched (direct native probe, no SDK container).

Env: COMPOSITE_BEARER, BYOC_SIGNER_URL, RUNNER_APP_URL (…/apps/<id>/app),
     PAYER_ADDRESS, GATEWAY_SRC, SDK_SRC, RUNNERS_JSON, DISCOVERY_URL,
     PYMTHOUSE_APP_URL, PROMPT, APP_PATH, MAX_TICKETS, MAX_SPEND_USD
"""
from __future__ import annotations
import ast
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
PROMPT = os.environ.get("PROMPT", "a small red cube on a white table, studio light")
APP_PATH = os.environ.get("APP_PATH", "/generate")
MAX_TICKETS = int(os.environ.get("MAX_TICKETS", "5"))        # fail-safe cap
MAX_SPEND_USD = float(os.environ.get("MAX_SPEND_USD", "1.0"))  # hard USD cap

# Derivation sources (deployed source-of-truth; overridable via env).
SDK_SRC = os.environ.get(
    "SDK_SRC",
    os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..",
                                 "simple-infra", "sdk-service-build")))
RUNNERS_JSON = os.environ.get(
    "RUNNERS_JSON",
    os.path.abspath(os.path.join(os.path.dirname(__file__), "..",
                                 "live-runner-v2", "runners.json")))
PYMTHOUSE_APP_URL = os.environ.get("PYMTHOUSE_APP_URL", "https://pymthouse.com").rstrip("/")

tok = BEARER[7:].strip() if BEARER.lower().startswith("bearer ") else BEARER
H = {"Authorization": f"Bearer {tok}"}
origin = "{u.scheme}://{u.netloc}".format(u=urllib.parse.urlparse(SIGNER))
# discovery URL: same host/port as the runner app, path /discovery
_ru = urllib.parse.urlparse(APP)
DISCOVERY_URL = os.environ.get("DISCOVERY_URL", f"{_ru.scheme}://{_ru.netloc}/discovery")

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

NOTABLE_HDRS = ("server", "content-type", "content-length", "x-railway-request-id",
                "x-railway-edge", "date")


def _post(url, data, headers, timeout=600):
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    return urllib.request.urlopen(req, timeout=timeout, context=ctx)


def _get(url, headers=None, timeout=60):
    req = urllib.request.Request(url, headers=headers or {}, method="GET")
    return urllib.request.urlopen(req, timeout=timeout, context=ctx)


def _hdrs(msg):
    return {k.lower(): v for (k, v) in msg.items() if k.lower() in NOTABLE_HDRS}


def _decode_session_id(pp_b64: str):
    try:
        oi = lp_rpc_pb2.OrchestratorInfo()
        oi.ParseFromString(base64.b64decode(pp_b64))
        return oi.auth_token.session_id or None
    except Exception as e:  # pragma: no cover - best effort
        return f"<decode_err: {str(e)[:120]}>"


def _b2i(b) -> int:
    """big-endian bytes → int (proto face_value / win_prob are TYPE_BYTES)."""
    return int.from_bytes(b, "big") if b else 0


print("=" * 78)
print("RUN 65 — type=fixed FULL GENERATION + METERING probe (PRODUCTION signer, :8936)")
print(f"  orch app  : {APP}{APP_PATH}")
print(f"  discovery : {DISCOVERY_URL}")
print(f"  signer    : {origin}")
print(f"  pymthouse : {PYMTHOUSE_APP_URL}")
print(f"  guards    : MAX_TICKETS={MAX_TICKETS}  MAX_SPEND_USD=${MAX_SPEND_USD:.2f}")
print("=" * 78)

result: dict = {"run": "run65", "signer": origin, "orch_app": f"{APP}{APP_PATH}"}

# ── Stage 0: DERIVE model_id + capability from discovery + deployed descriptor ──
print("-" * 78)
print("[0 derive] resolving model_id from discovery + capability descriptor …")
runner_id = None
for seg in APP.split("/"):
    if seg.startswith("runner_"):
        runner_id = seg
        break

disco = json.loads(_get(DISCOVERY_URL, timeout=30).read().decode())
runners = []
if isinstance(disco, list):
    for entry in disco:
        runners.extend(entry.get("runners", []) or [])
elif isinstance(disco, dict):
    runners = disco.get("runners", []) or []

# match the discovery runner to our RUNNER_APP_URL (by runner_id in its url).
disco_runner = None
for r in runners:
    url = str(r.get("url", ""))
    if runner_id and runner_id in url:
        disco_runner = r
        break
if disco_runner is None and runners:
    # fall back to exact app-url prefix match
    for r in runners:
        if str(r.get("url", "")).rstrip("/") == APP:
            disco_runner = r
            break
if disco_runner is None:
    print(f"[0 derive] FAIL — could not match runner {runner_id!r} in discovery "
          f"({len(runners)} runners advertised)")
    sys.exit(1)

disco_app = disco_runner.get("app")
disco_price = disco_runner.get("price_info", {})
print(f"[0 derive] discovery: runner={runner_id} app={disco_app!r} "
      f"price_info={json.dumps(disco_price)}")

# capability descriptor (deployed runners.json) → cap name + io + offering price
descriptor = json.load(open(RUNNERS_JSON))
desc_entry = None
for e in descriptor.get("runners", []):
    if e.get("app") == disco_app:
        desc_entry = e
        break
if desc_entry is None:
    print(f"[0 derive] FAIL — app {disco_app!r} not found in descriptor {RUNNERS_JSON}")
    sys.exit(1)
cap = desc_entry["capability"]
cap_name = cap["name"]
io = cap.get("io", {})
gen_endpoint = io.get("endpoint", APP_PATH)
required_inputs = [k for k, v in (io.get("inputs", {}) or {}).items() if v.get("required")]
offer_price = cap.get("offering", {}).get("price", {})
print(f"[0 derive] descriptor: cap.name={cap_name!r} io.endpoint={gen_endpoint!r} "
      f"required_inputs={required_inputs} offering.price={json.dumps(offer_price)}")

# resolve fal model_id from the SDK's authoritative offering table.
sys.path.insert(0, os.path.abspath(SDK_SRC))
import lr_offerings  # noqa: E402
_sdk_app = os.path.join(SDK_SRC, "app.py")
_model_ids = None
for _n in ast.parse(open(_sdk_app).read()).body:
    if isinstance(_n, ast.Assign) and any(getattr(t, "id", None) == "LR_MODEL_IDS"
                                           for t in _n.targets):
        _model_ids = ast.literal_eval(_n.value)
        break
if not _model_ids or cap_name not in _model_ids:
    print(f"[0 derive] FAIL — cap {cap_name!r} not in SDK LR_MODEL_IDS "
          f"({list((_model_ids or {}).keys())})")
    sys.exit(1)
offerings = lr_offerings.load_offerings(_model_ids, None)
offering = offerings[cap_name]
model_id = offering.get("model_id")
gen_body_obj = lr_offerings.build_lr_payload({"prompt": PROMPT}, offering)
print(f"[0 derive] SELECTED  cap={cap_name!r}  model_id={model_id!r}  "
      f"(source: SDK LR_MODEL_IDS via offering table)")
print(f"[0 derive] resolution chain: discovery.app {disco_app!r} → descriptor.cap "
      f"{cap_name!r} → model_id {model_id!r}")
print(f"[0 derive] runner body(verbatim) = {json.dumps(gen_body_obj)}")
result["derive"] = {"runner_id": runner_id, "discovery_app": disco_app,
                    "cap_name": cap_name, "model_id": model_id,
                    "gen_endpoint": gen_endpoint, "required_inputs": required_inputs,
                    "discovery_price_info": disco_price, "offering_price": offer_price,
                    "runner_body": gen_body_obj}
if not model_id:
    print("[0 derive] FAIL — no model_id resolved; cannot close the generation gap")
    sys.exit(1)

# USD/wei ratio from the descriptor's own (display_usd ↔ price_per_unit) pair.
usd_per_wei = None
try:
    d_usd = float(offer_price.get("display_usd"))
    d_wei = float(offer_price.get("price_per_unit"))
    if d_usd > 0 and d_wei > 0:
        usd_per_wei = d_usd / d_wei
        print(f"[0 derive] $/wei from descriptor: {d_usd} USD / {int(d_wei)} wei "
              f"= {usd_per_wei:.6e}  (implied ETH≈${usd_per_wei*1e18:,.0f})")
except Exception as ex:
    print(f"[0 derive] $/wei descriptor derive err: {ex}")

gen_body = json.dumps(gen_body_obj).encode()
# the 402-challenge probe body only needs prompt (matches run64 Stage A).
chal_body = json.dumps({"prompt": PROMPT}).encode()

# ── Stage A: native 402 challenge ───────────────────────────────────────────
print("-" * 78)
try:
    _post(f"{APP}{APP_PATH}", chal_body,
          {"Content-Type": "application/json", "Livepeer-Payer-Address": PAYER})
    print("[A challenge] UNEXPECTED non-402 (no payment gate)")
    sys.exit(1)
except urllib.error.HTTPError as e:
    if e.code != 402:
        print(f"[A challenge] FAIL HTTP {e.code}: {e.read().decode()[:300]}")
        sys.exit(1)
    chal = json.loads(e.read().decode())
pp = chal.get("payment_params")
chal_manifest_id = chal.get("manifest_id")
decoded_session_id = _decode_session_id(pp) if pp else None
session_id = chal_manifest_id or decoded_session_id
result["A"] = {"http": 402, "payment_params_len": len(pp) if pp else 0,
               "challenge_manifest_id": chal_manifest_id,
               "decoded_session_id": decoded_session_id}
print(f"[A challenge] PASS  HTTP 402  payment_params(len={len(pp) if pp else 0})")
print(f"              challenge manifest_id = {chal_manifest_id}")
print(f"              decoded  session_id   = {decoded_session_id}")
if not session_id:
    print("[A challenge] FAIL — no session_id/manifest_id to bind")
    sys.exit(1)

# ── Stage B: mint type=fixed (+inPixels:1) WITH ManifestID = session_id ──────
IN_PIXELS = 1
caps_b64 = base64.b64encode(byoc_capabilities_from_app(cap_name).SerializeToString()).decode()
payload = {"orchestrator": pp, "type": "fixed", "capabilities": caps_b64,
           "inPixels": IN_PIXELS, "ManifestID": session_id}
print("-" * 78)
print(f"[B mint fixed] sign payload keys = {list(payload.keys())}  (ManifestID populated)")
hdrs = {"Content-Type": "application/json", "Livepeer-Capability": cap_name, **H}
sc = None
for attempt in range(6):
    try:
        with _post(f"{origin}/generate-live-payment", json.dumps(payload).encode(), hdrs, 60) as r:
            sc = json.loads(r.read().decode())
            print(f"[B mint fixed] PASS  HTTP {r.status}  keys={list(sc.keys())}  "
                  f"hdrs={json.dumps(_hdrs(r.headers))}")
            break
    except urllib.error.HTTPError as e:
        print(f"[B mint fixed] attempt {attempt}: HTTP {e.code}  body={e.read().decode()[:200]}")
        time.sleep(2)
if not sc:
    print("[B mint fixed] FAILED all attempts")
    result["B"] = {"error": "mint_failed"}
    json.dump(result, open("/tmp/run65_fixed_full.json", "w"), indent=1)
    sys.exit(2)
pay, seg = sc.get("payment"), sc.get("segCreds")

# decode payment (sender / numTickets / expected_price / faceValue / winProb)
num_tickets = None
price_per_unit = pixels_per_unit = None
face_value = win_prob = 0
try:
    p = lp_rpc_pb2.Payment()
    p.ParseFromString(base64.b64decode(pay))
    num_tickets = len(list(p.ticket_sender_params))
    price_per_unit = p.expected_price.pricePerUnit
    pixels_per_unit = p.expected_price.pixelsPerUnit or 1
    face_value = _b2i(p.ticket_params.face_value)
    win_prob = _b2i(p.ticket_params.win_prob)
    print(f"[B mint fixed] sender=0x{p.sender.hex()}  numTickets={num_tickets}  "
          f"expected_price={price_per_unit}/{pixels_per_unit}")
    print(f"[B mint fixed] ticket faceValue={face_value} wei  winProb={win_prob} "
          f"(/2^256)")
    result["B_payment"] = {"sender": "0x" + p.sender.hex(), "numTickets": num_tickets,
                           "expected_price": f"{price_per_unit}/{pixels_per_unit}",
                           "face_value_wei": str(face_value), "win_prob": str(win_prob)}
except Exception as ex:
    print(f"[B mint fixed] payment decode err: {ex}")

# segCreds manifest echo (confirm run64's resolved binding still holds)
minted_manifest = seg_session = None
try:
    sd = lp_rpc_pb2.SegData()
    sd.ParseFromString(base64.b64decode(seg))
    minted_manifest = sd.manifestId.decode() if isinstance(sd.manifestId, bytes) else sd.manifestId
    seg_session = sd.auth_token.session_id or None
except Exception as ex:
    print(f"[B mint fixed] segCreds decode err: {ex}")
echoed = (minted_manifest is not None and minted_manifest == session_id)
result["B_segcreds"] = {"minted_manifestId": minted_manifest,
                        "segcreds_session_id": seg_session,
                        "challenge_session_id": session_id,
                        "manifestId_equals_session_id": echoed}
print(f"[B DECODE] segCreds.manifestId={minted_manifest}  session_id={session_id}  "
      f"echoed={echoed}")

# ── SPEND CAP: compute expected mint USD; assert < MAX_SPEND_USD ─────────────
print("-" * 78)
expected_fee_wei = None
expected_total_wei = None
expected_total_usd = None
face_value_usd = max_exposure_usd = None
if price_per_unit is not None and num_tickets is not None:
    expected_fee_wei = (price_per_unit // (pixels_per_unit or 1)) * IN_PIXELS
    expected_total_wei = expected_fee_wei * num_tickets
    if usd_per_wei:
        expected_fee_usd = expected_fee_wei * usd_per_wei
        expected_total_usd = expected_total_wei * usd_per_wei
        face_value_usd = face_value * usd_per_wei
        max_exposure_usd = face_value_usd * num_tickets
        print(f"[SPEND] expected fee/generation = {expected_fee_wei} wei "
              f"= {expected_fee_wei/1e18:.3e} ETH = ${expected_fee_usd:.6f}")
        print(f"[SPEND] expected mint TOTAL ({num_tickets}× tickets) = "
              f"{expected_total_wei} wei = ${expected_total_usd:.6f}")
        print(f"[SPEND] faceValue exposure (informational): ${face_value_usd:.6f}/ticket, "
              f"max {num_tickets}× = ${max_exposure_usd:.6f} (winProb-gated; EV = fee)")
    else:
        print("[SPEND] WARNING — no $/wei ratio; cannot compute USD. Will rely on "
              "MAX_TICKETS guard only.")
result["spend"] = {"expected_fee_wei": str(expected_fee_wei),
                   "expected_total_wei": str(expected_total_wei),
                   "expected_total_usd": expected_total_usd,
                   "usd_per_wei": usd_per_wei,
                   "face_value_usd": face_value_usd,
                   "max_exposure_usd": max_exposure_usd,
                   "max_spend_usd_cap": MAX_SPEND_USD}

# guard 1: numTickets fail-safe
if num_tickets is not None and num_tickets > MAX_TICKETS:
    print(f"[SAFETY ABORT] numTickets {num_tickets} > MAX_TICKETS {MAX_TICKETS}; "
          "aborting BEFORE generation. No spend.")
    result["C"] = {"skipped": "numTickets_over_cap", "numTickets": num_tickets}
    json.dump(result, open("/tmp/run65_fixed_full.json", "w"), indent=1)
    sys.exit(0)
# guard 2: expected USD cap
if expected_total_usd is not None and expected_total_usd >= MAX_SPEND_USD:
    print(f"[SAFETY ABORT] expected mint total ${expected_total_usd:.6f} >= cap "
          f"${MAX_SPEND_USD:.2f}; aborting BEFORE generation. No spend.")
    result["C"] = {"skipped": "expected_usd_over_cap",
                   "expected_total_usd": expected_total_usd}
    json.dump(result, open("/tmp/run65_fixed_full.json", "w"), indent=1)
    sys.exit(0)
if expected_total_usd is None and usd_per_wei is None:
    # cannot price the mint — only proceed because MAX_TICKETS already bounds it and
    # the fixed flux path is a fraction of a cent; log loudly.
    print("[SPEND] proceeding under MAX_TICKETS guard only (USD not computable).")
print(f"[SPEND] under caps → proceeding to paid generation.")

# ── Stage C: paid native generation WITH model_id ───────────────────────────
gen_hdrs = {"Content-Type": "application/json", "Livepeer-Payer-Address": PAYER,
            "Livepeer-Payment": pay, "Livepeer-Segment": seg}
print("-" * 78)
print(f"[C generate] POST {APP}{APP_PATH}  body={json.dumps(gen_body_obj)}")
asset = None
gen_status = None
try:
    with _post(f"{APP}{APP_PATH}", gen_body, gen_hdrs, 600) as r:
        out = r.read().decode()
        gen_status = r.status
        result["C"] = {"status": r.status, "headers": _hdrs(r.headers), "body": out[:3000]}
        print(f"[C generate] HTTP {r.status}  headers={json.dumps(_hdrs(r.headers))}")
        print(f"[C generate] body(verbatim, head 1200): {out[:1200]}")
        try:
            j = json.loads(out)
            for k in ("url", "image_url", "images", "video_url", "audio_url",
                      "output", "media_url", "id", "request_id"):
                if k in j:
                    print(f"[C generate] ASSET {k}={str(j[k])[:220]}")
                    if asset is None and j[k]:
                        asset = {k: j[k]}
        except Exception:
            pass
        if gen_status == 200 and asset:
            print("RESULT: GENERATION_PASS (asset returned)")
            result["C"]["verdict"] = "GENERATION_PASS"
        elif gen_status == 200:
            print("RESULT: GENERATION_200_NO_ASSET (200 but no recognizable asset field)")
            result["C"]["verdict"] = "GENERATION_200_NO_ASSET"
        else:
            print(f"RESULT: GENERATION_UNEXPECTED HTTP {gen_status}")
            result["C"]["verdict"] = "GENERATION_UNEXPECTED"
except urllib.error.HTTPError as e:
    eb = e.read().decode()
    gen_status = e.code
    result["C"] = {"status": e.code, "headers": _hdrs(e.headers), "body": eb[:3000]}
    print(f"[C generate] HTTP {e.code}  headers={json.dumps(_hdrs(e.headers))}")
    print(f"[C generate] body(verbatim): {eb[:1200]}")
    is403 = (e.code == 403 and "mismatched manifest" in eb.lower())
    if is403:
        result["C"]["verdict"] = "STILL_403_MANIFEST_MISMATCH"
        print("RESULT: STILL_403_MANIFEST_MISMATCH (regression — FLAG)")
    elif e.code == 400 and "model_id" in eb.lower():
        result["C"]["verdict"] = "STILL_400_MODEL_ID"
        print("RESULT: STILL_400_MODEL_ID (model_id not accepted — investigate body shape)")
    else:
        result["C"]["verdict"] = "GENERATION_FAIL"
        print(f"RESULT: GENERATION_FAIL HTTP {e.code}")
result["C"]["asset"] = asset

# ── Stage D: METERING VERIFICATION (pymthouse/OpenMeter debit) ───────────────
print("-" * 78)
print("[D metering] attempting pymthouse/OpenMeter usage read for this app …")
# split composite bearer app_<clientId>_pmth_<secret>
client_id = None
sep = "_pmth_"
if sep in tok:
    idx = tok.index(sep)
    client_id = tok[:idx]
    secret = tok[idx + 1:]
else:
    secret = tok
meter = {"client_id": client_id, "attempts": []}
if client_id:
    basic = base64.b64encode(f"{client_id}:{secret}".encode()).decode()
    endpoints = [
        ("usage",   f"{PYMTHOUSE_APP_URL}/api/v1/apps/{client_id}/usage?includeRetail=1"),
        ("usage_grouped", f"{PYMTHOUSE_APP_URL}/api/v1/apps/{client_id}/usage?groupBy=user&includeRetail=1"),
    ]
    for name, url in endpoints:
        rec = {"endpoint": name, "url": url.split('?')[0]}
        try:
            with _get(url, headers={"Authorization": f"Basic {basic}",
                                    "Accept": "application/json"}, timeout=40) as r:
                body = r.read().decode()
                rec["http"] = r.status
                rec["body"] = body[:2500]
                print(f"[D metering] {name}: HTTP {r.status}  body(head 800)={body[:800]}")
        except urllib.error.HTTPError as e:
            rec["http"] = e.code
            rec["body"] = e.read().decode()[:800]
            print(f"[D metering] {name}: HTTP {e.code}  body={rec['body']}")
        except Exception as e:
            rec["http"] = None
            rec["error"] = str(e)[:300]
            print(f"[D metering] {name}: ERR {rec['error']}")
        meter["attempts"].append(rec)
else:
    print("[D metering] composite bearer not in app_<id>_pmth_<secret> form; "
          "cannot derive clientId for usage read.")

# interpret metering: a 200 with a totals/requestCount/networkFee is a debit record
metering_confirmed = False
metering_note = "could not read metering with available credentials"
for rec in meter.get("attempts", []):
    if rec.get("http") == 200 and rec.get("body"):
        try:
            b = json.loads(rec["body"])
        except Exception:
            b = {}
        totals = b.get("totals") if isinstance(b, dict) else None
        req_count = (totals or {}).get("requestCount") if isinstance(totals, dict) else None
        net_fee = (totals or {}).get("networkFeeUsdMicros") if isinstance(totals, dict) else None
        if req_count is not None:
            metering_confirmed = req_count and int(req_count) > 0
            metering_note = (f"usage read OK: requestCount={req_count} "
                             f"networkFeeUsdMicros={net_fee}")
        else:
            metering_note = "usage read OK (200) but no totals.requestCount field"
        break
    if rec.get("http") in (401, 403, 404):
        metering_note = (f"usage endpoint returned HTTP {rec['http']} for the composite "
                         "app API key (this key is an app API key, not an OIDC client "
                         "secret / M2M credential — the documented usage read needs those). "
                         "Metering NOT readable with the available credential.")
meter["confirmed"] = metering_confirmed
meter["note"] = metering_note
result["D_metering"] = meter
print(f"[D metering] CONFIRMED={metering_confirmed}  note={metering_note}")

# ── FINAL VERDICT ────────────────────────────────────────────────────────────
print("=" * 78)
gen_ok = (gen_status == 200 and asset is not None)
if gen_ok and metering_confirmed:
    verdict = "FULL_PASS"
elif gen_ok and not metering_confirmed:
    verdict = "PARTIAL (generation GREEN, metering UNVERIFIED)"
else:
    verdict = "FAIL"
result["verdict"] = verdict
print(f"FINAL VERDICT: {verdict}")
print(f"  generation: HTTP {gen_status}  asset={json.dumps(asset)}")
print(f"  metering  : confirmed={metering_confirmed}  ({metering_note})")
if expected_total_usd is not None:
    print(f"  expected spend: ${expected_total_usd:.6f}  (cap ${MAX_SPEND_USD:.2f})")
print("=" * 78)
json.dump(result, open("/tmp/run65_fixed_full.json", "w"), indent=1)
print("wrote /tmp/run65_fixed_full.json")
