# AgentBook Test Accounts

## Login Credentials

| Persona | Email | Password | Description |
|---------|-------|----------|-------------|
| **Maya** | `maya@agentbook.test` | `agentbook123` | Canadian IT consultant, Toronto. 3 clients, 99 expenses, 29 invoices, 2 projects. CAD currency. |
| **Alex** | `alex@agentbook.test` | `agentbook123` | US design agency, Austin TX. 5 clients, 29 expenses, 13 invoices, 5 projects. 2 contractors. |
| **Jordan** | `jordan@agentbook.test` | `agentbook123` | Side-hustle, Portland OR. 2 clients (Etsy + writing), 28 expenses (mixed business/personal), split transaction demo. |
| **Admin** | `admin@a3p.io` | `a3p-dev` | Platform admin. Empty AgentBook data. |

## Re-seeding Data

If data gets wiped, re-run:

```bash
cd /Users/qianghan/Documents/mycodespace/a3p
npx tsx agentbook/seed-personas.ts
```

Note: The seed script creates data under tenant IDs `maya-consultant`, `alex-agency`, `jordan-sidehustle`. The user creation script migrates that data to the real user IDs. If users already exist, you may need to re-run the migration or delete and recreate.

## Starting Local Dev

```bash
# Database
docker compose up -d database

# Push schema
cd packages/database
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/naap" DATABASE_URL_UNPOOLED="postgresql://postgres:postgres@localhost:5432/naap" npx prisma db push --skip-generate

# Backends
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/naap" DATABASE_URL_UNPOOLED="postgresql://postgres:postgres@localhost:5432/naap" PORT=4050 npx tsx plugins/agentbook-core/backend/src/server.ts &
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/naap" DATABASE_URL_UNPOOLED="postgresql://postgres:postgres@localhost:5432/naap" PLAID_CLIENT_ID="69d02fa4f1949b000dbfc51e" PLAID_SECRET="59be40029c47288c4db4acfd79ae56" PLAID_ENV="sandbox" PORT=4051 npx tsx plugins/agentbook-expense/backend/src/server.ts &
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/naap" DATABASE_URL_UNPOOLED="postgresql://postgres:postgres@localhost:5432/naap" PORT=4052 npx tsx plugins/agentbook-invoice/backend/src/server.ts &
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/naap" DATABASE_URL_UNPOOLED="postgresql://postgres:postgres@localhost:5432/naap" PORT=4053 npx tsx plugins/agentbook-tax/backend/src/server.ts &

# Frontend (needs 4GB memory)
cd apps/web-next
NODE_OPTIONS="--max-old-space-size=4096" npm run dev
```
