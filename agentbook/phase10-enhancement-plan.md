# Phase 10 Enhancement Plan — Self-Improving, Personalized Agent System

## Current State (Phase 10 Complete)

We have 4 sub-agents (Bookkeeper, Tax Strategist, Collections, Insights) with:
- Static skill assignments (hardcoded in agent profiles)
- Per-tenant config (aggressiveness, auto-approve, notification frequency, model tier)
- Placeholder handlers (not wired to real skill execution)
- No learning loop, no skill marketplace integration, no personalization

## What's Missing (The Gap)

| Gap | Current | Needed |
|-----|---------|--------|
| **Skill loading** | Hardcoded in agent profiles | Dynamic: load/unload skills at runtime per tenant |
| **Personalization** | Same agent for everyone | Agent adapts to user's industry, jurisdiction, behavior |
| **Self-improving** | Static categorization rules | Learns from corrections, improves accuracy over time |
| **Industry specialization** | Generic freelancer focus | Industry skill packs: consultant, agency, e-commerce, real estate |
| **Localization** | Jurisdiction packs exist but agents don't adapt behavior | Agent changes tax strategy, compliance, language per jurisdiction |
| **Skill marketplace** | Marketplace skill exists but isn't connected | Users install skills → agents auto-load them |
| **Learning feedback loop** | Engagement tracker exists but doesn't feed back | User actions → skill confidence adjustments → better recommendations |

---

## Enhancement Architecture

### 1. Dynamic Skill Loading (agents load skills at runtime)

**Current:** Agent profiles have `ownedSkills: string[]` hardcoded.
**Enhanced:** Skills are loaded dynamically per tenant from DB + marketplace.

```
AgentSkillRegistry (per tenant)
  ├── Base skills (system-wide, always loaded)
  │   └── expense-recording, receipt-ocr, tax-estimation, invoice-creation, ...
  ├── Jurisdiction skills (loaded based on tenant.jurisdiction)
  │   └── us: schedule-c, irs-quarterly, 1099-nec
  │   └── ca: t2125, cra-installments, t4a, rrsp
  │   └── uk: self-assessment, vat, payments-on-account
  ├── Industry skills (loaded based on tenant.industry)
  │   └── consultant: hourly-billing, scope-creep-detection, retainer-management
  │   └── agency: project-profitability, contractor-management, multi-client-billing
  │   └── e-commerce: inventory-cogs, shipping-expense, sales-tax-multi-state
  │   └── real-estate: property-depreciation, rental-income, 1031-exchange
  ├── Installed skills (from marketplace)
  │   └── crypto-accounting, international-invoicing, payroll-basic
  └── Personalized skills (learned from user behavior)
      └── vendor-patterns, categorization-rules, reminder-timing
```

### 2. Self-Improving Learning Loop

The agent doesn't just execute — it watches the outcome of every action and adjusts.

```
Action → Outcome → Feedback → Skill Update → Better Action

Example flow:
1. Bookkeeper categorizes $200 at Best Buy as "Office Supplies" (85% confidence)
2. User corrects to "Equipment"
3. Learning loop:
   a. Pattern updated: Best Buy → Equipment (confidence: 0.95, source: user_corrected)
   b. Anomaly model updated: Equipment category now has wider variance
   c. Agent note: "Best Buy purchases > $100 are typically Equipment, < $100 are Office Supplies"
4. Next Best Buy purchase: agent uses amount-aware categorization
```

**Three learning tiers:**

| Tier | What Learns | Speed | Scope |
|------|------------|-------|-------|
| **Instant** | Vendor patterns, categorization corrections | Immediate | Per-tenant |
| **Weekly** | Spending trends, client payment timing, seasonal patterns | Weekly batch | Per-tenant |
| **Monthly** | Industry benchmarks, common mistakes, new regulations | Monthly analysis | Cross-tenant (anonymized) |

### 3. Personalized CFO Personality

Each agent adapts its communication style, priority weighting, and proactive behavior based on the user's profile.

**User Profile Signals:**
- `tenant.industry` → which skills to prioritize
- `tenant.jurisdiction` → which tax rules to apply
- `tenant.businessType` → solo vs team communication style
- `engagement history` → what notifications they act on
- `correction history` → what the agent keeps getting wrong

**Personality Dimensions:**
```
AbAgentPersonality (per tenant per agent)
  communicationStyle: 'concise' | 'detailed' | 'auto'     // learned from response patterns
  proactiveLevel: 'minimal' | 'balanced' | 'aggressive'    // learned from engagement rate
  riskTolerance: 'conservative' | 'moderate' | 'aggressive' // for tax/investment advice
  industryContext: string                                    // e.g., "SaaS consultant in California"
  preferredLanguage: string                                  // from tenant locale
  customInstructions: string                                 // user-provided: "Always round up estimates"
```

