# LR Single-Shot vs `lv2v` Payment Path — Assessment

**Question:** Does go-livepeer **PR #3975** give the new runner-based **v0.9.0** orch a proper
NON-`lv2v` single-shot payment path that we should use *instead of* the `type:"lv2v"` + `inPixels:1`
fix proposed in **go-livepeer #4006 + gateway #49**? Is using it possible and the right thing?

**Scope:** Read-only analysis + recommendation. No code/deploy/infra changes. Secrets redacted.

**TL;DR**
- **#3975 is CLOSED, not merged** — but its functionality was **re-landed via #4000 (MERGED 2026-07-24) and IS in clean `v0.9.0`** (released 2026-07-25). So the capability already exists on the deployed orch; **no divergent image is needed.** The old `go-livepeer:3975-singleshot` image is obsolete.
- **#3975/#4000 is orchestrator-side single-shot payment *enforcement*** (a 402 challenge + inline payment + per-unit metering on `ProxyLiveRunnerSingleShot`). It does **NOT** define a signer payment *type* and **does NOT** change how `numTickets`/fee is computed. **It is not, by itself, the fix for the `numTickets` bug.**
- The `numTickets 2721947758 exceeds maximum of 100` bug is **entirely gateway→signer**: the gateway mints with `type:"lv2v"`, and the signer's `lv2v` branch **overwrites** the requested `InPixels` with a continuous 720p30 pixel estimate (~1.66e9), blowing the ticket count past 100.
- A **proper non-`lv2v` single-shot path already exists in the signer**: `type:""` (empty) + `inPixels:1` uses raw `InPixels`, skips the 720p30 recompute, and yields `numTickets ~1`. It needs **only a tiny gateway change** (send `type:""` instead of `"lv2v"`), not #3975.
- **Recommendation: Hybrid.** Ship **(A) #4006 + #49** now as the minimal unblock on clean v0.9.0 (fastest, #49 already in the gateway), and adopt **(B) non-`lv2v` empty-type path** as the correct follow-up that decouples single-shot from `lv2v`. Neither needs a divergent orch image.

---

## 1. What PR #3975 actually is

| Field | Value |
|---|---|
| Title | `feat(server): Live runner single shot payments` |
| State | **CLOSED — `mergedAt: null`, `mergeCommit: null`** (closed 2026-07-22) |
| Base branch | `ja/live-runner` (a feature branch, **not** master/clean v0.9.0) |
| Head branch | `live-runner-single-shot-payments` |
| Files | `server/ai_http.go` (+103/-47), `server/ai_http_test.go` (+71), `server/rpc.go` (+1/-1) |
| Fixes | issue **#3955** (still OPEN) — "bill payments for single-shot live runner calls" |
| Close reason | Merge conflict / superseded by the re-landed #4000 (see §2) |

**What it introduces (orchestrator-side only):**
- On the single-shot proxy (`ProxyLiveRunnerSingleShot`): return a **`402` payment challenge** (shared
  `runnerChallenge`) carrying ticket params, `manifest_id`, and `payment_interval_ms` when the runner is priced.
- Process the inline **`Livepeer-Payment` / `Livepeer-Segment`** headers via `ProcessPayment`, reserve the
  session (`manifest_id` = session id), proxy to the runner, and **release on return** (single-shot = one request).
- Add a per-session metering loop (`startLiveRunnerSessionPaymentLoop`) that debits the prepaid balance every
  `LivePaymentInterval`; lifetime bound to the request ctx for single-shot.

**What it does NOT do (critical):**
- It does **not** add a new signer/remote payment *type* or *RemoteType*.
- It does **not** change `GenerateLivePayment`, the ticket-count math, or the `inPixels`→fee computation.
- Its own tests assert the challenge advertises **`PixelsPerUnit:1`, `PricePerUnit:10`** — i.e. it already expects
  a per-unit ("fixed") accounting on the orch side. The problem is entirely in how the *gateway+signer* compute
  the payment amount they hand back, which #3975 never touches.

> **So #3975 makes single-shot *billable on the orch*; it is not a mechanism that fixes `numTickets`.**
> The user's premise ("use #3975 to avoid the lv2v hack") conflates orch-side enforcement with the
> gateway/signer payment-computation bug. They are different layers.

---

## 2. Is #3975 in clean v0.9.0? — YES (via #4000), so NO divergent image needed

- **v0.9.0** tag `df527c37`, released **2026-07-25**.
- PR **#4000 "Add single-shot payments"** — **MERGED 2026-07-24** to `master`, merge commit `a6ad0f36`,
  head `ja/singleshot-payments`, files `server/ai_http.go` (+28/-5), `ai_http_test.go`, `doc/live-runner.md`.
  This is the **slimmed re-land of #3975** (the closed #3975/#3998/#3983 were all superseded).
- `git compare v0.8.11...v0.9.0` contains the commit **"Add single-shot payments (#4000)"**, plus #3992
  ("Ja/live pricing" — adds the **`fixed`** unit: a single payment charged per request/session) and #3938 ("Live Runner").

