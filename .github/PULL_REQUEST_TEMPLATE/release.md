## Release Summary

**Version:** <!-- e.g. v1.2.0 -->
**Release Manager:** @<!-- GitHub handle -->

### What's Included

<!-- High-level summary of features, fixes, and changes in this release -->

-
-
-

### Breaking Changes

<!-- List any breaking changes, or write "None" -->

- None

### Pre-tag Checklist

- [ ] All CI checks passing on `main`
- [ ] Production deployment healthy (check `/api/health`)
- [ ] No P0/critical issues open against included plugins
- [ ] Database migrations applied (if applicable)
- [ ] SDK compatibility matrix passing for all 11 plugins
- [ ] Release notes drafted
- [ ] Breaking changes documented and communicated

### Rollback Plan

If issues are detected post-deploy:
1. Trigger the **Deploy** workflow with `rollback` action
2. Investigate the failure from the production logs
3. Open a fix PR against `main`, merge, and re-deploy

### Post-tag Actions

- [ ] Verify production health check passes
- [ ] Monitor error rates for 30 minutes post-deploy
- [ ] Confirm release notes published on GitHub Releases
