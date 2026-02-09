# NaaP Governance

This document describes how the NaaP project is governed, how decisions are
made, and how contributors can grow their involvement.

## Principles

1. **Lazy consensus.** Silence is approval. Proposals proceed unless someone
   objects within the review period.
2. **Plugin autonomy.** Plugin teams have full authority over their own
   directories. Core does not dictate plugin internals.
3. **Async-first.** All coordination happens through PRs, issues, and GitHub
   Discussions. There are no required synchronous meetings.
4. **Machines enforce quality.** CI, linters, CodeQL, and merge queues handle
   the mechanical parts so humans can focus on design and intent.

## Roles

| Role | Who | Responsibilities | How to Join |
|---|---|---|---|
| External Contributor | Anyone | Open issues, submit PRs, participate in Discussions | Just show up |
| Org Member | Contributor with 3+ merged PRs | Triage issues, review non-protected PRs | Invited after 3 merged PRs |
| Plugin Team Member | Member of a plugin team | Review and approve PRs in your plugin directory | Added by your Plugin Team Lead |
| Plugin Team Lead | Lead of a plugin team | Manage team membership, resolve internal conflicts | Named when team is created |
| Core Maintainer | 2 people | Maintain shell, packages, services, CI; approve releases; mediate conflicts | By invitation from existing Core |

## Decision Making: Lazy Consensus

NaaP uses lazy consensus for all decisions:

- **Pull requests** proceed when approved by the assigned reviewers (plugin
  team for plugin code, core for shared code). No additional sign-off is
  required.
- **RFCs** (see below) are auto-approved after **5 business days** with no
  objection. Silence means approval.
- **Core maintainers have final say on shared code only** (shell, packages,
  services, CI). They do not override plugin team decisions within plugin
  directories.

If a decision is contested, the escalation path is:

1. Discussion on the PR or RFC.
2. If unresolved after 3 business days, core maintainers make the call.

## RFC Process

Significant changes to shared infrastructure, the SDK, or cross-cutting
concerns go through an RFC:

1. **Open a GitHub Discussion** in the RFC category with a clear proposal,
   motivation, and alternatives considered.
2. The RFC enters a **5 business day comment period**.
3. **Silence = approval.** If no objections are raised, the RFC is approved.
4. **Objections** are discussed in the thread. If consensus is not reached,
   core maintainers mediate and make the final decision.
5. **Approved RFCs** are converted to a tracking issue with acceptance
   criteria and assigned to the appropriate team.

Plugin-internal changes do not require an RFC. Only changes that affect
shared code or cross-plugin behavior need one.

## Plugin Autonomy

Plugin teams have full authority over their plugin directory
(`plugins/<name>/`). This includes:

- Coding style and internal conventions.
- Testing strategy and coverage requirements.
- Review process and approval standards.
- Internal architecture decisions.

Core enforces only three things for plugins, all via CI:

| Enforcement | Mechanism |
|---|---|
| SDK compatibility | CI runs the compatibility matrix on every PR |
| Security | CodeQL scans run on every PR |
| Commit format | Conventional commit linter runs on every PR |

As long as your plugin builds, passes security scans, and uses conventional
commits, your team is free to operate however it sees fit.

## Team Onboarding (Self-Service)

Adding a new plugin team is a self-service process:

1. **Read the [Plugin Team Guide](docs/PLUGIN_TEAM_GUIDE.md)** to understand
   the architecture and conventions.
2. **Open a PR** that adds:
   - A CODEOWNERS line: `/plugins/<your-plugin>/  @livepeer/<your-team>`
   - A labeler entry in `.github/labeler.yml` for auto-labeling.
3. **Core reviews the PR once** to confirm the team structure and CODEOWNERS
   entry.
4. After merge, your team is **fully autonomous**. No further core approval
   is needed for plugin-only changes.

## Conflict Resolution

- **Between teams:** Open a GitHub Discussion. If unresolved after 3 business
  days, core maintainers mediate and decide.
- **Within a team:** The Plugin Team Lead has final authority on internal
  disputes.
- **Core disagreements:** The two core maintainers discuss asynchronously.
  If they disagree, they default to the more conservative option (the one
  that changes less).

## No Meetings Policy

All project coordination is asynchronous:

- **PRs** for code changes and reviews.
- **GitHub Issues** for bug reports and feature requests.
- **GitHub Discussions** for RFCs, architecture questions, and open-ended
  conversations.

There are no required meetings, standups, or synchronous ceremonies. Teams
may choose to hold their own meetings internally, but the project does not
mandate them.

## Code of Conduct

NaaP follows the
[Contributor Covenant Code of Conduct](https://www.contributor-covenant.org/version/2/1/code_of_conduct/).
All participants are expected to uphold this standard. Report violations to
the core maintainers via GitHub Security Advisories (for private reports) or
by opening an issue.
