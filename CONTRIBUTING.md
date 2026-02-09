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

# 3. Set up the development environment
./bin/setup.sh

# 4. Create a branch
git checkout -b feat/my-team/my-feature

# 5. Make your changes, then open a PR against develop
```

## Branch Strategy

| Branch | Purpose | Deploys To |
|---|---|---|
| `develop` | Staging. All feature PRs target this branch. | Staging (auto-deploy) |
| `main` | Production. Updated weekly via promote workflow. | Production |
| `feat/<team>/<desc>` | New features (e.g., `feat/infra/redis-rate-limit`) | -- |
| `fix/<team>/<desc>` | Bug fixes (e.g., `fix/social/dashboard-auth`) | -- |
| `chore/<desc>` | Tooling, documentation, CI changes | -- |

All work flows through `develop` first. The `main` branch is updated via a
weekly "Promote to Production" workflow managed by core maintainers.

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
- **Staging deploys automatically** after merge to `develop`.

If your changes touch code outside your plugin directory (shared packages,
shell, services), core team reviewers will be assigned automatically via
CODEOWNERS.

## For Core Contributors

Core contributors maintain the shell, shared packages, services, and CI/CD
infrastructure:

- Review cross-cutting PRs that CODEOWNERS assigns to you.
- Weekly: review open RFCs, approve the production release promotion.
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

1. **Open a PR against `develop`** using the branch naming convention above.
2. The **labeler bot auto-labels** the PR based on changed file paths.
3. **CODEOWNERS auto-assigns** the appropriate reviewers (your plugin team
   for plugin changes, core team for shared code).
4. **CI runs path-filtered tests** -- only the affected packages and plugins
   are tested.
5. Address review feedback. All conversations must be resolved.
6. Once **approved**, the PR enters the **merge queue** and merges
   automatically.
7. Merged changes are **auto-deployed to staging**.

Keep PRs focused: one concern per PR. Avoid mixing features with refactors.
Aim for under 400 changed lines when possible.

## Release Process

Production releases happen weekly:

1. A core maintainer triggers the **"Promote to Production"** workflow.
2. A **release PR** is created from `develop` to `main`.
3. The **changelog is auto-generated** from conventional commit messages.
4. Core maintainers review and approve the release PR.
5. The merge queue merges the PR to `main`.
6. **Production deploys** with automated health checks.

## Hotfix Process

For critical production issues that cannot wait for the weekly release:

1. Branch from `main`: `git checkout -b fix/hotfix-description main`
2. Make the minimal fix.
3. Open a PR directly against `main` (mark as emergency).
4. Core maintainer reviews and approves.
5. After merge and deploy, **cherry-pick the fix back to `develop`**:
   `git cherry-pick <commit-hash>` and open a follow-up PR.

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

## Getting Help

- **GitHub Discussions** -- ask architecture questions, propose ideas, or
  request feedback.
- **GitHub Issues** -- report bugs or request features.
- **[Plugin Team Guide](docs/PLUGIN_TEAM_GUIDE.md)** -- self-service
  onboarding for new plugin teams.
