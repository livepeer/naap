#!/usr/bin/env python3
"""Run 50b — decode the BYOC payment and pinpoint the orch "Could not parse payment".

Captures the orchestrator's issued TicketParams price (bound into RecipientRandHash)
and the signer-generated payment's ExpectedPrice, then compares them. A mismatch
proves the failure is `invalid recipientRand for ticket recipientRandHash` inside
`ProcessPayment` (ticket validation), NOT a proto parse error and NOT sender reserve.

Secrets come from env only (never committed):
  PMTH_M2M_ID       confidential m2m client id (default: known canary)
  PMTH_M2M_SECRET   confidential m2m client secret  (REQUIRED)
  PMTH_EXT_USER     external user id  (default: known canary)
  PMTH_APP          app client id     (default: known canary)
  BYOC_ORCH_URL     orchestrator gRPC (default byoc-staging-1:8935)
  BYOC_CAPABILITY   capability        (default flux-schnell)
  GATEWAY_SRC       path to livepeer-python-gateway/src
"""
from __future__ import annotations

import base64
import json
import os
import sys
import urllib.request
import urllib.error
from fractions import Fraction

M2M_ID = os.environ.get("PMTH_M2M_ID", "m2m_5ad45661715c8bb7eb30d18f").strip()
M2M_SECRET = os.environ.get("PMTH_M2M_SECRET", "").strip()
EXT_USER = os.environ.get("PMTH_EXT_USER", "2f617839-3588-4700-a6db-8438068c2b7f").strip()
APP = os.environ.get("PMTH_APP", "app_98575870d7ae33589a3f0660").strip()
ISSUER = os.environ.get("PMTH_ISSUER", "https://pymthouse.com/api/v1/oidc").strip()
ORCH = os.environ.get("BYOC_ORCH_URL", "https://byoc-staging-1.daydream.monster:8935").strip()
CAP = os.environ.get("BYOC_CAPABILITY", "flux-schnell").strip()
GATEWAY_SRC = os.environ.get(
    "GATEWAY_SRC",
    os.path.join(os.path.dirname(__file__), "..", "..", "livepeer-python-gateway", "src"),
)


def _price(pi) -> str:
    if pi is None:
        return "<none>"
    return f"{pi.pricePerUnit}/{pi.pixelsPerUnit}"


def _price_frac(pi) -> Fraction | None:
    if pi is None or pi.pixelsPerUnit == 0:
        return None
    return Fraction(pi.pricePerUnit, pi.pixelsPerUnit)


def _mint_signer_jwt() -> tuple[str, str]:
    if not M2M_SECRET:
        print("FATAL: set PMTH_M2M_SECRET env var")
        sys.exit(2)
    data = urllib.parse.urlencode({
        "grant_type": "client_credentials",
        "client_id": M2M_ID,
        "client_secret": M2M_SECRET,
        "external_user_id": EXT_USER,
    }).encode()
    req = urllib.request.Request(
        f"{ISSUER}/token", data=data,
        headers={"Content-Type": "application/x-www-form-urlencoded"}, method="POST",
    )
    with urllib.request.urlopen(req, timeout=25) as r:
        d = json.loads(r.read())
    return d["access_token"], d.get("signer_url", "")


