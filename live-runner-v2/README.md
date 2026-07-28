# live-runner-v2 — onchain multi-runner Live-Runner orchestrator (one runner per fal cap)

Finalized deploy artifacts for the **NEW onchain LR orchestrator** described in
`../LR-ONE-ORCH-MANY-RUNNER-SETUP.md`. One orch (`livepeer/go-livepeer:v0.9.0`,
`arbitrum-one-mainnet`, keystore wallet, `-useLiveRunners`, `-pricePerUnit=100`)
that statically registers **8 per-cap runners** via `-liveRunnerConfig runners.json`,
each advertising its **own** per-cap `price_info` so `/discovery` shows a distinct
non-zero price per capability.

> **STATUS: LIVE (2026-07-28).** Deployed **additively** on the existing
> `liverunner-staging-1` VM (us-west1-b, `136.66.21.17`) at host port **`:8936`**
> via **`docker-compose.deployed.yml`** (image `go-livepeer:3975-singleshot`,
> reusing the funded BYOC wallet `0x180859…a6a252` already on the VM — no new
> wallet/fund/Secret-Manager-pull; existing `:8935` orch untouched). `/discovery`
> shows **8 distinct non-zero per-cap prices**; the naap-key path now mints a real
> `net.Payment` (gRPC `PriceInfo=101/1`), so the `400 zero priceInfo` is gone.
> Full billed *generation* is blocked one step later by an orch-image job-cred
> sig-verify gap (see `../LR-MULTIRUNNER-GOLIVE-E2E.md` §4). Owner: **John / orch-infra**.
>
> **FIX in `runners.json`:** each entry now carries `health_url` +
> `healthy_status_code` — the image's `buildStaticRunner` `glog.Exitf`s without a
> `health_url`, so the original 8-entry file would not have booted.
> The `docker-compose.yml` here is the original v0.9.0 authoring template;
> `docker-compose.deployed.yml` is what actually shipped.

## Files

| File | Purpose |
|---|---|
| `docker-compose.yml` | Orchestrator (v0.9.0, onchain arbitrum, `-useLiveRunners`, `-liveRunnerConfig`) + shared `fal-app` proxy. |
| `runners.json` | The 8 per-cap runner registrations, each with its own wei `price_info`. |
| `.env.example` | Template of the infra-owned secrets to place in `.env`. |

## The 8 runners and their per-cap prices

| # | cap | app id | display price | wire `price_per_unit / pixels_per_unit` (WEI) |
|---|-----|--------|---------------|-----------------------------------------------|
| 1 | flux-schnell | `storyboard/fal-flux-schnell` | $0.00315 / MP | `1284088677165 / 1048576` |
| 2 | flux-dev | `storyboard/fal-flux-dev` | $0.02625 / MP | `10700738976372 / 1048576` |
| 3 | gpt-image | `storyboard/fal-gpt-image` | $0.0022 / image | `898862074015 / 1048576` |
| 4 | kontext-edit | `storyboard/fal-kontext-edit` | $0.042 / image | `17121182362196 / 1048576` |
| 5 | pixverse-i2v | `storyboard/fal-pixverse-i2v` | $0.063 / s | `3246683470165 / 8294400` |
| 6 | veo-t2v | `storyboard/fal-veo-t2v` | $0.42 / s | `21644556467764 / 8294400` |
| 7 | chatterbox-tts | `storyboard/fal-chatterbox-tts` | $0.02625 / 1000 chars | `112205380728886 / 100000` |
| 8 | **seedance-mini-i2v** ⚠️ | `storyboard/fal-seedance-mini-i2v` | **$0.0394 / s (PROVISIONAL — gap H)** | `2030465535310 / 8294400` |

> ⚠️ **seedance-mini-i2v is PROVISIONAL.** Its wei price is *derived* from the
> documented $0.0394/s using the identical ETH reference as the other two video
> caps (pixverse/veo: `price_per_unit / display_usd ≈ 5.1535e13 wei per USD·s`,
> so `0.0394 × 5.1535e13 ≈ 2030465535310`). It is **not** yet in
> `pricing-table.json` / `static-pricing.json` / `CAPABILITIES_JSON.byoc.json`.
> **Owner: storyboard descriptor / pricing (gap H)** must finalize the price and
> add it to the pricing table before this runner is considered authoritative. To
> ship only the 7 finalized caps, delete the last entry in `runners.json`.

## Deploy runbook (infra / John — run on the VM, NOT from the authoring workspace)

```bash
# On an amd64 GCP VM in livepeer-simple-infra, from simple-infra/live-runner-v2/
# (copy this directory there).

# 1. Confirm the v0.9.0 static-config field names match this runners.json shape.
docker run --rm livepeer/go-livepeer:v0.9.0 -help 2>&1 | grep -i liveRunner
#    If v0.9.0 static config is USD-native, convert each entry to
#    {"price":<usd>,"currency":"USD","unit":"<megapixel|image|second|1000-chars>"}.

# 2. Supply infra-owned secrets (NOT in repo):
#    - ./keystore/<wallet>.json    (orch on-chain wallet; from GCP Secret Manager)
#    - ./password.txt              (keystore passphrase)
#    - ./.env                      (from .env.example: FAL_KEY, ARB_RPC_URL,
#                                    ETH_ORCH_ADDR, LR_ORCH_SECRET, LR_HOSTNAME)

# 3. Reuse the EXISTING funded/registered byoc-style orch wallet — do NOT fund a
#    new one. Verify it is registered on Arbitrum One (same as byoc onboarding).

# 4. Bring up:
sudo docker compose up -d --build
sudo docker logs liverunner-v2-orch | grep -i 'liveRunner\|price'

# 5. Front :443 with Caddy (Let's Encrypt):
#    liverunner-v2-staging-1.daydream.monster {
#        reverse_proxy https://localhost:8935 { transport http { tls_insecure_skip_verify } }
#    }
sudo docker run -d --name liverunner-v2-caddy --network host --restart always \
  -v ~/Caddyfile:/etc/caddy/Caddyfile:ro -v caddy_data:/data caddy:2

# 6. Create the DNS A record: liverunner-v2-staging-1.daydream.monster -> <VM static IP>
#    (Cloudflare zone daydream.monster).

# 7. VERIFY per-cap pricing (PASS = 8 distinct non-zero price_info, NOT the shared {100,1,WEI}):
curl -sk https://liverunner-v2-staging-1.daydream.monster:8935/discovery \
  | jq '.[0].runners[] | {app, price_info}'
```

## Infra-only prerequisites (the go-live blockers)

- amd64 GCP VM in `livepeer-simple-infra` (gcloud interactive reauth required).
- Funded + Arbitrum-One-registered orch wallet keystore from GCP Secret Manager.
- Arbitrum One RPC URL, `FAL_KEY`, `LR_ORCH_SECRET`.
- DNS A record + Caddy TLS on :443.
