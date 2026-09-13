# MCPanel production authentication

MCPanel uses **opaque server-side sessions**. It does not expose JWTs, password hashes, TOTP secrets, recovery-code hashes, session-token hashes, database credentials, Docker credentials, or encryption keys to the browser.

## Security model

- Passwords: Argon2id (`@node-rs/argon2`), 64 MiB memory, 3 iterations, parallelism 1.
- Session cookie: random 256-bit token; only SHA-256 is stored in SQLite. Cookie is `HttpOnly`, `Secure` in production, `SameSite=Strict`, and expires after `SESSION_TTL_HOURS`.
- CSRF: a separate random token is readable by the panel UI and mirrored into `X-CSRF-Token` on authenticated mutations. Only its hash is stored server-side. Production also enforces the configured `Origin`.
- Login abuse: Fastify IP rate limit plus per-account failed-login lockout. Defaults: 5 attempts, 15-minute lockout.
- TOTP: RFC 6238-compatible 6-digit SHA-1 / 30-second codes with ±1 step clock tolerance. The TOTP seed is encrypted at rest with AES-256-GCM under `AUTH_ENCRYPTION_KEY`.
- Recovery codes: ten one-time high-entropy codes. Only keyed HMAC-SHA256 digests are stored. A consumed code is immediately removed.
- Password change: requires the current password and revokes every other active session.
- Sessions: stored in the database, individually revocable, and include created/last-seen/expiry/IP/user-agent metadata.

## Required environment

Generate secrets on the server:

```bash
openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n'   # AUTH_ENCRYPTION_KEY
openssl rand -hex 32                                      # AUTH_RECOVERY_PEPPER
openssl rand -base64 24                                   # ADMIN_PASSWORD
```

For the production split-domain deployment:

```dotenv
APP_ORIGIN=https://panel.example.com
COOKIE_DOMAIN=.example.com
COOKIE_NAME=mc_panel_session
CSRF_COOKIE_NAME=mc_panel_csrf
SESSION_TTL_HOURS=12
LOGIN_LOCKOUT_ATTEMPTS=5
LOGIN_LOCKOUT_MINUTES=15
TOTP_ISSUER=MCPanel
```

`COOKIE_DOMAIN` is needed so JavaScript served from `panel.example.com` can read the **non-secret CSRF cookie** created by `api.example.com`. The HttpOnly session cookie is never readable by JavaScript.

## Bootstrap owner

On first boot only, the API creates `ADMIN_USERNAME` with `ADMIN_PASSWORD` and role `owner`. Changing those environment values later does not overwrite an existing account. Change the generated bootstrap password from the API/UI immediately after first login.

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

The current session cannot be deleted through the individual revoke endpoint; use logout.

### TOTP 2FA

1. `POST /api/auth/2fa/setup`
2. Add the returned one-time seed/`otpauthUri` to an authenticator app.
3. `POST /api/auth/2fa/confirm` with `{ "code": "123456" }`.
4. Store the returned recovery codes offline. They are shown once.

Disable with `POST /api/auth/2fa/disable` and `{ password, code }`.

TOTP setup is the only flow that intentionally returns the newly generated TOTP seed to the authenticated owner, because the authenticator must receive it. It is not returned again after setup. Recovery codes are likewise returned once at enrollment and never stored in plaintext.

## CSRF client behavior

Authenticated `POST`, `PUT`, `PATCH`, and `DELETE` requests must include:

```http
X-CSRF-Token: <value from mc_panel_csrf cookie>
```

The included frontend API helpers add this automatically. Login is protected by strict production Origin validation and its own rate limit.

## Roles and permissions

| Role | server.manage | console.access | files.access | mods.access | backups.access | players.moderate |
|---|---:|---:|---:|---:|---:|---:|
| Owner | yes | yes | yes | yes | yes | yes |
| Admin | yes | yes | yes | yes | yes | yes |
| Moderator | no | yes | no | no | no | yes |
| Viewer | no | no | no | no | no | no |

Read-only overview/metrics/server identity endpoints require authentication but do not require a management permission. Permission checks are performed in the API and WebSocket guards, not just in frontend navigation.

The schema is already multi-user capable even though the current product bootstraps one owner. Future user-management routes can create additional users and assign one of the four roles without changing the session or authorization model.

## Production checklist

1. Generate unique `AUTH_ENCRYPTION_KEY` and `AUTH_RECOVERY_PEPPER` values; never commit them.
2. Use HTTPS only and set `COOKIE_DOMAIN` to the common parent domain.
3. Change the bootstrap owner password after initial login.
4. Enable TOTP and print/store recovery codes offline.
5. Review active sessions after enabling 2FA or changing the password.
6. Back up the control-plane SQLite database; it contains encrypted TOTP seeds and hashed sessions/recovery codes.
7. Treat `AUTH_ENCRYPTION_KEY` and `AUTH_RECOVERY_PEPPER` as backup-critical secrets: loss of the encryption key makes existing TOTP enrollment unreadable.

## Frontend

- `/login` supports password login, TOTP challenge, and recovery-code fallback.
- `/settings/security` supports password rotation, TOTP enrollment, one-time recovery-code display, active-session listing, individual revocation, and “revoke other sessions”.
- Frontend API helpers automatically attach `credentials: include` and `X-CSRF-Token` to state-changing requests.
