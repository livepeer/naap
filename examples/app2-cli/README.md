# APP-2 — NaaP Sample CLI (second reference application)

A **minimal, standalone** application that uses a native `naap_` key to run an
inference job **through the NaaP front door** (`POST /api/v1/keys/validate`,
BPP ③). It exists to prove the generalization bar **E9**: the API key +
capability model is **app-agnostic** — a brand-new app, sharing **zero code with
Storyboard**, can authenticate, get its plan-gated capabilities, and run work,
with usage attributed to **its own `appId`**.

It is also **provider-agnostic**: it never sees a provider token or URL. It
presents a `naap_` key and receives an opaque `signerSession` + a gated
`capabilities` list — so it behaves identically whether the team is backed by
**pymthouse** or the **stub** provider (E8 / INT-G).

## Register it (NAAP-D)

`app2.descriptor.json` is the registry descriptor. With the `app_registry` flag
ON, register it once:

```bash
curl -sS -X POST "$NAAP/api/v1/apps" \
  -H "authorization: Bearer <admin-session>" \
  -H "content-type: application/json" \
  --data @app2.descriptor.json
```

NaaP returns the `Application` (its `id`/`slug`). APP-2 presents that value via
the `X-App-Id` header so usage attributes to it distinctly from Storyboard.

## Run it

```bash
NAAP_FRONT_DOOR_URL="https://<naap-host>" \
NAAP_API_KEY="naap_..." \
NAAP_APP_ID="naap-sample-cli" \
CAPABILITY="text-to-image:sdxl" \
node src/cli.mjs
```

The CLI emits structured JSON logs only and always redacts the key. It does
**not** fall back to any other path — being independent, it simply reports if the
front door is unreachable or the capability is denied.

## Test

```bash
npm test   # node --test, zero dependencies
```

## Flags / safety

- Requires `key_validation_front_door` (and, for registry-checked attribution,
  `app_registry`) enabled on the target NaaP. With them OFF the front door 404s
  and this app reports `app2.front_door_rejected` — no production impact.
- No secrets are stored or logged.
