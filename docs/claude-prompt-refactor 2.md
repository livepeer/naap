

# refactor.md  
## Gold-Standard 2026 Refactor Prompt — MFE + Vertical Slice + Monorepo Dashboard

You are an **expert Staff+ level software architect and refactoring engineer (2026 standard)**.

Your task is to refactor an existing **multiview dashboard prototype (generated using Google AI Studio)** into a **production-grade, decoupled, multi-team architecture** using:

- **Micro-Frontends (MFE)**
- **Module Federation 2.0**
- **Vertical Slicing (Domain Ownership)**
- **Microservices with per-workflow databases**
- **Single Monorepo (Nx / Turborepo-style)**

This refactor must **NOT break existing functionality** and must result in a system where **each workflow can be independently developed, deployed, enabled, or removed**.

---

## 0. Absolute Constraints (Non-Negotiable)

1. **Do NOT break existing behavior**
   - UI, routes, APIs, and data flows must continue to work.
   - If something must change, introduce **adapters or compatibility layers**.

2. **Incremental refactor**
   - The app must remain runnable after each major step.
   - Favor shims and indirection over big-bang rewrites.

3. **SOLID + Clean Architecture**
   - Dependency direction must always point inward.
   - Use interfaces/contracts for all cross-boundary communication.

4. **One Monorepo, Many Owners**
   - Everything lives in one GitHub repo.
   - Each workflow is owned by a separate team and is independently deployable.

---

## 1. Architectural North Star (2026 Gold Standard)

### 1.1 Micro-Frontend Architecture (Module Federation 2.0)

Use **Module Federation (Webpack or Vite)** for runtime composition.

#### Host (Base App Shell)
The Shell is the **only global authority** and is responsible for:
- Authentication & authorization (Shared Auth Kernel)
- Global navigation & layout
- Theming and design tokens
- Workflow discovery, loading, and orchestration
- Cross-workflow event bus
- Shared services exposure (feature flags, telemetry, user context)

⚠️ The shell **MUST NOT import workflow internals directly**.

#### Remotes (Workflows)
Each workflow:
- Is an independently built and deployable **remote**
- Owns its **UI, API, business logic, and database**
- Exposes only a **manifest + mount function**
- Communicates with the shell exclusively through:
  - Typed contracts
  - Event bus
  - Shared libraries

---

## 2. Vertical Slicing (Organizational + Code Structure)

Refactor by **business domain**, not by technical layer.

### Rule:
> One workflow = one vertical slice = one team = one backend + one database.

Examples:
- `networkexplorer`
- `salesanalytics`
- `inventorytracking`

Each workflow owns:
- Frontend MFE
- Backend service
- Database schema
- API contracts

Duplication between workflows is **explicitly allowed**.

---

## 3. API Design (Mandatory)

All APIs must follow this extensible, versioned pattern:

/api/{version}/{workflow}/{feature}/…

Examples:
- `/api/v1/base/auth/session`
- `/api/v1/networkexplorer/topology`
- `/api/v1/networkexplorer/metrics/latency`

Rules:
- `{workflow}` is mandatory after version
- Feature grouping is required
- Versioning must allow parallel `v2`
- Old endpoints must be preserved via:
  - Proxy
  - Adapter
  - Compatibility router

---

## 4. Monorepo Structure (Implement This)

Use **Nx or Turborepo** (choose the best fit and justify).

/
├─ apps/
│  ├─ shell-web/                     # Base App Shell (Host)
│  └─ workflows/
│     ├─ networkexplorer-web/        # MFE Remote
│     └─ -web/
│
├─ services/
│  ├─ base-svc/
│  └─ workflows/
│     ├─ networkexplorer-svc/
│     └─ -svc/
│
├─ packages/
│  ├─ ui/                            # Design system components
│  ├─ theme/                         # Design tokens, theming
│  ├─ utils/                         # Shared helpers
│  ├─ types/                         # Shell ↔ Workflow contracts
│  ├─ api-client/                    # Typed API clients
│  └─ config/                        # Env + feature flag schemas
│
├─ scripts/
│  ├─ start.sh
│  ├─ stop.sh
│  └─ smoke.sh
│
├─ infra/
│  ├─ docker/
│  └─ k8s/ (optional)
│
├─ docs/
│  ├─ architecture.md
│  ├─ refactor-plan.md
│  ├─ migration-notes.md
│  └─ runbook.md
│
└─ README.md

---

## 5. Layered Architecture (Frontend + Backend)

Each workflow MUST follow **Clean Architecture**:

domain/
entities
business-rules
application/
use-cases
ports (interfaces)
infrastructure/
api
db
adapters
presentation/ (frontend) OR interfaces/http (backend)

Rules:
- Domain has **no framework dependencies**
- Infrastructure depends on application, never the reverse
- UI talks only to application layer

---

## 6. Frontend MFE Mechanics (Mandatory)

### Use Module Federation 2.0
- Host dynamically loads workflow remotes
- Shared dependencies:
  - `react`
  - `ui`
  - `theme`
  - `types`
- No direct imports between workflows

### Workflow Contract
Each workflow exposes:

```ts
export interface WorkflowManifest {
  name: string
  version: string
  mount: (container: HTMLElement, shellContext: ShellContext) => void
}

Shell loads workflows via a manifest registry.

⸻

7. Communication & Security

Event-Driven Integration
	•	Implement an Event Bus (e.g. Mitt or Custom Events)
	•	Example:
	•	Global date filter emits dateChanged
	•	All workflows subscribe independently

Shared Auth Kernel
	•	Authentication handled ONLY by shell
	•	No tokens passed via window
	•	Shell provides a secure auth context API

⸻

8. Backend Services

Each workflow service:
	•	Has its own DB and migrations
	•	Exposes:
	•	/healthz
	•	/api/v1/<workflow>/...
	•	No cross-service DB access

⸻

9. start.sh (Critical Deliverable)

Implement scripts/start.sh with flags:

./start.sh --all
./start.sh --workflow networkexplorer
./start.sh --workflows networkexplorer,sales
./start.sh --no-workflows
./start.sh --backend-only
./start.sh --frontend-only
./start.sh --clean
./start.sh --dev | --prod

Requirements:
	•	Enables/disables workflows dynamically
	•	Starts only required services + MFEs
	•	Prints running ports and URLs
	•	Fails fast on errors

⸻

10. Testing & Verification (Minimum Bar)
	•	Smoke test per workflow:
	•	backend /healthz
	•	one representative API call
	•	frontend mount test
	•	Provide scripts/smoke.sh

⸻

11. Required Outputs

You MUST produce:
	1.	Refactored codebase
	2.	docs/refactor-plan.md
	3.	docs/architecture.md
	4.	docs/runbook.md
	5.	scripts/start.sh
	6.	Compatibility notes in docs/migration-notes.md

⸻

12. Execution Order (Follow Strictly)
	1.	Scan repo and summarize current state
	2.	Identify workflows + routes + APIs
	3.	Write docs/refactor-plan.md
	4.	Introduce shell abstraction
	5.	Extract first workflow as MFE
	6.	Add Module Federation
	7.	Add backend service separation
	8.	Add start.sh
	9.	Verify everything still works

⸻

BEGIN EXECUTION

Start by scanning the repository, then generate
docs/refactor-plan.md before making architectural changes.

Do NOT ask follow-up questions unless absolutely unavoidable.
If ambiguity exists, make a reasonable assumption and document it.

