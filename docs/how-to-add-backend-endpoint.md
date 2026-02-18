# How To: Add a Backend Endpoint

A step-by-step tutorial for adding a new API endpoint to an existing NAAP plugin.

## Prerequisites

- An existing plugin with a backend directory (`backend/src/routes/`)
- If you started with `frontend-only`, re-scaffold with `--template full-stack --simple`

## Option A: Use the CLI (recommended)

```bash
cd my-plugin

# Add a basic endpoint
naap-plugin add endpoint users

# Add a CRUD endpoint with GET, POST, PUT, DELETE
naap-plugin add endpoint products --crud
```

This creates `backend/src/routes/users.ts` and registers it in `backend/src/routes/index.ts`.

### What the CLI generates

For `naap-plugin add endpoint users --crud`:

```typescript
// backend/src/routes/users.ts
import { Router } from 'express';

export const usersRouter = Router();

usersRouter.get('/', async (_req, res) => {
  // TODO: list users
  res.json({ items: [] });
});

usersRouter.get('/:id', async (req, res) => {
  // TODO: get user by id
  res.json({ id: req.params.id });
});

usersRouter.post('/', async (req, res) => {
  // TODO: create user
  res.status(201).json({ ...req.body });
});

usersRouter.put('/:id', async (req, res) => {
  // TODO: update user
  res.json({ id: req.params.id, ...req.body });
});

usersRouter.delete('/:id', async (_req, res) => {
  // TODO: delete user
  res.status(204).send();
});
```

And adds to `backend/src/routes/index.ts`:

```typescript
import { usersRouter } from './users.js';
// ...
router.use('/users', usersRouter);
```

## Option B: Manual Steps

### 1. Create the route file

Create `backend/src/routes/users.ts`:

```typescript
import { Router } from 'express';

export const usersRouter = Router();

usersRouter.get('/', async (_req, res) => {
  res.json({ users: [] });
});
```

### 2. Register in the aggregator

Edit `backend/src/routes/index.ts`:

```typescript
import { usersRouter } from './users.js';

// ... existing code ...

router.use('/users', usersRouter);
```

### 3. Restart the dev server

```bash
naap-plugin dev
```

Your new endpoint is now available at `/api/v1/<plugin-name>/users`.

## Adding a Database Model

If your endpoint needs persistence, add a Prisma model:

```bash
naap-plugin add model User email:String name:String role:String
```

Then push the schema:

```bash
cd packages/database
npx prisma db push
npx prisma generate
```

Import the client in your route:

```typescript
import { prisma } from '@naap/database';

usersRouter.get('/', async (_req, res) => {
  const users = await prisma.user.findMany();
  res.json({ users });
});
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `No backend/src/routes directory found` | Your plugin is frontend-only. Re-scaffold with `--template full-stack --simple` |
| `Route file already exists` | Use `--force` to overwrite, or edit the existing file |
| `Not in a NAAP monorepo` (for `add model`) | The `add model` command only works inside the NAAP monorepo |
