# Security Policy

## Supported Versions

| Version | Supported |
|---|---|
| Latest release on `main` | Yes |
| `develop` (staging) | Best-effort |
| Older releases | No |

Only the current production release (the latest code on the `main` branch)
receives security fixes. The `develop` branch receives fixes as part of
normal development flow.

## Reporting a Vulnerability

**Do not open a public issue for security vulnerabilities.**

Please use [GitHub Security Advisories](https://github.com/livepeer/NaaP/security/advisories/new)
to report vulnerabilities privately. This ensures the issue is handled
confidentially until a fix is available.

When reporting, please include:

- A description of the vulnerability and its potential impact.
- Steps to reproduce (or a proof of concept).
- The affected component (shell, service, plugin, package).
- Any suggested fix, if you have one.

## Response Timeline

| Severity | Initial Response | Fix Target |
|---|---|---|
| Critical (data breach, RCE, auth bypass) | 48 hours | Patch within 48 hours |
| High (privilege escalation, data leak) | 48 hours | Patch within 1 week |
| Medium (XSS, CSRF, info disclosure) | 1 week | Patch within 2 weeks |
| Low (hardening, best practice) | 2 weeks | Next scheduled release |

## Disclosure Policy

NaaP follows a **coordinated disclosure** process:

1. Reporter submits vulnerability via GitHub Security Advisories.
2. Core maintainers acknowledge receipt within the response timeline above.
3. A fix is developed privately within the advisory.
4. Once the fix is ready, a new release is published and the advisory is
   made public.
5. The reporter is credited in the advisory (unless they prefer anonymity).

We ask reporters to allow us reasonable time to address the issue before
public disclosure. We commit to keeping reporters informed of progress
throughout the process.

## Scope

The following are in scope for security reports:

- The NaaP shell (`apps/web-next/`)
- Core services (`services/`)
- Shared packages (`packages/`)
- Plugin SDK (`packages/plugin-sdk/`)
- CI/CD configuration (`.github/workflows/`)

Plugin-specific vulnerabilities should be reported to the plugin team first.
If the vulnerability has platform-wide impact, report it through the process
above.