def main() -> int:
    import urllib.parse  # noqa
    sys.path.insert(0, os.path.abspath(GATEWAY_SRC))
    from livepeer_gateway import lp_rpc_pb2
    from livepeer_gateway.capabilities import byoc_capabilities_from_app
    from livepeer_gateway.orch_info import get_orch_info

    jwt, signer_url = _mint_signer_jwt()
    print(f"signer_url : {signer_url}")
    print(f"jwt        : {jwt[:16]}... (scope sign:job)")
    print(f"orch       : {ORCH}")
    print(f"capability : {CAP}")
    headers = {"Authorization": f"Bearer {jwt}"}

    # --- Step 1: orch info WITH capabilities (per-cap ticket params path) ---
    byoc_caps = byoc_capabilities_from_app(CAP)
    info = get_orch_info(ORCH, signer_url=signer_url, signer_headers=headers, capabilities=byoc_caps)

    orch_recipient = "0x" + info.address.hex()
    tp = info.ticket_params if info.HasField("ticket_params") else None
    print("\n=== ORCHESTRATOR INFO (issued, caps-aware) ===")
    print(f"  address (recipient)   : {orch_recipient}")
    print(f"  PriceInfo (base field): {_price(info.price_info) if info.HasField('price_info') else '<none>'}")
    caps_prices = list(info.capabilities_prices)
    print(f"  CapabilitiesPrices    : {[_price(p) for p in caps_prices] or '<empty>'}")
    if tp is not None:
        print(f"  ticket recipient      : 0x{tp.recipient.hex()}")
        print(f"  recipientRandHash     : 0x{tp.recipient_rand_hash.hex()}")
        print(f"  seed                  : 0x{tp.seed.hex()}")
        print(f"  faceValue             : 0x{tp.face_value.hex()}")
        print(f"  winProb               : 0x{tp.win_prob.hex()}")
        print(f"  expirationBlock       : 0x{tp.expiration_block.hex()}")

    # --- Step 2: generate-live-payment via signer, decode the payment proto ---
    parsed = __import__("urllib.parse", fromlist=["urlparse"]).urlparse(signer_url)
    signer_origin = f"{parsed.scheme}://{parsed.netloc}"
    payload = {
        "orchestrator": base64.b64encode(info.SerializeToString()).decode("ascii"),
        "type": "byoc",
        "capabilities": base64.b64encode(byoc_caps.SerializeToString()).decode("ascii"),
    }
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        f"{signer_origin}/generate-live-payment", data=body,
        headers={"Content-Type": "application/json", "Livepeer-Capability": CAP, **headers},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            pay = json.loads(r.read())
    except urllib.error.HTTPError as e:
        print(f"\ngenerate-live-payment FAIL HTTP {e.code}: {e.read().decode()[:300]}")
        return 1

    raw = base64.b64decode(pay["payment"])
    payment = lp_rpc_pb2.Payment()
    payment.ParseFromString(raw)
    print(f"\n=== PAYMENT (signer-generated, {len(raw)}B net.Payment) ===")
    print(f"  sender                : 0x{payment.sender.hex()}")
    print(f"  ExpectedPrice         : {_price(payment.expected_price) if payment.HasField('expected_price') else '<none>'}")
    ptp = payment.ticket_params if payment.HasField("ticket_params") else None
    if ptp is not None:
        print(f"  ticket recipient      : 0x{ptp.recipient.hex()}")
        print(f"  recipientRandHash     : 0x{ptp.recipient_rand_hash.hex()}")
        print(f"  seed                  : 0x{ptp.seed.hex()}")
        print(f"  faceValue             : 0x{ptp.face_value.hex()}")
        print(f"  winProb               : 0x{ptp.win_prob.hex()}")
        print(f"  expirationBlock       : 0x{ptp.expiration_block.hex()}")
    print(f"  ticket_sender_params  : {len(payment.ticket_sender_params)} signed")

    # --- Step 3: verdict ---
    print("\n=== VERDICT ===")
    issued_price = _price_frac(info.price_info) if info.HasField("price_info") else None
    pay_price = _price_frac(payment.expected_price) if payment.HasField("expected_price") else None
    print(f"  orch issued TicketParams price : {issued_price}  ({_price(info.price_info) if info.HasField('price_info') else '-'})")
    print(f"  payment ExpectedPrice          : {pay_price}  ({_price(payment.expected_price) if payment.HasField('expected_price') else '-'})")
    if tp is not None and ptp is not None:
        rrh_match = tp.recipient_rand_hash == ptp.recipient_rand_hash
        print(f"  recipientRandHash echoed OK    : {rrh_match}")
    rec_match = (tp.recipient == ptp.recipient) if (tp and ptp) else False
    print(f"  ticket recipient == orch       : {rec_match}")
    if issued_price is not None and pay_price is not None:
        if issued_price != pay_price:
            print("  >>> PRICE MISMATCH: payment.ExpectedPrice != orch TicketParams price")
            print("  >>> Orch will recompute recipientRand with ExpectedPrice and it will")
            print("  >>> NOT equal RecipientRandHash -> 'invalid recipientRand' -> 400 'Could not parse payment'")
        else:
            print("  >>> prices MATCH — recipientRand mismatch (if any) is from another HMAC input")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
