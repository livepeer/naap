# User Stories — "MyWallet" Plugin for NaaP

## Persona: **Financial Director (FD)**

Sophisticated investor managing significant LPT position across orchestrators.

---

## What Livepeer Explorer Currently Offers (and Gaps)

**Available today:**
- Orchestrator list with reward cut, fee share, total stake
- Performance leaderboard (transcoding success rates)
- Volume metrics (30d/60d/90d ETH)
- Basic delegation UI (bond/unbond via connected wallet)
- Per-orchestrator delegator lists
- Round-by-round reward pool history

**Critical gaps users complain about:**
- No data export (CSV/JSON) from leaderboard or orchestrator pages
- No portfolio-level dashboard (total across all positions)
- No historical yield tracking or ROI calculation
- No orchestrator comparison tool side-by-side
- No alerts/notifications for reward cut changes or missed rewards
- Single-orchestrator-per-address constraint makes multi-O management require multiple wallets
- No P&L, tax reporting, or transaction history export
- No benchmarking (my yield vs. network average)

---

## Protocol Constraints (from codebase research)

Key facts that shape the user stories:
1. **One orchestrator per delegator address** — splitting across Os requires multiple addresses
2. **Unbonding period** — configurable rounds delay before withdrawal
3. **Reward cut + fee share** — set by orchestrator, can change anytime
4. **Must claim earnings** explicitly (or auto-claim on redelegate)
5. **Round-based accounting** — rewards/fees accrue per round via cumulative factors
6. **Redelegation** moves full stake — no partial redelegate

---

## User Stories (Priority Ordered)

### P0 — Must Have (Highest Impact)

| # | User Story | Value |
|---|-----------|-------|
| **S1** | As an FD, I want a **unified portfolio dashboard** showing my total staked LPT, pending rewards, pending fees, and current market value across ALL my wallet addresses, so I can see my total LPT exposure at a glance. | Single pane of glass for multi-wallet investors |
| **S2** | As an FD, I want to **see per-orchestrator breakdown** of my stakes (bonded amount, pending stake, pending fees, reward cut, fee share) for each wallet, so I know how each position is performing. | Position-level visibility |
| **S3** | As an FD, I want to **export orchestrator leaderboard data** (CSV/JSON) with performance scores, reward cut, fee share, total stake, volume, and delegator count, so I can analyze it in Excel/Python/BI tools. | The #1 complained-about gap |
| **S4** | As an FD, I want to **calculate realized and unrealized yield** (annualized %) for each of my staking positions over configurable time periods (7d, 30d, 90d, YTD, all-time), so I can measure ROI. | Core investment metric |
| **S5** | As an FD, I want to **receive alerts when my orchestrator changes reward cut or fee share**, misses calling `reward()` for a round, or gets deactivated, so I can react promptly to protect my returns. | Risk management |
| **S6** | As an FD, I want to **compare orchestrators side-by-side** on key metrics (yield, reliability, reward cut, fee share, total stake, performance score, price/pixel), so I can make informed (re)delegation decisions. | Decision support for staking |

### P1 — Should Have (High Impact)

| # | User Story | Value |
|---|-----------|-------|
| **S7** | As an FD, I want to **see my transaction history** (bonds, unbonds, reward claims, fee withdrawals) with timestamps, amounts, and ETH gas costs, so I can track my cost basis and cash flows. | Accounting & tax prep |
| **S8** | As an FD, I want a **"what-if" rebalancing simulator** that shows projected yield if I move X LPT from Orchestrator A to B, factoring in unbonding period opportunity cost, so I can evaluate moves before executing. | Reduces costly mistakes |
| **S9** | As an FD, I want to **track orchestrator reward-calling consistency** (% of rounds they called reward, streak of misses), so I can identify unreliable orchestrators before it costs me. | Predictive risk signal |
| **S10** | As an FD, I want to **see network-level benchmarks** (average yield, median reward cut, total bonding rate, inflation rate) alongside my portfolio, so I know if I'm underperforming the market. | Contextual performance |
| **S11** | As an FD, I want to **initiate bond/unbond/redelegate/claim** operations directly from the MyWallet plugin through MetaMask, so I don't have to context-switch to the Explorer for execution. | End-to-end workflow |
| **S12** | As an FD, I want to **track unbonding positions** with countdown timers showing when each lock becomes withdrawable, so I can plan my liquidity. | Cash flow management |

### P2 — Nice to Have (Medium Impact)

| # | User Story | Value |
|---|-----------|-------|
| **S13** | As an FD, I want to **export my full staking P&L report** (CSV) with cost basis, rewards earned, fees earned, gas spent, and net return per orchestrator, for tax reporting. | Tax compliance |
| **S14** | As an FD, I want to **see LPT price overlay** on my yield charts (USD-denominated returns, not just LPT-denominated), so I understand total return including token appreciation/depreciation. | True ROI in fiat terms |
| **S15** | As an FD, I want to **set custom watchlists** of orchestrators I'm monitoring (potential redelegate targets), with saved notes, so I can track candidates over time before committing. | Research workflow |
| **S16** | As an FD, I want to **see a risk score** for each orchestrator based on factors like stake concentration, reward-call consistency, time active, and fee share stability, so I can assess counterparty risk. | Risk quantification |
| **S17** | As an FD, I want to **schedule automatic claiming** of pending rewards/fees at configurable intervals, so I don't leave rewards unclaimed and compound my returns. | Yield optimization |
| **S18** | As an FD, I want **governance participation tracking** — how my orchestrators vote on proposals and whether they participate — since this affects protocol health and my investment thesis. | Governance awareness |

### P3 — Future / Aspirational

| # | User Story | Value |
|---|-----------|-------|
| **S19** | As an FD, I want **AI-powered orchestrator recommendations** based on my risk profile, target yield, and portfolio diversification goals. | Smart advisory |
| **S20** | As an FD, I want to **manage a multi-address staking portfolio** from one interface, mapping multiple MetaMask accounts to different orchestrators as a unified investment. | True multi-O portfolio |
| **S21** | As an FD, I want **historical network analytics** (total stake over time, inflation trends, fee revenue trends) to understand macro trends affecting my investment. | Market intelligence |

---

## Recommended MVP Scope for MyWallet Plugin

For maximum impact with minimum build:

**Phase 1 (MVP):** S1 + S2 + S3 + S4 + S6 — Portfolio dashboard, per-position yield, orchestrator comparison, data export. This alone addresses the biggest Explorer gaps.

**Phase 2:** S5 + S7 + S11 + S12 — Alerts, tx history, in-plugin staking operations, unbonding tracker. This makes MyWallet a complete replacement for Explorer.

**Phase 3:** S8 + S10 + S13 + S14 — Simulator, benchmarks, P&L export, USD overlay. This elevates it to a financial-grade tool.

---

## Sources

- [Livepeer Delegate Guide](https://www.livepeer.org/delegate)
- [Livepeer Explorer - Orchestrators](https://explorer.livepeer.org/orchestrators)
- [Livepeer Performance Leaderboard](https://explorer.livepeer.org/leaderboard)
- [Livepeer Explorer - Performance Tab](https://explorer.livepeer.org/orchestrators?orchestratorTable=performance)
- [Livepeer Staking Guide - Figment](https://figment.io/insights/livepeer-staking-delegation-guide-2/)
