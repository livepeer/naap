# Billing Service Plugin -- User Stories

## Overview

This document defines the complete user stories for the NaaP Billing Service plugin. Stories are organized by persona and split into **MVP** (minimum viable product -- the smallest set of stories that deliver end-to-end value) and **Complete** (full feature set including advanced capabilities).

---

## Personas

- **Provider Admin**: A NaaP user who creates and operates a billing service. They manage plans, payment infrastructure, remote signer, orchestrator selection, and monitor revenue.
- **End User**: A NaaP user who discovers billing providers, registers with one or more, subscribes to plans, creates API keys, and uses the Livepeer network.
- **Team Admin**: An end user who creates a team within a billing provider, invites members, and manages spend limits.
- **Team Member**: A NaaP user invited to a team. Uses the service through their own API keys with usage tracked independently.
- **SDK Consumer**: An application or tool that authenticates with a billing service API key to access the Livepeer network.

---

## MVP User Stories

MVP delivers: provider setup, catalog browsing, user registration, plan selection, API key creation, basic usage tracking, and SDK authentication. No Stripe (free-tier/mock), no teams, no remote signer, no cross-provider dashboard.

### Provider Admin -- MVP

**P-MVP-1: Create Billing Service**
As a provider admin, I can create a new billing service with a name, slug, and description, so that I have a service entity to configure.
- Acceptance: POST `/providers` returns created service with `status: draft`.
- The creator is automatically assigned the `billing-service:provider-admin` role.

**P-MVP-2: Configure Branding**
As a provider admin, I can upload a logo, set a brand color, add a markdown description, and list my service capabilities, so that my service has a professional, branded presence in the catalog.
- Acceptance: PUT updates are reflected on the catalog detail page.
- Logo is stored via Vercel Blob or similar storage.

**P-MVP-3: Browse Livepeer Network Models**
As a provider admin, when building a plan, I can browse all pipelines and models currently available on the Livepeer network, with live stats (orchestrator count, median price, average latency) from the Leaderboard API, so I can choose which capabilities to include in my plan.
- Acceptance: Plan builder left panel shows pipelines grouped (text-to-image, llm, image-to-video, etc.) with expandable model lists.
- Data is live from the Leaderboard API, not a hardcoded list.
- Each model shows current orchestrator count and median price.

**P-MVP-4: Build Plan with Model Bundle**
As a provider admin, I can select one or more pipeline+model combinations from the Livepeer network and add them to a plan bundle, so that the plan offers a curated set of AI capabilities to users.
- Acceptance: Provider can add/remove models to/from the plan bundle.
- Each bundled model is stored as a `PlanCapabilityBundle` row.
- The plan comparison table on the provider detail page shows which models are included.

**P-MVP-5: Define SLA per Bundled Model**
As a provider admin, for each model in my plan bundle, I can define SLA targets (target uptime %, P95 latency, optionally P99 latency and min throughput), so that I can promise specific quality of service to my users.
- Acceptance: SLA fields are editable per bundle entry in the plan builder.
- SLA values are displayed on the plan comparison table for users to see.
- Default SLA values are pre-populated (99% uptime, 3000ms P95).

**P-MVP-6: Set Orchestrator Cost Constraints**
As a provider admin, for each model in my plan bundle, I can set a max price per unit (and optionally a min price) to filter which orchestrators qualify, so that I can control my costs and ensure a margin.
- Acceptance: Plan builder shows a price distribution visualization (histogram or violin plot) for the selected model's orchestrators.
- Provider adjusts max price slider and sees the qualifying orchestrator count update live.
- Warning shown if fewer than 3 orchestrators qualify.
- Error shown if 0 orchestrators qualify.

**P-MVP-7: Preview Estimated Margin**
As a provider admin, after configuring the plan price and model bundle cost constraints, I can see an estimated margin preview (plan price minus estimated orchestrator cost), so I can verify the plan is financially viable before publishing.
- Acceptance: Margin preview card shows plan price, estimated orch cost, gross margin, and margin %.
- Color-coded indicator: green >40%, yellow 20-40%, red <20%.
- Provider can adjust usage distribution weights across models.

