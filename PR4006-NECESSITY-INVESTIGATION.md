# PR #4006 necessity — evidence-based investigation

## Verdict (one line)

**(A) — go-livepeer PR #4006 is NOT necessary for the real SDK-driven live-runner flow.** The owner is essentially correct: the SDK already sends `ManifestID = challenge.manifest_id`, the orchestrator already sets that challenge `manifest_id = AuthToken.SessionId`, and every signer lineage echoes `req.ManifestID` — so a matching `(manifestID, sessionId)` pair is produced *without* #4006. **Important correction to the framing:** the observed `403 mismatched manifest and auth token` is **NOT a stale-build / version mismatch** and **NOT proof of a signer bug**. It is a **native-probe harness artifact** — the e2e probe (`run63`) hand-built the sign request and *omitted the `ManifestID` field entirely*, which is the one and only condition under which the signer mints a fresh random id. #4006 is therefore a defense-in-depth hardening, not a required fix. (One link is inferred, not directly e2e-tested — see §7 for the exact confirmatory re-run.)

---

## 1. Repos / lineage consulted (provenance)

| Role | Local path (or upstream) | Branch | Commit |
|---|---|---|---|
| **Signer (#4006 itself)** | `/Users/qiang.han/Documents/mycodespace/livepeer/go-livepeer` | `fix/live-payment-manifest-session-id` | `dd4ff4f3` (base `be5a669e`) |
| Orch (old master) | `/Users/qiang.han/Documents/mycodespace/golivepeer/go-livepeer` | `master` | `267c53b3` (release v0.8.9 — *no* `remote_signer.go`) |
| Orch (current) | upstream `livepeer/go-livepeer` | `master` | fetched `server/ai_http.go` (raw, 1915 lines) |
| SDK/gateway (local, fixed-price) | `/Users/qiang.han/Documents/mycodespace/livepeer-python-gateway` | `fix/live-runner-fixed-price-inpixels` (j0sh fork) | `63cecd6` |
| SDK/gateway (owner-cited) | upstream `livepeer/livepeer-python-gateway` | `ja/live-runner` | fetched `src/livepeer_gateway/live_runner.py` (raw, 1318 lines) |

PR #4006 metadata (via `gh pr view 4006 --repo livepeer/go-livepeer`): **state = CLOSED, not merged** (`mergedAt: null`, `closedAt: 2026-07-29T02:19:44Z`), head `fix/live-payment-manifest-session-id`, base `feat/remote-signer-byoc-v2`.

> Note: `be5a669e` ("byoc-staging-1 build") is exactly `HEAD~1` of the #4006 branch, so the pre-#4006 signer code is readable locally byte-for-byte.

---

## 2. The actual code at each of (a) / (b) / (c)

### (a) SDK / gateway — reads the orch challenge `manifest_id` and forwards it to the signer

Owner-cited **`ja/live-runner` `live_runner.py` L851** (raw fetch) — the challenge parser reads the field:

```python
# livepeer-python-gateway @ ja/live-runner : src/livepeer_gateway/live_runner.py  (L~851)
    payment_params = data.get("payment_params")
    orchestrator_url = data.get("orchestrator")
    manifest_id = data.get("manifest_id")        # <-- L851: reads the orch's challenge manifest_id
    ...
    if not isinstance(manifest_id, str) or not manifest_id:
        raise LivepeerGatewayError("Live runner payment challenge missing manifest_id")
```

The locally-checked-out fork (`fix/live-runner-fixed-price-inpixels @ 63cecd6`) is functionally identical and shows the *forwarding*:

```711:738:../livepeer-python-gateway/src/livepeer_gateway/live_runner.py
@dataclass(frozen=True)
class _RunnerPaymentChallenge:
    payment_params: str
    orchestrator_url: str
    manifest_id: str
...
    manifest_id = data.get("manifest_id")
...
    return _RunnerPaymentChallenge(
        payment_params=payment_params,
        orchestrator_url=orchestrator_url,
        manifest_id=manifest_id,
    )
```

```775:792:../livepeer-python-gateway/src/livepeer_gateway/live_runner.py
async def _get_runner_payment(
    challenge: _RunnerPaymentChallenge,
    ...
) -> tuple[LivePaymentSession, GetPaymentResponse]:
    ...
    session = LivePaymentSession(
        signer_url=signer_url,
        ...
        type="lv2v",
        payment_params=challenge.payment_params,
        manifest_id=challenge.manifest_id,          # <-- manifest_id = challenge.manifest_id
        orchestrator_url=challenge.orchestrator_url,
        ...
    )
```

And `LivePaymentSession` puts it on the wire to the signer as the JSON `ManifestID` field:

```291:299:../livepeer-python-gateway/src/livepeer_gateway/remote_signer.py
    async def _payment_request(self) -> GetPaymentResponse:
        from .http import _http_origin, post_json
        url = f"{_http_origin(self._signer_url)}/generate-live-payment"
        payload: dict[str, Any] = {
            "orchestrator": self._payment_params,
            "type": self._type,
            "ManifestID": self._manifest_id,        # <-- forwarded to the signer
        }
```

**Answer to (a): YES.** The SDK sets `manifest_id = challenge.manifest_id` and passes it to the signer in the sign-request payload. The `ja/live-runner` branch does not differ materially from the deployed fork on this point.

### (b) Orchestrator — sets the challenge `manifest_id = SessionId`, and is the *checker* (not the source of `segCreds`)

Owner-cited **master `server/ai_http.go` L448** (raw fetch) is the **402-challenge builder**:

```go
// go-livepeer @ master : server/ai_http.go L440-450
func marshalLivePaymentChallengeResponse(oInfo *lpnet.OrchestratorInfo) ([]byte, error) {
	buf, err := proto.Marshal(oInfo)
	...
	return json.Marshal(liveRunnerPaymentChallengeResponse{
		PaymentParams: base64.StdEncoding.EncodeToString(buf),
		Orchestrator:  oInfo.GetTranscoder(),
		ManifestID:    oInfo.GetAuthToken().GetSessionId(),   // <-- L448: challenge manifest_id == session_id
	})
}
```

And the **checker** that emits the 403 — `reservePaidLiveRunnerSession` (master `ai_http.go` L263-287):

```go
// go-livepeer @ master : server/ai_http.go L280-287
	payment, segData, _, err := h.processPaymentAndSegmentHeaders(w, r)
	if err != nil {
		return "", "", false
	}
	if string(segData.ManifestID) != segData.AuthToken.SessionId {
		respondWithError(w, "mismatched manifest and auth token", http.StatusForbidden)   // <-- THE 403
		return "", "", false
	}
```

**Answer to (b):** the orch does two things — (1) it *advertises* `manifest_id = AuthToken.SessionId` in the 402 challenge (L448), and (2) it is the *checker* that compares the **signer-produced** `segData.ManifestID` against `segData.AuthToken.SessionId` (L284). The orch never sets `segCreds.ManifestID` itself; it only rejects a mismatch. The orch binding its own value does **not** fix a signer that emits a wrong `segCreds.manifestId`. Confirmed: **orch = checker, not source.**

### (c) Signer — copies `req.ManifestID`; generates a fresh id ONLY when the request omits it

Pre-#4006 (base `be5a669e`, i.e. the deployed lineage) `GenerateLivePayment` in `server/remote_signer.go`:

```401:437:../livepeer/go-livepeer/server/remote_signer.go
	manifestID := req.ManifestID                     // <-- copies the request's value
	byocCapability := ""
	if req.Type == RemoteType_BYOC {
		if priceInfo.Capability == uint32(core.Capability_BYOC) && priceInfo.Constraint != "" {
			byocCapability = priceInfo.Constraint
		}
	}
	// [#4006 inserts its override here — see below]
	if manifestID == "" {                            // <-- fresh id ONLY when empty
		if hasState {
			err := errors.New("missing manifestID")
			respondJsonError(ctx, w, err, http.StatusBadRequest)
			return
		}
		if req.Type == RemoteType_BYOC && byocCapability != "" {
			manifestID = byocCapability
		} else {
			manifestID = string(core.RandomManifestID())   // <-- the "fresh 8d6eea88"
		}
	}
	ctx = clog.AddVal(ctx, "manifest_id", manifestID)
	streamParams := &core.StreamParameters{
		ManifestID: core.ManifestID(manifestID),     // <-- flows into genSegCreds
	}
```

The request struct — note the JSON tag is `manifestId`; Go's `encoding/json` matches the SDK's `"ManifestID"` case-insensitively, so a supplied value *is* honored:

```226:234:../livepeer/go-livepeer/server/remote_signer.go
type RemotePaymentRequest struct {
	State RemotePaymentStateSig `json:"state,omitempty"`
	Orchestrator []byte `json:"orchestrator"`
	// Set if an ID is needed to tie into orch accounting for a session. Optional
	ManifestID string `json:"manifestId,omitempty"`
```

`genSegCreds` embeds *both* halves of the pair — `ManifestID` from `streamParams`, `AuthToken` (hence `SessionId`) from the challenge `oInfo`:

```689:703:../livepeer/go-livepeer/server/segment_rpc.go
	params := sess.Params
	...
	md := &core.SegTranscodingMetadata{
		ManifestID:         params.ManifestID,                     // <-- signer's manifestID
		...
		AuthToken:          sess.OrchestratorInfo.GetAuthToken(),  // <-- challenge session_id
```

The **#4006 change** (`dd4ff4f3`) inserts, between the two blocks above, a hard binding for non-BYOC:

```408:417:../livepeer/go-livepeer/server/remote_signer.go
	// The orchestrator's live-runner enforces SegData.ManifestID == AuthToken.SessionId
	// ... Bind the live manifest id to the challenge's session id ...
	if req.Type != RemoteType_BYOC {
		if sessionID := oInfo.AuthToken.GetSessionId(); sessionID != "" {
			manifestID = sessionID
		}
	}
```

**Answer to (c): the signer COPIES `req.ManifestID`.** It does **not** generate a fresh id "regardless of the request" — it falls back to `RandomManifestID()` **only** when `req.ManifestID == ""` (and not BYOC, and no prior state). #4006 makes that copy unconditional (always `= session_id`) for non-BYOC.

---

## 3. Traced data flow of `manifestId`

```
ORCH 402 challenge (ai_http.go L448)
   manifest_id (JSON)      = oInfo.AuthToken.SessionId    e.g. 381b5a15
   payment_params (proto)  = OrchestratorInfo{ AuthToken.SessionId = 381b5a15 }
        │
        ▼
SDK / gateway (live_runner.py L851 + _get_runner_payment + remote_signer.py L298)
   challenge.manifest_id   = 381b5a15
   sign request payload    = { orchestrator: <proto 381b5a15>, type, ManifestID: 381b5a15 }
        │
        ▼
SIGNER /generate-live-payment (remote_signer.go GenerateLivePayment)
   manifestID := req.ManifestID
     • SDK path      -> req.ManifestID = 381b5a15  -> manifestID = 381b5a15  (echoed)
     • #4006 path    -> manifestID = oInfo.AuthToken.SessionId = 381b5a15   (forced)
     • NATIVE PROBE  -> req.ManifestID = "" (field omitted) -> RandomManifestID() = 8d6eea88
   streamParams.ManifestID = manifestID
   genSegCreds -> SegData{ ManifestID = manifestID, AuthToken.SessionId = 381b5a15 }
        │
        ▼
ORCH check (ai_http.go L284, reservePaidLiveRunnerSession)
   if segData.ManifestID != segData.AuthToken.SessionId -> 403 "mismatched manifest and auth token"
     • SDK / #4006   -> 381b5a15 == 381b5a15  -> PASS (200)
     • NATIVE PROBE  -> 8d6eea88 != 381b5a15  -> 403   <-- the observed failure
```

**Where the mismatch is introduced:** only on the **native-probe path**, because the probe's sign request omits `ManifestID`, forcing the signer into its empty-fallback `RandomManifestID()` branch. The orch is the checker; the SDK and orch both already carry `session_id`.

---

## 4. Does the binding exist in master / v0.9.0 independently of #4006?

**Split answer, with evidence:**

- **Orchestrator side — YES, independently.** Master `server/ai_http.go` L448 sets the 402 challenge `manifest_id = oInfo.GetAuthToken().GetSessionId()` with no dependency on #4006. This is exactly the "orch (master)" location the owner cited. So the orch already tells the gateway the correct id to use.
- **Signer side — NO.** Master has **no `server/remote_signer.go`** at all (`gh api …/contents/server/remote_signer.go?ref=master` → `Not Found`; local v0.8.9 master also has no such file). The `GenerateLivePayment` remote-signer handler lives only on the `feat/remote-signer-byoc-v2` lineage (base `be5a669e`). On that lineage the manifest id is `req.ManifestID` with a `RandomManifestID()` fallback — the unconditional `= session_id` binding exists **only** on the #4006 branch. So "deploy latest master" does *not* add the signer-side binding, because master doesn't contain the signer at all.

Net: the *orchestrator's* half of the manifest binding is in master independently of #4006; the *signer's* unconditional binding is unique to #4006 — but it is redundant for the SDK flow because the SDK supplies the value and the signer copies it.

---

## 5. Reconciliation: owner's claim vs the `8d6eea88 ≠ 381b5a15` evidence

**Both are true, and they do not conflict — here is precisely why.**

- **Owner's claim is correct.** In the real SDK-driven flow the manifest is already bound to the session id in *two* places that matter: (1) the orch advertises `manifest_id = session_id` in the 402 challenge (`ai_http.go` L448), and (2) the SDK reads that (`live_runner.py` L851) and forwards it as the sign request's `ManifestID` (`remote_signer.py` L298). A pre-#4006 signer *copies* `req.ManifestID` (`remote_signer.go` L401), so it emits `segCreds.manifestId = session_id` → the orch check (L284) passes. The owner's "the live runner should already have `manifest_id = AuthToken.SessionId`" is accurate.

- **The `8d6eea88 ≠ 381b5a15` evidence is also real — but it was produced by the *native probe*, not the SDK.** `scripts/run63-lr-fixed-e2e-prodsigner.py` builds the sign request by hand:

```92:92:scripts/run63-lr-fixed-e2e-prodsigner.py
payload = {"orchestrator": pp, "type": "fixed", "capabilities": caps_b64, "inPixels": 1}
```

  There is **no `ManifestID` key** in that payload. So `req.ManifestID` arrives empty at the signer, which is the *only* branch that mints `RandomManifestID()` → `8d6eea88`. Meanwhile the challenge (correctly) carried `manifest_id == session_id == 381b5a15` — the execution report itself records the challenge pair as **equal** on this very run ("`session_id`/`manifest_id` equal", `LR-V0.9.0-EXECUTION-REPORT.md` L573; also L430 "`manifest_id=2e5c1503` (**now equal**)"). The orch then compared the *signer-fabricated* `8d6eea88` against the *challenge* `381b5a15` and returned 403.

- **Therefore the bug report's decisive claim — "the signer sets `manifestId` to a fresh random id *regardless of* / *instead of* echoing the request" (`SIGNER-MANIFEST-403-BUGREPORT-FOR-JOHN.md` §4/§6) — is not supported by the code.** The signer does echo the request; it only randomizes when the field is absent. The report's own repro omitted the field, so it exercised the randomize branch. The 403 is a **test-harness artifact**, not evidence that a supplied `ManifestID` is ignored, and not a "version mismatch" (any signer version on this lineage would behave identically on both the probe path and the SDK path).

- **Where the earlier "redundant" close was right vs. imprecise:** #4006 was closed on the assumption the binding "already exists." That assumption is correct *for the SDK flow* (the reason the 403 does not occur there). The bug report over-corrected by declaring the close "premature" based on a native probe that never sent `ManifestID`. Both the close and the owner's claim stand; the bug report's counter-evidence does not overturn them.

---

## 6. Concrete recommendation — what makes the prod signer echo `session_id`

**For the real naap → SDK live-runner `fixed` flow, nothing new needs to ship on the signer.** The SDK already sends `ManifestID = session_id`, and the deployed signer copies `req.ManifestID`, so `segCreds.manifestId == session_id` and the 403 does not arise. Use the actual gateway/SDK path (`call_runner` → `LivePaymentSession`) rather than a hand-rolled native request.

**If you keep using the native probe**, add the one field so it stops exercising the randomize branch:

```python
# scripts/run63-lr-fixed-e2e-prodsigner.py — make the probe mirror the SDK
payload = {"orchestrator": pp, "type": "fixed", "capabilities": caps_b64,
           "inPixels": 1, "ManifestID": chal.get("manifest_id")}   # echo challenge session_id
```

That alone should turn Stage C from `403` into `200` on the **current** production signer — with **no redeploy and no #4006**.

**Is #4006 worth merging anyway?** It is a reasonable **defense-in-depth** hardening: it makes `segCreds.manifestId` correct even for a caller that omits or mis-sets `ManifestID`, and it cannot regress the SDK flow (the SDK already sends the same value). It is *not required* to clear this 403. If John wants a single "belt-and-suspenders" signer build he can include it, but the priority items from the bug report that are genuinely missing on one signer or the other (BYOC parity, the `lv2v numTickets > 100` bug) are independent of #4006.

---

## 7. What is confirmed vs. inferred (honesty about the one gap)

| Link in the chain | Status | Evidence |
|---|---|---|
| Orch challenge `manifest_id == session_id` | **Confirmed** | master `ai_http.go` L448 + report L430/L573 (observed equal on the failing run) |
| Orch is the checker (L284 → 403) | **Confirmed** | master `ai_http.go` L280-287 |
| SDK forwards `ManifestID = challenge.manifest_id` | **Confirmed** | `live_runner.py` L851 / `_get_runner_payment` + `remote_signer.py` L298 |
| Signer copies `req.ManifestID`; randomizes only when empty | **Confirmed (code)** | `remote_signer.go` L401-431 (be5a669e lineage) |
| Native probe omitted `ManifestID` → produced `8d6eea88` | **Confirmed** | `run63` L92 payload + report L583 |
| **Deployed prod signer (`69.46.46.126`) echoes a *populated* `ManifestID`** | **Inferred, not directly e2e-tested** | code lineage is uniform (`manifestID := req.ManifestID`), but the probe never sent a populated field, and the signer exposes no `/version` endpoint (report §2), so its exact binary was never observed echoing a supplied value |

**To make the verdict 100% airtight**, run the single confirmatory test in §6 (native probe with `ManifestID` populated, or the real SDK path) against `pymthouse-production.up.railway.app` and confirm Stage C returns `200`. Given uniform code lineage this is near-certain, but it is the one link this investigation could not directly observe.

---

*Investigation only — no code edited, nothing deployed/rebuilt/minted, no PRs reopened/closed, no infra mutated. Every claim above is cited to a file/line/branch/commit or to a recorded probe artifact.*
