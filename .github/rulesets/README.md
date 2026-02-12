# Repository Rulesets

Importable rulesets for GitHub repository rules.

## Copilot mandatory review

**File:** `copilot-mandatory-review.json`

Enables automatic GitHub Copilot code review on all pull requests, for all branches.

### How to apply

1. Go to **Settings** → **Rules** → **Rulesets**
2. Click **New ruleset** → **Import a ruleset**
3. Browse to `.github/rulesets/copilot-mandatory-review.json`
4. Click **Create**

### What it does

- **Target:** All branches (`~ALL`)
- **Rule:** Automatically request Copilot code review
- **Review draft PRs:** Yes (catch issues early)
- **Review new pushes:** Yes (re-review on each push)

Requires Copilot Pro, Pro+, Business, or Enterprise.