**P-MVP-8: Create Pricing Plans**
As a provider admin, I can create a complete pricing plan specifying: name, type (monthly/annual), price, included output tokens, seat limit, overage rate, SLA support tier, and the model bundle with SLA and cost constraints, so that users can choose the plan that fits their needs.
- Acceptance: Plans appear on the provider detail page in a comparison table with bundled models visible.
- At least one plan with at least one bundled model must be active before publishing.

**P-MVP-9: Publish Billing Service**
As a provider admin, I can publish my billing service so that it appears in the catalog for NaaP users to discover.
- Acceptance: Only services with at least one active plan (with at least one bundled model) can be published.
- Published services appear in GET `/catalog`.
- Provider can unpublish (set status back to draft).

**P-MVP-10: View Registered Users**
As a provider admin, I can see a list of all users registered with my service, including their selected plan and registration date.
- Acceptance: User list is paginated and searchable by email/display name.

### End User -- MVP

**U-MVP-1: Browse Billing Providers**
As a NaaP user, I can open the Billing page and see a catalog of published billing providers, each showing their logo, name, short description, starting price, and capability tags.
- Acceptance: Catalog loads from GET `/catalog`. Cards are clickable.
- Search and capability filter chips are functional.

**U-MVP-2: View Provider Detail**
As a NaaP user, I can click on a provider card to see their branded landing page with a full description, capability highlights, and a plan comparison table.
- Acceptance: Page renders provider's markdown description, logo, brand color accent.
- Plan table shows all active plans with key differentiators.

**U-MVP-3: Register with a Provider**
As a NaaP user, I can register with a billing provider using my existing NaaP identity (no separate sign-up required).
- Acceptance: POST `/users/register` with `{billingServiceSlug}` creates a `BillingUser`.
- If already registered, the API returns a clear error.
- Registration redirects to plan selection.

**U-MVP-4: Select a Plan**
As a registered billing user, I can select a plan from the provider's offerings.
- Acceptance: A `Subscription` record is created.
- The subscription card on the user dashboard shows the selected plan details.
- In MVP, no payment is required (free-tier or trial).

**U-MVP-5: View My Dashboard**
As a registered billing user, I can see my dashboard for a specific provider showing my current plan, subscription status, and quick actions.
- Acceptance: Dashboard loads at `/billing/p/:slug/overview`.
- Shows plan name, included tokens, renewal date.

**U-MVP-6: Create API Keys**
As a registered billing user with an active subscription, I can create API keys with a descriptive label.
- Acceptance: Raw key (prefixed `bk_`) is shown exactly once after creation.
- Key appears in the keys table with prefix, label, created date, and status.
- Maximum of 25 active keys per user per provider.

**U-MVP-7: Revoke API Keys**
As a registered billing user, I can revoke any of my API keys.
- Acceptance: Revoked keys return 401 when used for SDK auth.
- Revoked keys are shown with "revoked" status in the table.

**U-MVP-8: View Usage per Key**
As a registered billing user, I can see my usage per API key, including output tokens consumed, request count, and estimated cost.
- Acceptance: Usage page shows a bar chart per key and a breakdown table by model.
- Date range filter works.

**U-MVP-9: Cancel Plan**
As a registered billing user, I can cancel my subscription.
- Acceptance: In MVP (no Stripe), subscription status changes to `canceled` immediately.
- User can re-select a plan after canceling.

**U-MVP-10: Deregister from Provider**
As a registered billing user with no active subscription, I can deregister from a billing provider.
- Acceptance: All API keys are revoked.
- `BillingUser` status set to `deleted`.
- User no longer appears in provider's user list.

### SDK Consumer -- MVP

**S-MVP-1: Validate API Key**
As an SDK, I can call POST `/auth/validate` with an API key to verify the key is active, check the subscription status, and receive the list of allowed models from the user's plan.
- Acceptance: Returns `{valid: true, models: [...], plan: {...}}` for active keys.
- Returns `{valid: false, reason: "..."}` for revoked/expired keys or inactive subscriptions.