**Behavioral confirmation from the field reports:** the deployed clean v0.9.0 orch on `:8936` returns a real
`402` challenge on `POST /apps/{runner}/app/generate` with `PixelsPerUnit:1` per-cap pricing (e.g. flux-schnell
`1648852084881 / 1 = $0.00315`) — exactly the #4000 single-shot payment behavior. See
`LR-V0.9.0-EXECUTION-REPORT.md` (stage 2.5) and the Jul-28 dispatch-fix addendum.

**Consequence:** The earlier `go-livepeer:3975-singleshot` image (built from the unmerged #3975 branch, now
`Exited(0)`/retained-for-rollback per the execution report) is **obsolete**. The single-shot capability the user
wanted is in the official `livepeer/go-livepeer:v0.9.0`. **Re-introducing a #3975-branch image would recreate the
exact divergent-image problem the user wants to avoid — and is unnecessary.**

---

## 3. The signer's payment-type model (where the fix actually lives)

`server/remote_signer.go :: GenerateLivePayment` branches on `req.Type` (`RemotePaymentRequest`):

| `type` | Pixel/unit computation | Result for a fixed per-request cap |
|---|---|---|
| `"lv2v"` (`RemoteType_LiveVideoToVideo`) | **Overwrites** `pixels` with `720*1280*30 * billableSecs` (min 60s preload) → ~1.66e9 pixels | fee = per-unit price × ~1.66e9 → **`numTickets` ≫ 100 → 400** (the live bug) |
| `"byoc"` (`RemoteType_BYOC`) | Time-based; `secSinceLastProcessed × PixelsPerUnit`, min 1 unit | wrong semantics for fixed; also returns `invalid job type`/`500` in field tests |
| `""` (empty) | **Uses `req.InPixels` verbatim** — no recompute (doc: *"Number of pixels to generate a ticket for. Required if `type` is not set."*) | `inPixels:1` → `pixels=1` → fee = fixed price → **`numTickets ~1`** ✅ |

Key code facts (current `fix/live-payment-manifest-session-id` checkout):
- `lv2v` branch (`remote_signer.go` ~L509-516) **unconditionally overwrites** `pixels`, ignoring `req.InPixels`.
  → This is why `inPixels:1` alone does nothing today; **#4006 is required to make `lv2v` honor `InPixels`.**
- Empty-type path: none of the `lv2v`/`byoc` branches run, so `pixels := req.InPixels` stands (L502). The
  manifest-binding fix (`type != BYOC` ⇒ `manifestID = AuthToken.SessionId`, ~L413-417) **also applies to empty
  type**, so it satisfies the orch's `SegData.ManifestID == AuthToken.SessionId` requirement — the same fix that
  unblocks the separate `403 mismatched manifest and auth token` issue.
- The gateway signer client (`livepeer_gateway/remote_signer.py :: LivePaymentSession.get_payment`, L295-310)
  always sends `"type": self._type` and optionally `payload["inPixels"]`. **Sending `type:""` + `inPixels:1` is
  trivially representable** — one value change.

### What the gateway sends today
`live_runner.py :: _get_runner_payment` (L775-798) hardcodes **`type="lv2v"`** and already carries the #49 fix:
`in_pixels=_fixed_price_in_pixels(runner)` → returns `1` when the runner advertises `price_info.unit == "fixed"`,
else `None` (continuous 720p runners keep the automatic estimate). So the gateway is **already `inPixels:1`-ready
for fixed runners** — it is just still pinned to `type:"lv2v"`, which the *current* signer ignores.

---

## 4. Approach comparison for the fixed-price single-shot runner orch

### (A) #4006 + #49 — `inPixels:1` on the `lv2v` path
- **#49 (gateway, base `feat/byoc-inference-capabilities-protobuf`):** send `type:"lv2v"` + `inPixels:1` for
  `unit=="fixed"` runners. **Already present** in the local gateway checkout.
- **#4006 (signer, base `feat/remote-signer-byoc-v2`):** make the `lv2v` branch **honor `InPixels`** (and honor
  it in `numTickets`) instead of overwriting with the 720p30 estimate; also binds `manifestId` to the auth-token
  session id.

