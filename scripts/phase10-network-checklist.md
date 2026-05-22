# Phase 10 — Network Surface Hardening Checklist

## Prerequisites (check BOTH before proceeding)

- [ ] **Neon plan supports IP allowlists** — This requires Neon Scale or Business plan.
      Check: Neon Console → Project Settings → Networking → IP Allow.
      If the option is not available, **skip this phase** and document the gap.

- [ ] **Vercel has stable egress IPs** — Required for allowlisting.
      Options:
      - Vercel Secure Compute (reserved egress IPs per team)
      - Vercel ↔ Neon native Private Networking integration
      If neither is available on your plan, **skip this phase**.

## If prerequisites are met

1. Collect Vercel egress IP ranges from Vercel Dashboard → Project → Settings → Secure Compute
2. Identify team bastion/VPN IP (for direct Neon console access)
3. In Neon Console → Project Settings → IP Allow:
   - Add Vercel egress CIDR ranges
   - Add team bastion IP
4. **Roll out to Preview environment first** — point a Preview deployment at Neon
5. Run the full e2e suite against Preview for 48 hours
6. If green, enable the same allowlist on the **Production** Neon branch
7. Verify production health: `GET /api/health` returns `{ status: 'healthy' }`

## SSL verification

- [ ] Confirm Neon project-level setting: "Require SSL" is ON
      (The app URLs already have `?sslmode=require`, but the project setting enforces it for all clients)

## If prerequisites are NOT met

Document this in the team's security tracker:
> "Phase 10 deferred: Neon plan does not support IP allowlists / Vercel plan does not provide stable egress IPs. Revisit when infrastructure is upgraded."