**S-MVP-2: Record Usage**
As an SDK, after completing a request, I can report usage (model, input/output tokens) that gets recorded against the API key.
- Acceptance: `UsageRecord` is created with the correct `apiKeyId` and `billingServiceId`.

---

## Complete User Stories

Complete adds: Stripe payment, invoicing, teams with spend limits, remote signer, orchestrator selection, cross-provider spending dashboard, and provider revenue/margin tracking.

### Provider Admin -- Complete

**P-C-1: Connect Stripe Account**
As a provider admin, I can connect my Stripe account via Stripe Connect (Standard or Express), so that I can accept payments from users.
- Acceptance: OAuth flow redirects to Stripe, returns with `stripeAccountId`.
- Dashboard shows Stripe connection status (connected/pending/disconnected).
- Provider can disconnect and reconnect.

**P-C-2: Configure Tax Collection**
As a provider admin, I can enable tax collection and configure tax IDs, so that invoices include applicable taxes.
- Acceptance: Tax settings are passed to Stripe when creating subscriptions.
- Invoices reflect tax amounts.

**P-C-3: Set Invoice Prefix**
As a provider admin, I can set a custom invoice prefix (e.g., "ACME-") so that invoices are branded to my service.
- Acceptance: All Stripe invoices for this provider use the configured prefix.

**P-C-4: View Revenue Dashboard**
As a provider admin, I can see my total fiat revenue (from Stripe), including MRR, total revenue, and breakdown by plan.
- Acceptance: Revenue page shows correct aggregates from paid invoices.
- Time-series chart shows revenue over the last 12 months.

**P-C-5: Track ETH Fee Outflow**
As a provider admin, I can see the ETH fees paid to orchestrators by my remote signer, converted to USD at the time of payment.
- Acceptance: ETH fee records appear in a table with txHash (if available), amount in ETH, USD equivalent, orchestrator address, and timestamp.
- Total ETH cost shown for current period.

**P-C-6: View Margin Dashboard**
As a provider admin, I can see my gross margin (fiat revenue minus ETH cost in USD) over time, so I can track business viability.
- Acceptance: Margin chart overlays fiat income and ETH cost lines.
- Margin percentage is calculated and displayed.
- Alert if margin drops below a configurable threshold.

**P-C-7: Configure Remote Signer**
As a provider admin, I can configure my remote signer by providing the signer endpoint URL and ETH wallet address.
- Acceptance: PUT updates `RemoteSignerConfig`.
- Health check runs immediately after save.
- Status badge shows healthy/degraded/unreachable.

**P-C-8: Monitor Remote Signer Health**
As a provider admin, I can see the health status of my remote signer, including last check time and current status.
- Acceptance: Health cron runs every 5 minutes.
- Dashboard shows health status with color-coded badge.
- If unhealthy for >15 minutes, a notification is shown.

**P-C-9: Monitor ETH Wallet Balance**
As a provider admin, I can see the ETH deposit and reserve balance of my remote signer's wallet.
- Acceptance: Balance is fetched from the signer endpoint.
- Low balance warning when below a configurable threshold.

**P-C-10: Configure Orchestrator Selection**
As a provider admin, I can choose an orchestrator selection strategy (leaderboard, manual list, or custom webhook), configure minimum performance requirements, and set maximum price constraints.
- Acceptance: `orchWebhookUrl` is generated and displayed for use with the remote signer.
- When leaderboard strategy is selected, the provider can choose a leaderboard dataset.
- Manual strategy allows entering orchestrator addresses directly.

**P-C-11: View All Invoices**
As a provider admin, I can see all invoices issued to my users across all plans.
- Acceptance: Invoice table shows user, plan, amount, status, date.
- Filterable by status (paid, open, void).

**P-C-12: Manage Plan Trials**
As a provider admin, I can configure a trial period (in days) for any plan, so users can try before paying.
- Acceptance: `trialDays` field on plan creation/edit.
- Subscription starts with `status: trialing` and converts automatically.

**P-C-13: Set Volume Discount Tiers**
As a provider admin, I can define volume discount tiers for overage pricing, so high-usage users get better rates.
- Acceptance: Volume tiers are an ordered array of `{minTokens, ratePerMillion}`.
- Overage cost calculation uses the correct tier based on usage volume.