### 4. Jurisdiction-Aware Agent Behavior

The agent doesn't just use jurisdiction packs for calculations — it changes its BEHAVIOR based on jurisdiction.

| Behavior | US Agent | CA Agent | UK Agent |
|----------|---------|---------|---------|
| **Tax deadline urgency** | "Q2 estimated tax due June 15" | "Q2 installment due June 15" | "Payment on account due July 31" |
| **Deduction language** | "Section 179 expensing" | "Capital Cost Allowance" | "Annual Investment Allowance" |
| **Sales tax approach** | State-by-state nexus analysis | GST/HST/PST province rules | VAT with input tax credits |
| **Contractor warning** | "$600 → 1099-NEC required" | "$500 → T4A required" | "CIS deductions apply" |
| **Retirement suggestions** | "SEP-IRA or Solo 401(k)" | "RRSP contribution room" | "Pension contributions" |
| **Proactive timing** | November year-end planning | February RRSP deadline push | October Self Assessment push |
| **Compliance tone** | "IRS requires..." | "CRA expects..." | "HMRC mandates..." |

### 5. Skill Installation → Agent Auto-Load

When a user installs a skill from the marketplace, the relevant agent auto-loads it.

```
User installs "crypto-accounting" skill
  → Marketplace marks as installed
  → Bookkeeper agent detects new skill in installed list
  → Bookkeeper auto-loads: crypto transaction categorization, DeFi income tracking
  → Tax Strategist auto-loads: crypto capital gains calculation, staking income
  → Agent notifies: "I can now track your crypto transactions. Connect your wallet?"
```

---

## Implementation Plan

### Enhancement 1: Prisma Models

```prisma
model AbAgentSkillBinding {
  id          String   @id @default(uuid())
  tenantId    String
  agentId     String                          // bookkeeper | tax-strategist | collections | insights
  skillName   String                          // skill identifier
  source      String   @default("base")       // base | jurisdiction | industry | marketplace | personalized
  enabled     Boolean  @default(true)
  priority    Int      @default(50)           // 0-100, higher = preferred for ambiguous intents
  createdAt   DateTime @default(now())

  @@unique([tenantId, agentId, skillName])
  @@index([tenantId, agentId])
  @@schema("plugin_agentbook_core")
}

model AbAgentPersonality {
  id                  String   @id @default(uuid())
  tenantId            String
  agentId             String
  communicationStyle  String   @default("auto")
  proactiveLevel      String   @default("balanced")
  riskTolerance       String   @default("moderate")
  industryContext      String?
  customInstructions   String?
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  @@unique([tenantId, agentId])
  @@schema("plugin_agentbook_core")
}

model AbLearningEvent {
  id            String   @id @default(uuid())
  tenantId      String
  agentId       String
  eventType     String                        // correction | confirmation | pattern_update | accuracy_change
  skillName     String
  before        Json                          // state before learning
  after         Json                          // state after learning
  confidence    Float
  createdAt     DateTime @default(now())

  @@index([tenantId, agentId, createdAt])
  @@schema("plugin_agentbook_core")
}
```

### Enhancement 2: Dynamic Skill Loader

```typescript
// On tenant login / session start:
async function loadTenantSkills(tenantId: string, agentId: string): string[] {
  // 1. Base skills (always loaded)
  const base = getBaseSkills(agentId);

  // 2. Jurisdiction skills
  const config = await db.abTenantConfig.findUnique({ where: { userId: tenantId } });
  const jurisdictionSkills = getJurisdictionSkills(config.jurisdiction, agentId);

  // 3. Industry skills (if tenant has industry set)
  const industrySkills = config.industry ? getIndustrySkills(config.industry, agentId) : [];

  // 4. Marketplace-installed skills
  const installed = await db.abAgentSkillBinding.findMany({
    where: { tenantId, agentId, source: 'marketplace', enabled: true },
  });

  // 5. Personalized skills (learned)
  const personalized = await db.abAgentSkillBinding.findMany({
    where: { tenantId, agentId, source: 'personalized', enabled: true },
  });

  return [...base, ...jurisdictionSkills, ...industrySkills,
          ...installed.map(s => s.skillName), ...personalized.map(s => s.skillName)];
}
```

### Enhancement 3: Learning Feedback Processor