| | |
|---|---|
| **Pros** | Gateway side already shipped (#49). Single dispatch path for continuous + fixed, differentiated only by `inPixels`. **Orch (clean v0.9.0) unchanged.** Smallest delta from current state — goes green the moment #4006 lands on the deployed signer. |
| **Cons** | Requires the **signer change #4006 to be deployed** (the live signer currently overwrites `InPixels` — that's the bug). Semantically **overloads `lv2v`** (a continuous live-video type) for one-shot fixed generation. #4006 is **OPEN/unmerged upstream**. Depends on the pymthouse-signer operator shipping it. |

### (B) Non-`lv2v` single-shot — `type:""` + `inPixels:1`
- Gateway: change `_get_runner_payment` to send **`type:""`** (not `"lv2v"`) for `unit=="fixed"` runners, keep
  `inPixels:1`. Same file/place as #49 — a ~one-line change.
- Signer: **no change required in the reference code** — the empty-type raw-`InPixels` path already exists and
  already applies the manifest-binding fix.

| | |
|---|---|
| **Pros** | **Semantically correct** — a fixed single-shot generation is a per-unit payment, not a continuous-video estimate. **Fully decouples single-shot from `lv2v`/BYOC** (aligns with the deprecate-BYOC / clean-v0.9.0 goal). Uses the signer's *existing* mode ⇒ potentially **zero signer code change**. Orch unchanged. |
| **Cons** | **Not validated end-to-end** — field reports exercised `type ∈ {lv2v, byoc, live, scope}` but **never empty type**. Correctness depends on the **deployed pymthouse signer's actual build**, which is unknown (no version endpoint; it is John's separately-deployed service, possibly a fork). If that signer lacks/miscomputes the empty-type path, B needs a signer change after all — erasing its "no signer change" edge. |

### Cross-cutting facts
- **Neither A nor B needs a divergent go-livepeer orch image.** Clean v0.9.0 already enforces single-shot
  payment (#4000) and already advertises `PixelsPerUnit:1`. The fix lives in **gateway + signer** only.
- **Both A and B ultimately depend on the deployed signer's behavior.** A needs a signer *change* (#4006).
  B needs the signer to *already support* empty-type (true upstream; unverified on John's deployment). If the
  signer must be touched regardless, B is the cleaner target to touch toward.

---

## 5. Answers to the precise questions

1. **Is there a real single-shot/fixed path that yields `numTickets ~1` without the lv2v hack?**
   **Yes — the signer's empty-`type` + `inPixels:1` mode** (raw `InPixels`, no 720p30 recompute). It is a
   *signer* capability, **not** something #3975 provides. #3975/#4000 only add orch-side enforcement.

2. **Can the gateway dispatch via that path today?**
   **Not without a small code change.** `_get_runner_payment` hardcodes `type="lv2v"`. Switching fixed runners
   to `type:""` (keeping `inPixels:1`) is a ~one-line change in the same function as #49. It is trivially
   representable by the signer client (which already forwards arbitrary `type` + `inPixels`).

3. **Is #3975 merged into v0.9.0?**
   **The PR #3975 is CLOSED/unmerged.** Its functionality was **re-landed via #4000 (MERGED) and IS in
   v0.9.0.** So the single-shot capability exists on the deployed clean orch **without** any divergent branch/image.

4. **A vs B — which is simpler / more correct / less BYOC-coupled / avoids a divergent image?**
   - **Neither needs a divergent orch image.**
   - **Simpler / faster to green:** **A** — #49 is already in the gateway; only #4006 must ship on the signer.
   - **More correct / least coupled:** **B** — non-`lv2v`, per-unit semantics, decoupled from live-video/BYOC.
   - **B's catch:** it is the cleaner end-state but is **unvalidated** and hinges on the unknown deployed-signer
     build; **A** is the pragmatic minimal fix that is known to work on clean v0.9.0 once #4006 lands.

5. **Recommendation — Hybrid:**
   - **Now:** ship **A (#4006 + #49)** to unblock native single-shot billing on clean v0.9.0. This is the
     smallest, lowest-risk delta (gateway already `inPixels:1`-ready; only the signer needs #4006 deployed).
   - **Next:** migrate to **B (`type:""` + `inPixels:1`)** to remove the `lv2v` overload and fully decouple
     single-shot from live-video/BYOC — after verifying the deployed signer's empty-type path end-to-end.
   - **Do NOT** rebuild/deploy a `#3975`-branch orch image — it is unnecessary (v0.9.0 has #4000) and would
     recreate the divergent-image problem.

---

## 6. Risks & unknowns (stated, not guessed)
- **Deployed signer build is unknown.** No version/commit endpoint on the pymthouse signer (`/version`,`/info`,
  `/status` → 404). Both A (needs #4006) and B (needs working empty-type) therefore carry deployed-signer risk.
- **Empty-type path (B) is untested e2e** in the field reports; upstream code supports it, but the live signer
  may diverge. Validate before relying on B.
- **#4006 is OPEN/unmerged upstream** (base `feat/remote-signer-byoc-v2`); A's timeline depends on it shipping
  on the operator's signer.
- **`numTickets` root cause is orthogonal to #3975.** If someone "uses #3975" expecting it to fix the ticket
  count, it will not — the orch already does its part; the gateway+signer computation is the fix surface.
- The separate `403 mismatched manifest and auth token` blocker is addressed by the signer's manifest-binding
  fix (`fix/live-payment-manifest-session-id`), which applies to both `lv2v` and empty type (`type != BYOC`).

---

*Analysis based on: go-livepeer PR #3975 / #4000 / #3992 / #3938 (GitHub), `v0.8.11...v0.9.0` compare,
local `server/remote_signer.go` (`fix/live-payment-manifest-session-id`), local
`livepeer_gateway/live_runner.py` + `remote_signer.py`, and `LR-V0.9.0-EXECUTION-REPORT.md`. Read-only.*