**P-C-14: Suspend/Unsuspend Users**
As a provider admin, I can suspend a user's access (e.g., for abuse) without deleting their account.
- Acceptance: Suspended user's API keys return 403 on validation.
- User sees "suspended" status on their dashboard with a contact link.

**P-C-15: Set Regional Preferences per Model**
As a provider admin, for each bundled model, I can set preferred orchestrator regions (e.g., NA, EU) so that users get lower latency by being routed to geographically closer orchestrators.
- Acceptance: Region preferences stored on `PlanCapabilityBundle.preferredRegions`.
- Orchestrator webhook filters by region when available.

**P-C-16: Per-Model Quotas within a Plan**
As a provider admin, I can optionally set per-model usage quotas within a plan (e.g., 100K tokens for LLM, 50K pixels for text-to-image) in addition to the shared pool, so I can control cost exposure on expensive models.
- Acceptance: `includedUnits` on `PlanCapabilityBundle` overrides shared pool for that model.
- Usage tracking respects per-model limits.
- User sees per-model quota bars on their usage page.

**P-C-17: Reusable SLA Profiles**
As a provider admin, I can define reusable SLA profiles (e.g., "Gold: 99.9% uptime, 1s P95", "Silver: 99% uptime, 3s P95") and apply them to bundle entries across plans, so I do not have to re-enter SLA values for every model in every plan.
- Acceptance: SLA profiles are managed at the billing service level.
- When adding a model to a bundle, provider can select from saved profiles or enter custom values.

**P-C-18: Monitor Actual vs Target SLA**
As a provider admin, I can see how actual orchestrator performance compares to the SLA targets I defined in each plan bundle, so I can detect SLA violations and adjust constraints.
- Acceptance: Admin dashboard shows actual P95 latency and uptime vs targets per model.
- SLA violations highlighted in red.
- Optionally triggers a notification when SLA is breached for >5 minutes.

**P-C-19: Plan-Aware Orchestrator Selection Verification**
As a provider admin, I can verify that each plan's orchestrator selection constraints are producing valid orchestrator lists by seeing a preview of which orchestrators would be selected for each bundled model right now.
- Acceptance: Infrastructure page shows per-plan, per-model orchestrator preview.
- Provider can see the effect of changing cost constraints in real-time.

### End User -- Complete

**U-C-1: Add Credit Card**
As a registered billing user, I can add a credit card using Stripe Elements, and it is securely stored as my payment method.
- Acceptance: Card appears in payment methods list with last 4 digits, brand, and expiry.
- Stripe handles PCI compliance; no card data touches NaaP servers.

**U-C-2: Set Default Payment Method**
As a registered billing user with multiple cards, I can set one as the default for subscription payments.
- Acceptance: Default badge shown on the selected card.
- Stripe subscription uses the default payment method.

**U-C-3: Remove Payment Method**
As a registered billing user, I can remove a non-default payment method.
- Acceptance: Cannot remove the last/default payment method while subscription is active.

**U-C-4: Subscribe to Paid Plan**
As a registered billing user, I can select a paid plan, and a Stripe subscription is created using my default payment method.
- Acceptance: Stripe subscription created with correct price.
- If trial is configured, subscription starts in trialing status.
- Subscription card shows next billing date and amount.

**U-C-5: Upgrade Plan**
As a registered billing user, I can upgrade to a higher-tier plan, with prorated billing handled by Stripe.
- Acceptance: Stripe subscription is updated.
- Prorated amount appears on the next invoice.
- Allowed models and token quota update immediately.

**U-C-6: Downgrade Plan**
As a registered billing user, I can downgrade to a lower-tier plan, effective at the end of the current billing period.
- Acceptance: Downgrade takes effect at period end (no immediate change).
- Dashboard shows "Changing to [plan] on [date]".

**U-C-7: Cancel Subscription (Stripe)**
As a registered billing user, I can cancel my subscription, which will end at the current billing period.
- Acceptance: `cancelAtPeriodEnd` set to true.
- Dashboard shows "Cancels on [date]".
- User can reactivate before the period ends.

