## Plugin Lifecycle Quality — PR Review

### Phase
<!-- Which phase does this PR belong to? -->
- [ ] Phase 1 — CI/Coverage Gates
- [ ] Phase 2 — SDK Workflow Correctness
- [ ] Phase 3 — Publisher/CDN Reliability
- [ ] Phase 4 — Install/Uninstall Lifecycle
- [ ] Phase 5 — BDD/Script-Driven Automation
- [ ] Phase 6 — Coverage Ratchet

### Summary
<!-- 1-3 bullet points describing what changed and why -->

### Expert Review Checklist (Per Fix)
- [ ] Root cause correctness and edge-case handling verified
- [ ] Failure-path handling and rollback semantics correct
- [ ] Concurrency/race safety (where applicable)
- [ ] Security controls (SSRF/path traversal/input validation/authz)
- [ ] Test adequacy: positive, negative, and regression paths covered
- [ ] Performance and operational impact assessed
- [ ] No regressions to core plugins or examples

### 100-Point Quality Scorecard
<!-- Score each category. Phase must achieve >= 85 total with no category < 60%. -->

| Category | Weight | Score (0-100) | Weighted |
|----------|--------|---------------|----------|
| Correctness & defect closure | 30 | ___ | ___ |
| Test depth & determinism | 25 | ___ | ___ |
| Regression safety & backward compat | 20 | ___ | ___ |
| Security & resilience | 15 | ___ | ___ |
| Maintainability & observability | 10 | ___ | ___ |
| **Total** | **100** | | **___** |

### Regression Impact Statement
<!-- For each fix, describe potential breakage targets -->
- Impacted workflows:
- Potential breakage targets (core plugins, examples):
- Data/contract changes:

### Compatibility Test Evidence
<!-- Paste or link to test run results -->
- [ ] Core plugins build/package smoke: PASS / FAIL
- [ ] SDK compat matrix: PASS / FAIL
- [ ] UMD mount/unmount: PASS / FAIL
- [ ] Lifecycle BDD specs: PASS / FAIL

### Coverage Delta
<!-- Before/after line coverage for affected packages -->
- Before: ___% | After: ___%

### Review Decision
- [ ] Accept
- [ ] Request changes
- [ ] Defer with risk sign-off (owner: ___, due: ___)
