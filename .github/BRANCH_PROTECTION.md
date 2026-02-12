# Branch Protection (optional)

When ready to require CI passing before merge:

1. Go to **Settings** → **Branches** → **Branch protection rules**
2. Add rule for `main` (and optionally `develop`)
3. Enable **Require status checks to pass before merging**
4. Select: `Audit`, `Lint & TypeCheck`, `Build`, `Quality Gates`

This prevents merging PRs with Vercel build failures or critical CVEs.
