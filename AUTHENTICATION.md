# 1315 Panel production authentication

1315 Panel uses **Argon2id passwords plus opaque server-side sessions**. It does not expose JWTs, password hashes, TOTP secrets, recovery-code hashes, session-token hashes, database credentials, Docker credentials, or encryption keys to the browser.

## Security model

- Passwords: Argon2id (`@node-rs/argon2`), 64 MiB memory, 3 iterations, parallelism 1.
- Session cookie: random 256-bit token; only its SHA-256 digest is stored in SQLite. The cookie is `HttpOnly`, `SameSite=Strict`, and expires after `SESSION_TTL_HOURS`.
- Cookie transport: `COOKIE_SECURE=false` only for the temporary HTTP-by-public-IP deployment. Set it to `true` once HTTPS is enabled.
- CSRF: a separate non-secret random token is readable by the frontend and mirrored into `X-CSRF-Token` on authenticated mutations. Only its hash is stored server-side.
- Origin protection: production accepts the configured `APP_ORIGIN`/`PANEL_ORIGIN`; same-origin routing means the frontend and API use the same browser origin in both IP and domain modes.
- Login abuse: Fastify IP rate limit plus per-account failed-login lockout. Defaults are five failed attempts and a 15-minute lockout.
- TOTP: RFC 6238-compatible 6-digit SHA-1 / 30-second codes with ±1 step tolerance. The TOTP seed is encrypted at rest with AES-256-GCM under `AUTH_ENCRYPTION_KEY`.
- Recovery codes: one-time high-entropy codes stored only as keyed HMAC-SHA256 digests.
- Password change: requires the current password and revokes every other active session.
- Sessions: database-backed, individually revocable, with created/last-seen/expiry/IP/user-agent metadata.

## Required environment

The Ubuntu installer generates these values automatically on first boot. Manual generation:

```bash
openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n'   # AUTH_ENCRYPTION_KEY
openssl rand -hex 32                                      # AUTH_RECOVERY_PEPPER
openssl rand -base64 24                                   # ADMIN_PASSWORD
```

### Initial public-IP mode

```dotenv
PANEL_ORIGIN=http://203.0.113.10
COOKIE_DOMAIN=
COOKIE_SECURE=false
COOKIE_NAME=mc_panel_session
CSRF_COOKIE_NAME=mc_panel_csrf
SESSION_TTL_HOURS=12
LOGIN_LOCKOUT_ATTEMPTS=5
LOGIN_LOCKOUT_MINUTES=15
TOTP_ISSUER="1315 Panel"
```

The frontend and backend are same-origin in this mode: `/api/*` and `/ws/*` are reverse-proxied through Caddy. There is no cross-domain cookie requirement.

**Security tradeoff:** HTTP-by-IP is intended only for the initial deployment. `HttpOnly`, SameSite, lockout, and CSRF still work, but HTTP does not encrypt browser traffic. Move to HTTPS as soon as a domain is available.

### Later domain + HTTPS mode

```dotenv
CADDY_SITE_ADDRESS=panel.example.com
PANEL_DOMAIN=panel.example.com
PANEL_ORIGIN=https://panel.example.com
COOKIE_DOMAIN=
COOKIE_SECURE=true
```

The application remains same-origin, so a separate `api.example.com` hostname is unnecessary. Caddy serves `panel.example.com`, routing `/api/*` and `/ws/*` internally to Fastify.

## Bootstrap owner

On first boot only, the API creates `ADMIN_USERNAME` with `ADMIN_PASSWORD` and role `owner`. Changing those environment values later does not overwrite an existing account. Change the generated bootstrap password after first login.

## API

### Login/logout

- `POST /api/auth/login` — `{ username, password, totp?, recoveryCode? }`
- `POST /api/auth/logout`
- `GET /api/auth/me`

### Password

- `POST /api/auth/password` — `{ currentPassword, newPassword }`

Minimum new password length is 14 characters. A successful password change revokes all sessions except the current one.

### Active sessions

- `GET /api/auth/sessions`
- `DELETE /api/auth/sessions/:sessionId`
- `POST /api/auth/sessions/revoke-others`

### TOTP 2FA

1. `POST /api/auth/2fa/setup`
2. Add the returned one-time seed/`otpauthUri` to an authenticator app.
3. `POST /api/auth/2fa/confirm` with `{ "code": "123456" }`.
4. Store the returned recovery codes offline. They are shown once.

Disable with `POST /api/auth/2fa/disable` and `{ password, code }`.

TOTP setup intentionally returns the newly generated seed exactly for enrollment. It is encrypted at rest and is not returned again after confirmation. Recovery codes are also returned once and never stored in plaintext.

## CSRF client behavior

Authenticated `POST`, `PUT`, `PATCH`, and `DELETE` requests include:

```http
X-CSRF-Token: <value from mc_panel_csrf cookie>
```

The frontend API helper adds this automatically. Login has its own rate limit and production Origin validation.

## Roles and permissions

| Role | server.manage | console.access | files.access | mods.access | backups.access | players.moderate |
|---|---:|---:|---:|---:|---:|---:|
| Owner | yes | yes | yes | yes | yes | yes |
| Admin | yes | yes | yes | yes | yes | yes |
| Moderator | no | yes | no | no | no | yes |
| Viewer | no | no | no | no | no | no |

Read-only server identity/metrics endpoints require authentication. Permission checks are enforced in REST/WebSocket guards, not just hidden in the UI.

## Frontend protection

The root application shell calls `GET /api/auth/me` before rendering management pages. An unauthenticated or expired session redirects to `/login`. The shared API client also redirects on backend `401` responses. Logout revokes the current database session and clears both cookies.

## Production checklist

1. Keep generated authentication secrets out of Git.
2. Change the bootstrap owner password after first login.
3. Enable TOTP and keep recovery codes offline.
4. Review active sessions after security changes.
5. Back up the control-plane SQLite database and auth secrets.
6. Use HTTP/IP only temporarily; switch `COOKIE_SECURE=true` after enabling HTTPS.
