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

### Pre-merge Checklist

- [ ] All CI checks passing on `develop`
- [ ] Staging deployment verified and smoke-tested
- [ ] No P0/critical issues open against included plugins
- [ ] Database migrations reviewed (if applicable)
- [ ] SDK compatibility matrix passing for all 11 plugins
- [ ] Release notes drafted
- [ ] Breaking changes documented and communicated

### Rollback Plan

If issues are detected post-deploy:
1. Trigger the **Deploy** workflow with `rollback` action
2. Investigate the failure from the production logs
3. Fix on `develop`, re-test, and re-promote

### Post-merge Actions

- [ ] Tag the release: `git tag <version> && git push origin <version>`
- [ ] Verify production health check passes
- [ ] Monitor error rates for 30 minutes post-deploy
- [ ] Update changelog / release notes
