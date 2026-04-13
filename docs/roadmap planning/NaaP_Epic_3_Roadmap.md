# NaaP Epic 3 — Roadmap

## E-Briefing: Epic 3 and Demand Generation Potential

Epic 3 is a pivotal step in making the Livepeer network ready for broader developer adoption and commercial traction.

**The core unlock:** By decoupling billing from a single provider (Daydream), Epic 3 lets any billing partner offer Livepeer capabilities to their developer base. This transforms the network from a single-channel product into a platform that multiple go-to-market partners can distribute — each bringing their own developer relationships and sales motions.

**Why this matters for demand generation:**

Multi-provider billing means multiple top-of-funnel channels. Each new billing partner becomes a distribution partner, expanding the network's reach without requiring the core team to scale sales directly. The enriched capabilities discovery and orchestrator leaderboard make the network self-service and transparent — reducing friction for developers evaluating Livepeer for the first time.

The agent-first DevX (Episodes 3 and 5) positions Livepeer at the forefront of how developers will build in 2026 and beyond. MCP-powered interfaces and vibe-coding workflows lower the barrier to entry dramatically, letting developers integrate Livepeer capabilities in minutes rather than days. This is both a differentiation story and a conversion accelerator.

Meanwhile, GPU diversification (Episode 4) ensures supply can scale with demand — giving orchestrators more hardware options and the network more capacity to serve growing workloads.

**In short:** Epic 3 builds the rails for multi-channel distribution, frictionless onboarding, and supply-side scalability — the three pillars of sustainable demand generation.


## Vision

Epic 3 opens the Livepeer network to a broader ecosystem of developers, billing providers, and orchestrators — making it easier to build on, contribute to, and grow the network.

Building on the foundations of Epics 1 and 2, Epic 3 pursues three goals:

1. **Multi-provider access** — Let any billing provider (not just Daydream) offer Livepeer network capabilities to developers.
2. **Flexible orchestrator infrastructure** — Give orchestrators the freedom to onboard capabilities across diverse GPU hardware and providers.
3. **Agent-first developer experience** — Prototype an AI-native DevX so developers can interact with the Livepeer network through their preferred agent tools.

**Primary persona:** Developer
**Timeframe:** 4 weeks (one month) for core scope

---

## What Developers Can Do After Epic 3

- Access supported Livepeer network capabilities through any integrated billing provider, using the SDK.
- Query network analytics and performance data through a standard API and an MCP server — directly from tools like Claude or Claude Code.
- Begin building agent-powered applications on Livepeer through well-defined MCP interfaces and vibe-coding workflows.

---

## Episodes

### Episode 1 — Multi-Provider Billing & Diversified Capabilities (MVP)

**Owners:** John, Josh, Qiang

**Goal:** Enable multiple billing providers to offer Livepeer capabilities to developers — not just Daydream. This is the core unlock for ecosystem growth.

**Key deliverables:**

- **Plan-based orchestrator leaderboard** — A new discovery and selection mechanism so developers can find the right orchestrators for their needs.
- **Enriched capabilities discovery** — Accurate, detailed views of what the network can do, helping developers select the right models and workflows for their applications.
- **SDK expansion** — The SDK will support:
  - Scope workflows (existing)
  - Bring-your-own-compute (BYOC) capabilities
  - AI Runner capabilities (Stable Diffusion families, community LLMs, and more)

The RFC for initial scope and architecture is [linked here].

---

### Episode 2 — SDK-Driven Metrics Collection & Reporting

**Owners:** Josh, Mike/Speedy

**Goal:** With the move away from centralized gateways, the network needs a new approach to performance observability. This episode builds SDK-driven metrics collection so the community has reliable data on orchestrator performance and network health.

**Core user story:**
> As a developer using the Livepeer Python SDK, network performance and reliability metrics are automatically collected and reported to a community-hosted data warehouse. I can query these metrics through a standard API (Epic 2) and an MCP interface (Epic 3) for reporting and analytics.

**Architecture:** Two primary data publishers — Daydream Kafka and Cloud SPE Kafka — feed into the shared data warehouse.

---

### Episode 3 — Agent-First Data Infrastructure (MCP for Read Capabilities)

**Owners:** Mike/Speedy, Qiang

**Goal:** Make network-wide data insights accessible to developers through AI agent tools. This is the first step toward an agent-native Livepeer experience.

**Core user story:**
> As a developer, I can use my AI tools (like Claude or Claude Code) to query Livepeer network analytics — covering my application performance and the infrastructure I'm using. NaaP optionally provides a hosted MCP server I can point my client to, along with downloadable skills to get started quickly.

---

### Episode 4 — Scope Workflows on Diversified GPUs

**Owners:** Josh, Emran (+ community contributors: Brad, Jason, and others welcome)

**Goal:** Extend Scope workflows beyond the current fal.ai H100 setup to work on additional serverless providers and consumer GPUs (4090, 5090). This gives orchestrators more freedom to find available GPU capacity while maintaining the quality and reliability Scope demands.

**Target benchmarks:**
- 99.9% availability
- 99% startup success rate
- Latency and VRAM performance on par with fal.ai H100 baselines

**Deliverables:**
- At least one additional serverless provider supported
- 5090 GPU adaptation tested (documenting which workflows work and which don't)

---

### Episode 5 — Agent-First DevX: Product & Architecture Prototype

**Owner:** Qiang (builds on Episode 3; additional contributors to be identified)

**Goal:** Define the architecture that lets developers use any agent framework with Livepeer's AI inference capabilities — through vibe coding and natural-language-driven development.

**Key deliverables:**
- Well-defined MCP interface for AI inference tooling on Livepeer
- An agent SDK to streamline the developer experience
- Prototype demonstrating end-to-end agent-driven app building on the Livepeer network

**Core user story:**
> As a developer, I can use my preferred agent framework to build services and applications on the Livepeer network through vibe coding — powered by the tools and capabilities Livepeer provides.

---

