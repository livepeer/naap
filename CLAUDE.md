# A3P — Agent as a Product

## AgentBook
AgentBook is the primary product — an agent-based accounting system for freelancers and small businesses.

**Always read `agentbook/agentbookmvpskill.md` before making changes to AgentBook.** It contains:
- Architecture patterns (7 patterns with rationale)
- Database schema patterns (23 models across 4 schemas)
- Plugin structure patterns (backend + frontend)
- Skill manifest and proactive handler patterns
- Key decisions and their rationale
- Testing patterns and development workflow

### Key docs
- `agentbook/agentbook.md` — Full implementation plan (Phases 0-5)
- `agentbook/agentbookmvpskill.md` — Development skill (patterns, decisions, workflow)
- `agentbook/beyond-mvp.md` — Competitive analysis + roadmap (Phases 6-10)
- `agentbook/architecture.md` — Component design, quality system
- `agentbook/SKILL.md` — Code patterns, constraints, testing standards
- `agentbook/phase01.md` — Phase 0+1 completion summary

### Quick start
```bash
docker compose up -d database
cd packages/database && DATABASE_URL="postgresql://postgres:postgres@localhost:5432/naap" npx --no prisma db push --skip-generate
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/naap" PORT=4050 npx tsx plugins/agentbook-core/backend/src/server.ts &
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/naap" PORT=4051 npx tsx plugins/agentbook-expense/backend/src/server.ts &
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/naap" PORT=4052 npx tsx plugins/agentbook-invoice/backend/src/server.ts &
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/naap" PORT=4053 npx tsx plugins/agentbook-tax/backend/src/server.ts &
cd apps/web-next && npm run dev
# Login: admin@a3p.io / a3p-dev
```

### E2E tests
```bash
cd tests/e2e && npx playwright test --config=playwright.config.ts
# 86 tests, all passing
```