**U-C-8: View Invoices**
As a registered billing user, I can see all my invoices for a specific provider, with status and PDF download.
- Acceptance: Invoices synced from Stripe on webhook events.
- PDF link opens Stripe-hosted invoice PDF.

**U-C-9: Register with Multiple Providers**
As a NaaP user, I can register with multiple billing providers simultaneously and manage each independently.
- Acceptance: `/billing` hub page shows a card for each registered provider.
- Each provider has its own plan, payment methods, API keys, and usage.

**U-C-10: View Cross-Provider Spending**
As a NaaP user registered with multiple providers, I can see a unified spending dashboard showing total cost across all providers.
- Acceptance: `/billing/spending` shows total spend, per-provider breakdown table, and time-series chart.
- Each provider row links to its per-provider usage page.

**U-C-11: Create Team**
As a registered billing user, I can create a team within a billing provider.
- Acceptance: Team is associated with my subscription.
- Team name is required and unique within the provider for this user.

**U-C-12: Invite Team Members**
As a team admin, I can invite other NaaP users to my team by email or NaaP username.
- Acceptance: Invitation creates a `BillingTeamMember` with `status: pending`.
- Invitee must be an existing NaaP user (no external invites).
- Invitee sees the pending invitation and can accept/decline.
- Seat count on subscription increments on acceptance.
- Invitation is rejected if seat limit is reached.

**U-C-13: Remove Team Members**
As a team admin, I can remove a member from my team.
- Acceptance: Member's API keys under this team are revoked.
- Seat count decrements.
- Removed member can be re-invited.

**U-C-14: Set Team Spend Limits**
As a team admin, I can set an overall team spend limit (USD per period) and individual spend limits per member.
- Acceptance: When a member's or the team's usage exceeds the limit, API key validation returns a spend-limit error.
- Dashboard shows current spend vs limit with a progress bar.

**U-C-15: View Team Usage (Admin)**
As a team admin, I can see detailed usage for each team member, including tokens consumed, cost, and per-model breakdown.
- Acceptance: Table shows each member's usage for the current period.
- Sortable by usage amount.

**U-C-16: View Team Usage (Member)**
As a team member, I can see my own usage and an anonymized ranking among team members (e.g., "You are #3 of 8 in usage this month"), but I cannot see other members' detailed usage.
- Acceptance: Member sees own usage charts and stats.
- Ranking shows position only, no names or amounts of others.

**U-C-17: Assign Team Member Roles**
As a team admin, I can change a member's role between admin and member.
- Acceptance: New admins gain access to team spend limits and detailed usage.
- Cannot demote the last admin.

**U-C-18: Handle Past-Due Subscription**
As a registered billing user, if my payment fails, I see a clear "past due" status with instructions to update my payment method.
- Acceptance: Stripe webhook `invoice.payment_failed` updates subscription to `past_due`.
- Dashboard shows a banner with "Update Payment Method" action.
- API keys continue to work for a grace period (configurable by provider).

### SDK Consumer -- Complete

**S-C-1: Authenticate with Signer Info**
As an SDK, when I validate an API key, I also receive the remote signer endpoint URL so I can request payment ticket signatures.
- Acceptance: `/auth/validate` response includes `signer: {endpointUrl}` when the provider has a configured signer.
- Signer info is omitted if not configured.

**S-C-2: Request Payment Signature**
As an SDK, I can call POST `/auth/sign` with my API key and a signing payload, and the billing service proxies the request to the provider's remote signer.
- Acceptance: Billing service validates the API key, checks subscription status, and forwards the signing request.
- Returns the signed ticket from the remote signer.
- Returns 403 if key is invalid, subscription is inactive, or spend limit is exceeded.

**S-C-3: Check Usage Quota**
As an SDK, when I validate an API key, the response includes remaining token quota for the current period, so I can warn users before they exceed their plan.
- Acceptance: `/auth/validate` response includes `quota: {used, included, remaining, overageRate}`.

