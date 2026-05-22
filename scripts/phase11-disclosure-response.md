# Phase 11 — Security Disclosure Response

## Reporter acknowledgement (send within 24h of receiving the email)

Reply privately to the reporter. Suggested template:

---

Subject: Re: Security disclosure — NaaP database exposure

Hi,

Thank you for the responsible disclosure. We've confirmed the findings and
have already taken the following immediate actions:

- Rotated the database credentials
- Invalidated all admin sessions and forced password resets
- Removed the leaked connection string from the repository
- Deployed fixes to hash session tokens at rest

We're continuing to harden the remaining items you identified (session token
hashing, CSRF, encryption-at-rest for vault entries) and expect to complete
the full remediation within [X days].

Regarding bounty: we appreciate your responsible approach. While we don't
have a formal bug bounty program at this time, we'd like to offer a
discretionary reward of [$ amount] as thanks for the responsible disclosure.
Please let us know how you'd like to receive it.

We'll also be happy to credit you publicly (with your permission) in our
security advisory.

Thank you again for reaching out — this made a real difference.

Best,
[Your name]
Livepeer / NaaP Team

---

## User notification (after Phase 2 deploys)

Send a single email to all registered users:

---

Subject: Security update for your NaaP account

Hi [name],

We recently received a responsible security disclosure that identified
a vulnerability in how our database credentials were managed. We want
to be transparent about what happened and what we've done.

**What happened**: A database connection credential was inadvertently
committed to our source code repository. A security researcher
identified this and reported it to us through responsible disclosure.

**What we did**:
- Immediately rotated all database credentials
- Invalidated all admin sessions
- Deployed additional security hardening including hashed session tokens,
  stronger password hashing, and improved encryption for stored secrets
- Added automated secret scanning to prevent future leaks

**What you should do**: No action is required on your part. Your password
was not exposed. However, if you'd like to change your password as a
precaution, you can do so here: [reset link]

If you have any questions, please reach out to security@livepeer.org.

---

## Immunefi / bounty considerations

- Check if the reporter's mention of Immunefi contracts means they expect
  a bounty through that platform
- If Livepeer has active contracts on Immunefi, route the disclosure through
  the proper channel
- Even without a formal program, a discretionary reward (e.g., $500–$2000
  depending on severity and effort) is good practice
