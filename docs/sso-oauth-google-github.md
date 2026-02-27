# SSO with Google & GitHub (OAuth 2.0)

A developer guide for the NaaP platform's Single Sign-On implementation, from setup to in-depth concepts.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Getting Started](#2-getting-started)
3. [Architecture](#3-architecture)
4. [End-to-End Flow](#4-end-to-end-flow)
5. [Code Reference](#5-code-reference)
6. [Configuration](#6-configuration)
7. [Database Schema](#7-database-schema)
8. [Security](#8-security)
9. [Testing](#9-testing)
10. [Troubleshooting](#10-troubleshooting)
11. [Extending: Add a New Provider](#11-extending-add-a-new-provider)
12. [In-Depth: OAuth 2.0 Concepts](#12-in-depth-oauth-20-concepts)

---

## 1. Overview

### What is implemented

- **Google OAuth 2.0**: Sign in with a Google account
- **GitHub OAuth**: Sign in with a GitHub account

Both use the OAuth 2.0 Authorization Code flow. Users can log in via email/password or choose a provider; OAuth users are created or linked on first sign-in.

### Key terms

| Term | Meaning |
|------|---------|
| **OAuth** | Open standard for delegated authorization. Users grant your app limited access without sharing passwords. |
| **Provider** | Identity provider (Google, GitHub). |
| **Authorization code** | Short-lived code returned by the provider after user consent; exchanged for an access token. |
| **State** | Random string sent at start and returned on callback; prevents CSRF. |
| **Redirect URI** | Where the provider redirects after consent. Must match exactly what you configure in the provider's console. |

---

## 2. Getting Started

### Prerequisites

- Node.js 18+ and pnpm
- PostgreSQL (via `DATABASE_URL`)
- A Google Cloud project and GitHub OAuth App for credentials

### Step 1: Create OAuth apps

**Google**

1. Go to [Google Cloud Console → APIs & Credentials](https://console.cloud.google.com/apis/credentials).
2. Create an OAuth 2.0 Client ID (Web application).
3. Add authorized redirect URI:
   - **Local**: `http://localhost:3000/api/v1/auth/callback/google`
   - **Production**: `https://<your-domain>/api/v1/auth/callback/google`

**GitHub**

1. Go to [GitHub → Settings → Developer settings → OAuth Apps](https://github.com/settings/developers).
2. New OAuth App.
3. Set Authorization callback URL:
   - **Local**: `http://localhost:3000/api/v1/auth/callback/github`
   - **Production**: `https://<your-domain>/api/v1/auth/callback/github`

### Step 2: Configure environment

Copy `.env.local.example` to `.env.local` and add:

```env
# Required for OAuth
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret

# App URL (used to derive redirect URIs if not set explicitly)
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### Step 3: Run and test

```bash
pnpm dev
```

Open `/login` and click "Google" or "GitHub". After consent, you should be redirected to `/dashboard`.

---

## 3. Architecture

### High-level components

```
┌──────────────────┐     ┌─────────────────────────┐     ┌──────────────────┐
│   Login Page     │────▶│  Next.js API Routes     │────▶│  Google / GitHub  │
│   (React)        │     │  /api/v1/auth/*        │     │  OAuth endpoints  │
└──────────────────┘     └─────────────────────────┘     └──────────────────┘
         │                            │
         │                            │ callback
         │                            ▼
         │                   ┌─────────────────────┐
         │                   │  auth.ts (lib/api)  │
         │                   │  - getOAuthUrl     │
         │                   │  - handleOAuthCallback
         └──────────────────▶│  - Prisma (User,   │
                              │    OAuthAccount)  │
                              └─────────────────────┘
```

### Deployment modes

1. **Next.js only** (default): OAuth logic and API routes live in `apps/web-next`.
2. **Hybrid**: `base-svc` (Express) can also handle OAuth via `services/base-svc/src/routes/auth.ts` when `FRONTEND_URL` and credentials are set there.

Most production deploys use the Next.js API routes.

---

## 4. End-to-End Flow

### Sequence

```
User                Browser/Next.js              Google/GitHub
  │                         │                          │
  │  1. Click "Google"      │                          │
  │────────────────────────▶                          │
  │                         │  2. GET /api/v1/auth/oauth/google
  │                         │     → returns url + sets oauth_state cookie
  │                         │                          │
  │  3. Redirect to Google  │─────────────────────────▶│
  │                         │                          │
  │  4. User approves       │                          │
  │                         │  5. Redirect back with code + state
  │                         │◀─────────────────────────│
  │                         │                          │
  │                         │  6. GET /api/v1/auth/callback/google?code=...&state=...
  │                         │     - Verify state === oauth_state cookie
  │                         │     - Exchange code for access token
  │                         │     - Fetch user info
  │                         │     - Find or create User + OAuthAccount
  │                         │     - Create Session, set naap_auth_token cookie
  │                         │                          │
  │  7. Redirect /dashboard │                          │
  │◀────────────────────────│                          │
```

### Redirect URI

- Google callback: `{appUrl}/api/v1/auth/callback/google`
- GitHub callback: `{appUrl}/api/v1/auth/callback/github`

`appUrl` is derived from `NEXT_PUBLIC_APP_URL`, `VERCEL_URL`, or `http://localhost:3000`.

---

## 5. Code Reference

### Frontend

| File | Purpose |
|------|---------|
| `apps/web-next/src/app/(auth)/login/page.tsx` | Login UI; Google/GitHub buttons call `loginWithOAuth(provider)`. |
| `apps/web-next/src/contexts/auth-context.tsx` | `loginWithOAuth` fetches OAuth URL and redirects. |

### API routes

| File | Route | Purpose |
|------|-------|---------|
| `apps/web-next/src/app/api/v1/auth/oauth/[provider]/route.ts` | `GET /api/v1/auth/oauth/:provider` | Generate OAuth URL, set `oauth_state` cookie, return URL. |
| `apps/web-next/src/app/api/v1/auth/callback/[provider]/route.ts` | `GET /api/v1/auth/callback/:provider` | Handle redirect: verify state, exchange code, create session, set auth cookie. |
| (same) | `POST /api/v1/auth/callback/:provider` | Alternative callback for frontend-initiated flows (e.g. popup). |

### Core logic

| File | Functions |
|------|-----------|
| `apps/web-next/src/lib/api/auth.ts` | `getOAuthConfig()`, `getOAuthUrl()`, `handleOAuthCallback()`, `generateCSRFToken()` |

### Backend service (base-svc, hybrid mode)

| File | Route / Function | Purpose |
|------|------------------|---------|
| `services/base-svc/src/routes/auth.ts` | `GET /auth/oauth/:provider` | Return OAuth URL (JSON). |
| | `POST /auth/callback/:provider` | Handle callback (JSON response with token). |
| `services/base-svc/src/services/auth.ts` | `getOAuthUrl()`, `handleOAuthCallback()` | Same logic as Next.js `auth.ts`. |

---

## 6. Configuration

### Environment variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `GOOGLE_CLIENT_ID` | For Google | OAuth client ID. |
| `GOOGLE_CLIENT_SECRET` | For Google | OAuth client secret. |
| `GITHUB_CLIENT_ID` | For GitHub | OAuth app client ID. |
| `GITHUB_CLIENT_SECRET` | For GitHub | OAuth app client secret. |
| `GOOGLE_REDIRECT_URI` | Optional | Override default `{appUrl}/api/v1/auth/callback/google`. |
| `GITHUB_REDIRECT_URI` | Optional | Override default `{appUrl}/api/v1/auth/callback/github`. |
| `NEXT_PUBLIC_APP_URL` | Recommended | App root URL (e.g. `https://naap-platform.vercel.app`). |

### OAuth scopes

- **Google**: `openid email profile`
- **GitHub**: `user:email`

---

## 7. Database Schema

### User

```prisma
model User {
  id            String    @id @default(uuid())
  email         String?   @unique      // May be null for GitHub users with private email
  passwordHash  String?                 // Null for OAuth-only users
  displayName   String?
  avatarUrl     String?
  oauthAccounts OAuthAccount[]
  // ... sessions, roles, etc.
}
```

### OAuthAccount

```prisma
model OAuthAccount {
  id                String   @id @default(uuid())
  userId            String
  user              User     @relation(...)
  provider          String   // "google" | "github"
  providerAccountId String   // Provider's user ID
  @@unique([provider, providerAccountId])
}
```

One user can have multiple OAuth providers. `provider` + `providerAccountId` uniquely identify an external account.

### Session

After successful OAuth, a `Session` is created and a hex token stored (via `naap_auth_token` cookie). Subsequent requests use `Authorization: Bearer <token>` or the cookie.

---

## 8. Security

### State (CSRF)

- On OAuth start: a random `state` is generated and stored in an `oauth_state` cookie.
- The same `state` is appended to the OAuth URL.
- On callback: `state` from the URL must equal the `oauth_state` cookie.
- If they differ → redirect to `/login?error=invalid_state`.

### Cookies

| Cookie | Purpose |
|--------|---------|
| `oauth_state` | Temporary CSRF token for OAuth (httpOnly, 10 min). |
| `naap_auth_token` | Session token (httpOnly, 7 days, sameSite=lax). |

### Error handling

- OAuth errors (e.g. `access_denied`) are validated against known codes before being shown.
- Generic failures redirect to `/login?error=...` with a safe message.

### Rate limiting

- Auth callbacks use `authLimiter` in the backend routes to limit requests.

---

## 9. Testing

### Unit tests

```bash
cd apps/web-next && pnpm test
```

Auth API tests are in `apps/web-next/src/__tests__/api/auth.test.ts`. Prisma is mocked for `oAuthAccount`, `user`, `session`, etc.

### Manual testing

1. Configure credentials in `.env.local`.
2. Open `/login` and click Google or GitHub.
3. Complete consent on the provider and verify redirect to `/dashboard`.
4. Test error cases by revoking consent or using an invalid state.

### Testing without credentials

If OAuth vars are unset, `getOAuthUrl` returns `null` and the UI shows "OAuth provider X is not configured".

---

## 10. Troubleshooting

| Issue | Likely cause | Fix |
|-------|--------------|-----|
| "OAuth provider X is not configured" | Missing or empty `*_CLIENT_ID` / `*_CLIENT_SECRET` | Add them to `.env.local` and restart. |
| Redirect URI mismatch | Callback URL in provider console ≠ app callback | Ensure exact match (scheme, host, path). |
| invalid_state | Cookie missing or wrong domain | Check `sameSite`, `secure`, and `path` for `oauth_state`. |
| No email for GitHub user | User has private email | We use `primary` email from `/user/emails`; if all private, `email` can be null. |
| CORS / cookie issues | Cross-origin requests | Ensure `credentials: 'include'` and correct `NEXT_PUBLIC_APP_URL`. |

---

## 11. Extending: Add a New Provider

To add a provider (e.g. Microsoft):

### 1. Extend types and config

In `apps/web-next/src/lib/api/auth.ts`:

```typescript
// OAuthConfig
microsoft?: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

// getOAuthConfig()
if (process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET) {
  config.microsoft = {
    clientId: process.env.MICROSOFT_CLIENT_ID,
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
    redirectUri: process.env.MICROSOFT_REDIRECT_URI || `${appUrl}/api/v1/auth/callback/microsoft`,
  };
}
```

### 2. Implement getOAuthUrl and handleOAuthCallback

- Add a branch in `getOAuthUrl` for `provider === 'microsoft'` to build the auth URL.
- In `handleOAuthCallback`, add logic to exchange the code for tokens and fetch user info.

### 3. Add route handlers

- Ensure `oauth/[provider]` and `callback/[provider]` accept `"microsoft"` (and similar guards in `base-svc` if used).

### 4. Add UI

- Add a button in `login/page.tsx` that calls `handleOAuth('microsoft')`.

### 5. Database

- No schema change: `OAuthAccount.provider` is a string, so `"microsoft"` works as-is.

---

## 12. In-Depth: OAuth 2.0 Concepts

### Authorization Code flow

1. **Redirect**: App sends the user to the provider with `client_id`, `redirect_uri`, `scope`, `state`, `response_type=code`.
2. **Consent**: User logs in and approves requested scopes.
3. **Callback**: Provider redirects to `redirect_uri?code=...&state=...`.
4. **Token exchange**: App exchanges `code` for `access_token` via a server-side request with `client_secret`.
5. **User info**: App calls the provider’s userinfo API with the access token.

### Why the code is exchanged server-side

- The authorization code is exchanged for tokens on the server, where `client_secret` is stored.
- This keeps the secret out of the browser and reduces token exposure.

### Token usage

- We exchange the code for an access token to fetch user info.
- We do **not** store the provider’s access token in `OAuthAccount` for long-term use in this flow (those fields are optional and may be used for future features).

### Linking accounts

- On first OAuth login: create `User` (if needed) and `OAuthAccount`, then create a session.
- On later logins: find `OAuthAccount` by `provider` + `providerAccountId`, reuse existing `User`, create session.
- If an existing `User` shares the same email, we link the new `OAuthAccount` to that user.

---

## Quick links

| Resource | URL |
|----------|-----|
| Google OAuth 2.0 docs | https://developers.google.com/identity/protocols/oauth2 |
| GitHub OAuth docs | https://docs.github.com/en/apps/oauth-apps |
| Google credentials | https://console.cloud.google.com/apis/credentials |
| GitHub OAuth apps | https://github.com/settings/developers |