**S-C-4: Receive Spend Limit Status**
As an SDK, when I validate an API key associated with a team, the response includes whether the team or individual spend limit has been reached.
- Acceptance: `/auth/validate` response includes `spendLimit: {teamReached: false, individualReached: false}`.
- If either limit is reached, the SDK should not proceed with the request.

---

## Story Map

```
                    MVP                                         Complete
                    ---                                         --------
Provider:    Create -> Brand                                  + Stripe Connect -> Tax -> Invoice Mgmt
             -> Browse Network Models -> Bundle Models        + Regional Preferences -> Per-Model Quotas
             -> Define SLA -> Set Cost Constraints            + Reusable SLA Profiles -> SLA Monitoring
             -> Margin Preview -> Publish                     + Revenue Dashboard -> ETH Fees -> Margin
                                                              + Signer -> Orch Verification
                                                              + Trials -> Volume Discounts -> Suspend

User:        Catalog -> Detail -> Register                    + Multi-Provider Registration
             -> Select Plan -> Dashboard                      + Stripe Payment -> Upgrade/Downgrade
             -> API Keys -> Usage -> Cancel                   + Teams -> Spend Limits -> Invoices
                                                              + Cross-Provider Spending Dashboard

SDK:         Validate Key -> Record Usage                     + Signer Auth -> Sign Request
                                                              + Quota Check -> Spend Limit Check
```

---

## Acceptance Test Scenarios

### MVP Smoke Test

1. Provider admin creates a billing service, adds branding (logo, description, brand color).
2. Provider opens plan builder, browses available Livepeer network models from Leaderboard API.
3. Provider creates "Free" plan: bundles `text-to-image/stabilityai/sd-turbo` with 99% uptime SLA, maxPrice 500 wei/pixel. Margin preview shows estimate.
4. Provider creates "Pro" plan: bundles `text-to-image/stabilityai/sd-turbo` + `llm/meta-llama/Llama-3.1-8B-Instruct` with 99.5% uptime, tighter latency SLA, higher maxPrice. Margin preview shows higher margin due to higher plan price.
5. Provider publishes the service.
6. NaaP user opens billing catalog, sees the provider with branding, clicks to view detail.
7. User sees plan comparison table showing bundled models and SLA per plan.
8. User registers with the provider, selects the Free plan.
9. User creates an API key, copies it.
10. SDK validates the key, receives `[text-to-image/stabilityai/sd-turbo]` as allowed models.
11. SDK makes 10 requests to text-to-image, records usage.
12. User views usage dashboard, sees 10 requests and token/pixel counts.
13. User cancels plan, deregisters.

### Complete Smoke Test

1. Provider A publishes service with "Starter" plan (1 model, loose SLA, low maxPrice) and "Enterprise" plan (5 models, tight SLA, higher maxPrice). Margin preview shows 45% margin on Enterprise.
2. Provider B publishes service with different branding, bundles video-focused models (image-to-video, live-video-to-video) with region preference "NA".
3. User A registers with both providers, selects Enterprise on Provider A and Pro on Provider B.
4. User A adds credit card, Stripe subscriptions created on both.
5. User A creates API keys on both providers, uses them for different workflows.
6. User A views cross-provider spending dashboard, sees both providers with per-provider cost breakdown.
7. User A creates a team on Provider A, invites User B and User C.
8. User B and C accept invitations, create their own API keys.
9. Team admin (User A) sets spend limits: $500/month team, $200/month per member.
10. User B exceeds individual limit, API key returns spend-limit error.
11. User A views team usage, sees all members' detailed usage per model.
12. User B views team usage, sees own usage and ranking (#2 of 3).
13. Provider A admin views revenue dashboard: fiat income from Stripe, ETH fees from signer, margin chart shows actual margin close to the 45% estimate.
14. Provider A admin checks per-plan SLA monitoring: Enterprise plan shows P95 latency within targets for all bundled models.
15. Provider A admin checks remote signer health -- green badge, ETH balance healthy.
16. Provider A admin opens orchestrator selection verification: Enterprise plan shows 12 qualifying orchestrators for the LLM model, Starter plan shows 25 (looser constraints, more qualify).
17. Provider B admin sees User A in their user list with Pro plan.
