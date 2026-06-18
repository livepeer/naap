# Contracts — Billing Provider Protocol (BPP)

This directory holds the **provider-neutral** cross-repo contracts (C0) for the
NaaP × billing-provider × application integration. They are the *seams* every
billing provider implements and that NaaP reaches **only** through the
`BillingProviderAdapter` SPI (NAAP-A).

`pymthouse` is the reference provider; a tiny in-memory **stub provider** is the
second implementation that proves the abstraction in CI. The
[conformance test](../apps/web-next/src/lib/billing/bpp/conformance.test.ts)
validates any provider's payloads against these schemas.

## Files (`billing-provider-protocol/`)

| Seam | File | Direction | Part of BPP? |
|---|---|---|---|
| ② `validate` response | `validate.schema.json` | provider → NaaP (via adapter) | ✅ yes |
| ④ plans + capability bundles | `plans.schema.json` | provider → NaaP | ✅ yes |
| ⑤ account + member + `billingAccountRef` | `account.schema.json` | provider-internal → NaaP ref | ✅ yes (ref only) |
| ⑥ usage ingest | `usage-ingest.schema.json` | provider → NaaP `/metrics/ingest` | ✅ yes |
| ⑦ discovery response | `discovery.schema.json` | NaaP → gateway | ✅ yes |
| ⑧ curated list + token bundle | `curated-list.schema.json` | NaaP → provider | ✅ yes |
| ⑨ provider-internal metering (OpenMeter) | `provider-internal-openmeter.schema.json` | **provider-internal** | ❌ **NOT BPP** |

> **Seam isolation (hard rule).** The BPP payloads (② and ⑥ especially) must
> never carry provider-internal field names from ⑨ (e.g.
> `openmeter_subscription_id`, raw `network_fee_usd_micros` OM shapes,
> `source: "openmeter"`). The conformance suite asserts this. If a provider needs
> to surface a subscription pointer it returns a **neutral opaque**
> `subscriptionRef` (the provider decides its meaning).

## Schema dialect

All schemas use JSON Schema **2020-12**. They are *additive-only*: never change an
existing field's meaning — add new optional fields / new schema versions. The
conformance suite compiles every schema (a schema-lint guardrail) and validates
the stub provider against them.

## Versioning

These are v1 of the BPP. Breaking changes require a new file
(`*.v2.schema.json`) so old consumers keep validating against v1.