```typescript
// After every user correction:
async function processCorrection(tenantId: string, agentId: string, correction: {
  original: { categoryId: string; confidence: number };
  corrected: { categoryId: string };
  context: { vendor: string; amount: number };
}) {
  // 1. Update vendor pattern
  await updatePatternConfidence(tenantId, correction.context.vendor, false);

  // 2. Create new pattern with corrected category
  await createOrUpdatePattern(tenantId, correction.context.vendor, correction.corrected.categoryId, 'user_corrected');

  // 3. Log learning event
  await db.abLearningEvent.create({
    data: {
      tenantId, agentId: 'bookkeeper',
      eventType: 'correction',
      skillName: 'expense-recording',
      before: correction.original,
      after: correction.corrected,
      confidence: 0.95, // user corrections are high confidence
    },
  });

  // 4. Check if this correction reveals a pattern gap
  // E.g., "User corrects Best Buy to Equipment when amount > $100"
  await detectAmountAwarePattern(tenantId, correction);

  // 5. Update agent personality (if user frequently corrects, increase confirmation frequency)
  const recentCorrections = await countRecentCorrections(tenantId, agentId, 30);
  if (recentCorrections > 10) {
    await updatePersonality(tenantId, agentId, { proactiveLevel: 'minimal' });
    // Agent learns: "This user prefers to confirm before I record"
  }
}
```

### Enhancement 4: Industry Skill Packs

| Industry | Skills Loaded | Agent Behavior Changes |
|----------|--------------|----------------------|
| **Consultant** | hourly-billing, scope-creep-detection, retainer-management, effective-rate-analysis | Collections agent tracks unbilled hours aggressively |
| **Agency** | project-profitability, contractor-management, multi-client-billing, resource-allocation | Insights agent surfaces per-project margins |
| **E-commerce** | inventory-cogs, shipping-expense, sales-tax-nexus, marketplace-fees | Bookkeeper auto-categorizes Amazon/Shopify fees |
| **Real Estate** | property-depreciation, rental-income, 1031-exchange, maintenance-tracking | Tax Strategist focuses on depreciation schedules |
| **Creative** | project-based-billing, licensing-income, equipment-depreciation, portfolio-expenses | Collections agent handles milestone-based invoicing |

### Enhancement 5: Agent Self-Assessment

Each agent periodically evaluates its own performance and adjusts:

```typescript
// Weekly self-assessment (run by proactive engine)
async function agentSelfAssess(tenantId: string, agentId: string) {
  const metrics = await getAgentMetrics(tenantId, agentId, 7); // last 7 days

  // Bookkeeper: check categorization accuracy
  if (agentId === 'bookkeeper') {
    if (metrics.categorizationAccuracy < 0.85) {
      // Accuracy dropping — increase confirmation for low-confidence items
      await updateConfig(tenantId, agentId, { autoApprove: false });
      await sendProactiveMessage(tenantId, {
        category: 'agent_self_assess',
        body: `My categorization accuracy dropped to ${(metrics.categorizationAccuracy * 100).toFixed(0)}% this week. I'll ask for more confirmations until I improve.`,
      });
    }
  }

  // Collections: check DSO trend
  if (agentId === 'collections') {
    if (metrics.avgDSO > 45) {
      await updateConfig(tenantId, agentId, { aggressiveness: Math.min(1, metrics.currentAggressiveness + 0.1) });
      await sendProactiveMessage(tenantId, {
        category: 'agent_self_assess',
        body: `Average days to payment is ${metrics.avgDSO}. I'm increasing reminder frequency to bring it down.`,
      });
    }
  }
}
```

---

## Priority Order

| # | Enhancement | Impact | Effort | Do First? |
|---|------------|--------|--------|-----------|
| **1** | Prisma models (skill binding, personality, learning events) | Foundation | Small | Yes |
| **2** | Dynamic skill loader (jurisdiction + industry aware) | High | Medium | Yes |
| **3** | Learning feedback processor (corrections → pattern updates) | High | Medium | Yes |
| **4** | Industry skill packs (consultant, agency, e-commerce) | High | Medium | Phase 11 |
| **5** | Agent self-assessment (weekly auto-adjust) | Medium | Small | Yes |
| **6** | Personalized CFO personality (communication style adaptation) | Medium | Medium | Phase 12 |
| **7** | Cross-tenant learning (anonymized industry benchmarks) | High | Large | Phase 12 |

**Recommendation:** Implement #1, #2, #3, and #5 now as Phase 10 enhancements (2-3 days). Defer #4, #6, #7 to Phases 11-12 where they build on more data.

---

## Success Metrics

| Metric | Target | How Measured |
|--------|--------|-------------|
| Auto-categorization accuracy (30 days) | > 95% | Corrections / total categorizations |
| Skill loading latency | < 200ms | Time from login to skills ready |
| Learning events per tenant/week | > 10 | AbLearningEvent count |
| Agent self-assessment action rate | > 80% | Self-adjustments that improve metrics |
| Industry skill adoption | > 30% of tenants | Tenants with industry-specific skills loaded |
| Personalization score | > 4/5 user satisfaction | Survey after 30 days |
