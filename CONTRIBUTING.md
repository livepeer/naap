# Contributing to NaaP

Thank you for your interest in contributing to NaaP. Whether you are a plugin
team member, a core contributor, or someone opening your first pull request,
this guide will help you get started.

## Quick Start

```bash
# 1. Fork the repository on GitHub
# 2. Clone your fork
git clone https://github.com/<your-username>/NaaP.git
cd NaaP

# 3. First-time setup (installs deps, starts DB, builds plugins, starts platform)
./bin/setup.sh --start

# 4. Create a branch from main
git checkout -b feat/my-team/my-feature

# 5. Start developing (~6s)
./bin/start.sh --fast            # auto-detects your changed plugins
# or start a specific plugin:
./bin/start.sh community         # shell + community backend

# 6. Make your changes, then open a PR against main
```

## Branch Strategy

NaaP uses a **feature-branch-off-main** (trunk-based) model. All PRs target
`main` directly. Vercel PR previews serve as staging for each PR.

| Branch | Purpose | Deploys To |
|---|---|---|
| `main` | Production. Single source of truth. | Production (auto-deploy) |
| `feat/<team>/<desc>` | New features (e.g., `feat/infra/redis-rate-limit`) | PR preview (auto) |
| `fix/<team>/<desc>` | Bug fixes (e.g., `fix/social/dashboard-auth`) | PR preview (auto) |
| `chore/<desc>` | Tooling, documentation, CI changes | PR preview (auto) |

All work flows through feature branches into `main`. Every PR gets an
automatic Vercel preview URL for testing before merge. Merging to `main`
triggers production deployment with automated health checks and rollback.

## For Plugin Teams

Plugin teams are self-governing. If your changes are confined to your plugin
directory, the process is straightforward:

- **Your team owns your plugin directory.** You decide the code style, review
  standards, and internal conventions for `plugins/<your-plugin>/`.
- **CODEOWNERS auto-assigns your team** as reviewers when a PR touches your
  plugin.
- **You review and approve your own PRs.** No core team involvement is needed
  for plugin-only changes.
- **Merge queue merges automatically** once your PR is approved and CI passes.
- **Production deploys automatically** after merge to `main`.

If your changes touch code outside your plugin directory (shared packages,
shell, services), core team reviewers will be assigned automatically via
CODEOWNERS.

## For Core Contributors

Core contributors maintain the shell, shared packages, services, and CI/CD
infrastructure:

- Review cross-cutting PRs that CODEOWNERS assigns to you.
- SDK changes must pass the compatibility matrix before merging (CI enforces
  this).
- Breaking changes to shared packages require an RFC and a migration guide.

## Commit Conventions

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short description>

