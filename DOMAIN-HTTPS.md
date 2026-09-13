# Production domains, DNS, HTTPS, and Cloudflare

Target hostnames:

- `panel.example.com` → Next.js frontend
- `api.example.com` → Fastify REST + WebSocket API
- `play.example.com` → Minecraft Java server on TCP 25565

## DNS records

At your DNS provider create:

```text
Type  Name   Value            Proxy
A     panel  YOUR_VPS_IPV4    DNS-only or proxied
A     api    YOUR_VPS_IPV4    DNS-only or proxied
A     play   YOUR_VPS_IPV4    DNS-only
```

`panel` and `api` may be proxied through Cloudflare. `play` should normally remain DNS-only because ordinary Cloudflare HTTP proxying does not proxy Minecraft TCP/25565. If you intentionally use Cloudflare Spectrum, configure a Minecraft Spectrum application instead.

Do not create AAAA records unless the VPS actually has working public IPv6 and the firewall is configured for it.

## Optional Minecraft SRV record

An SRV record is only useful when players should connect to a hostname without typing a non-default port. For the default port `25565`, the `A` record alone is enough.

Example for a server listening on port `25570`:

```text
Type:     SRV
Name:     _minecraft._tcp.play
Priority: 0
Weight:   5
Port:     25570
Target:   play.example.com
TTL:      Auto / 300
```

The target must be a hostname, not an IP address. Keep the corresponding `A` record for `play.example.com`.

## Production environment

```dotenv
PANEL_DOMAIN=panel.example.com
API_DOMAIN=api.example.com
PANEL_ORIGIN=https://panel.example.com
API_ORIGIN=https://api.example.com
PUBLIC_HOST=play.example.com
ACME_EMAIL=admin@example.com
```

Then restart/rebuild:

```bash
cd /opt/mcpanel
sudo docker compose --env-file .env -f docker-compose.production.yml up -d --build
```

## HTTPS and certificate renewal

Caddy automatically obtains public certificates for both `panel.example.com` and `api.example.com`, redirects HTTP to HTTPS, stores ACME state under `/opt/mcpanel/caddy/data`, and renews certificates automatically. Ports 80 and 443 must be reachable during issuance/renewal.

The production Caddy image includes the pinned Brotli encoder plugin and serves Brotli, gzip, and zstd when the client supports them.

## WebSockets

No special path rule is required. Caddy's `reverse_proxy` supports HTTP Upgrade/WebSocket connections transparently, so API WebSockets continue to work on URLs such as:

```text
wss://api.example.com/ws/servers/<server-id>/console
wss://api.example.com/ws/servers/<server-id>/metrics
wss://api.example.com/ws/servers/<server-id>/backups
```

## Real client IP

For direct DNS, Caddy forwards the original client through `X-Forwarded-For` and also sets `X-Real-IP` for the Fastify service. `TRUST_PROXY=true` is enabled in production.

When Cloudflare proxying is enabled, the network peer seen by the origin is a Cloudflare address. For security-sensitive IP decisions, either keep the API DNS-only or additionally configure trusted Cloudflare proxy ranges and restrict origin 80/443 access to Cloudflare. Never blindly trust `CF-Connecting-IP` from arbitrary internet clients.

## Cloudflare compatibility

Recommended simple setup:

- `panel`: Proxied (orange cloud) is fine.
- `api`: Proxied is fine for HTTPS and WebSockets.
- `play`: DNS-only (gray cloud) unless using Cloudflare Spectrum.
- Cloudflare SSL/TLS mode: **Full (strict)**.
- Do not use Flexible SSL.
- Leave Caddy HTTPS enabled even when Cloudflare is in front.
- If using Cloudflare WAF/rate limiting, apply stricter rules to `/api/auth/*` and expensive API operations; the Fastify backend also enforces application-level rate limits.

Cloudflare's normal proxy covers HTTP/HTTPS, not raw Minecraft TCP on 25565. Spectrum supports Minecraft Java Edition if you choose that product.

## Rate limiting

Stock HTTP rate limiting remains in Fastify because it understands authenticated API operations and can return consistent API errors. The production backend has a global limit plus tighter limits on sensitive endpoints such as login. If Cloudflare is enabled, edge rate-limit/WAF rules can provide an additional layer.

## Health checks

Public checks:

```bash
curl -fsS https://panel.example.com/healthz
curl -fsS https://api.example.com/healthz
```

Expected JSON:

```json
{"status":"ok","service":"frontend"}
```

and backend:

```json
{"status":"ok"}
```

Container status:

```bash
cd /opt/mcpanel
sudo docker compose --env-file .env -f docker-compose.production.yml ps
```

## HTTPS testing

DNS first:

```bash
dig +short A panel.example.com
dig +short A api.example.com
dig +short A play.example.com
```

HTTP → HTTPS redirect:

```bash
curl -I http://panel.example.com
curl -I http://api.example.com/healthz
```

TLS certificate and protocol:

```bash
curl -vI https://panel.example.com
curl -v https://api.example.com/healthz
openssl s_client -connect panel.example.com:443 -servername panel.example.com </dev/null
openssl s_client -connect api.example.com:443 -servername api.example.com </dev/null
```

Compression:

```bash
curl -I --compressed -H 'Accept-Encoding: br,gzip' https://panel.example.com
```

WebSocket smoke test with `wscat` from a workstation after authentication can target the `wss://api.example.com/ws/...` endpoints. Browser DevTools → Network → WS is the easiest way to confirm the authenticated console/metrics sockets remain connected.

## Cloudflare IP range maintenance

The shipped Caddyfile contains Cloudflare's official IPv4/IPv6 proxy ranges so `{client_ip}` remains trustworthy when `panel` or `api` is orange-cloud proxied. Cloudflare says these ranges do not change frequently but publishes updates before using new ranges. During upgrades, compare:

```bash
curl -fsS https://www.cloudflare.com/ips-v4/
curl -fsS https://www.cloudflare.com/ips-v6/
```

with `deploy/caddy/Caddyfile`, then rebuild/reload Caddy if the ranges changed.