<optional body>
```

**Types:**

| Type | Use For |
|---|---|
| `feat` | New feature |
| `fix` | Bug fix |
| `refactor` | Code restructuring (no behavior change) |
| `docs` | Documentation only |
| `test` | Adding or updating tests |
| `chore` | Tooling, CI, dependencies |
| `perf` | Performance improvement |

**Scopes:** `shell`, `sdk`, `plugin/<name>`, `base-svc`, `infra`, `ci`, `docs`

**Examples:**

```
feat(sdk): add usePluginConfig hook for team-scoped settings
fix(plugin/community): handle empty post list gracefully
refactor(base-svc): extract auth routes into separate module
docs(sdk): update quick start for CLI changes
chore(ci): add plugin build matrix to workflow
```

## PR Process

1. **Open a PR against `main`** using the branch naming convention above.
2. The **labeler bot auto-labels** the PR based on changed file paths.
3. **CODEOWNERS auto-assigns** the appropriate reviewers (your plugin team
   for plugin changes, core team for shared code).
4. **CI runs path-filtered tests** -- only the affected packages and plugins
   are tested.
5. **Copilot and CodeRabbit** provide automated code review on every PR.
6. Address review feedback. All conversations must be resolved.
7. Once **approved**, the PR enters the **merge queue** and merges
   automatically.
8. Merged changes are **auto-deployed to production** with health checks.

Keep PRs focused: one concern per PR. Avoid mixing features with refactors.
Aim for under 400 changed lines when possible.

## Release Process

Releases are continuous -- every merge to `main` deploys to production:

1. A PR is merged to `main` after CI and review approval.
2. Production deployment runs automatically with health checks.
3. If health checks fail, automatic rollback is triggered.
4. Version tagging is done on-demand via the **"Tag Release"** workflow.
5. Release notes are auto-generated from conventional commit messages.

## Hotfix Process

Since all PRs target `main`, the hotfix process is the same as normal
development:

1. Branch from `main`: `git checkout -b fix/hotfix-description main`
2. Make the minimal fix.
3. Open a PR against `main`.
4. Core maintainer reviews and approves.
5. Merge -- production deploys automatically.

## Code Style

- **TypeScript** for all source code. Strict mode is enabled.
- **Prettier** for formatting (auto-applied via config).
- **ESLint** for linting.
- Follow existing patterns in the codebase. When in doubt, match what is
  already there.

### Naming Conventions

| Kind | Convention | Example |
|---|---|---|
| Utility files | `kebab-case.ts` | `auth-helpers.ts` |
| React components | `PascalCase.tsx` | `PluginHost.tsx` |
| Variables and functions | `camelCase` | `getUserTeams` |
| Types and interfaces | `PascalCase` | `PluginManifest` |
| Constants | `UPPER_SNAKE_CASE` | `MAX_RETRY_COUNT` |
| CSS | Tailwind utilities | No custom CSS unless necessary |

## Architecture Principles

- **No duplication.** Use shared packages (`@naap/plugin-utils`,
  `@naap/plugin-build`, `@naap/types`).
- **Plugin isolation.** Plugins must not import from other plugins. Use the
  event bus for cross-plugin communication.
- **Shell does not know plugins.** No hardcoded plugin names, icons, or
  routes in the shell. Everything is driven by `plugin.json` manifests
  registered at runtime.
- **No premature abstraction.** Solve the problem at hand. Add abstractions
  only when a pattern repeats.

## Testing Requirements

- **SDK changes:** Must include unit tests. Coverage must not decrease.
- **Plugin backends:** Include health check and basic endpoint tests at
  minimum.
- **Shell changes:** Manual smoke test with at least 2 plugins loaded.
- **Breaking changes:** Must include migration notes in the PR description.

## Development Startup

After first-time `./bin/setup.sh`, use `start.sh` for all daily development:

```bash
./bin/start.sh --fast                     # Smart start (~6s): auto-detects changed plugins
./bin/start.sh community                  # Shell + one plugin (~6s)
./bin/start.sh gateway-manager community  # Shell + two plugins (~8s)
./bin/start.sh start --all               # Everything (~10s warm, ~25s cold)
./bin/start.sh stop                       # Parallel stop (~2s)
```

The `--fast` flag is the recommended daily driver. It skips redundant DB
syncs and verification, rebuilds only changed plugins, and starts only
what you need. See [bin/README.md](bin/README.md) for the full CLI reference.

## Pre-Push Automation

`./bin/setup.sh` installs a git pre-push hook that runs fast validation
before every push:

- Builds `@naap/plugin-build` (required for plugin vite configs)
- Runs plugin-sdk tests

```bash
npm run ci-check          # Run manually (~15-30s)
npm run ci-check:full     # Full vercel-build (~2 min)
git push --no-verify      # Skip when necessary
```

## Manual Steps & Further Automation

| Step | Automatable? | Current | To Reduce Human Involvement |
|------|--------------|---------|-----------------------------|
| Run `ci-check` before push | ✅ Done | Pre-push hook installed by setup | — |
| Run full build before PR | Partial | `ci-check:full` exists | Add optional CI job that fails if vercel-build would fail on main |
| Update tests when refactoring | Partial | CI fails and surfaces it | Add pre-commit lint that suggests running tests when codegen/sdk changes |
| Keep plugin-build exports as dist/ | Documentation | README warns | Add CI check: fail if plugin-build exports `.ts` in package.json |
| Request PR review | Manual | CODEOWNERS + Copilot | Already automated where possible |
| Merge after CI passes | Partial | Merge queue / auto-merge | Enable merge queue if not already |

## Getting Help

- **GitHub Discussions** -- ask architecture questions, propose ideas, or
  request feedback.
- **GitHub Issues** -- report bugs or request features.
- **[Plugin Team Guide](docs/PLUGIN_TEAM_GUIDE.md)** -- self-service
  onboarding for new plugin teams.
