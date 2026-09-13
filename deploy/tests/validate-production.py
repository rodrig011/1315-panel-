from pathlib import Path
import re
import yaml

root = Path(__file__).resolve().parents[2]
compose = yaml.safe_load((root / 'docker-compose.production.yml').read_text())
services = compose['services']

assert set(services['caddy']['ports']) == {'0.0.0.0:80:80', '0.0.0.0:443:443'}
assert 'ports' not in services['backend']
assert 'ports' not in services['frontend']
assert 'ports' not in services['socket-proxy']

for name in ('backend', 'frontend'):
    volumes = services[name].get('volumes', [])
    assert not any('docker.sock' in item for item in volumes), name

proxy_volumes = services['socket-proxy']['volumes']
assert proxy_volumes == ['/var/run/docker.sock:/var/run/docker.sock:ro']
assert services['socket-proxy']['networks'] == ['control']
assert compose['networks']['control']['internal'] is True
assert services['backend']['environment']['DOCKER_HOST'] == 'tcp://socket-proxy:2375'
assert services['frontend']['environment']['NEXT_PUBLIC_API_URL'] == '${API_ORIGIN}'
assert services['caddy']['environment']['PANEL_DOMAIN'] == '${PANEL_DOMAIN}'
assert services['caddy']['environment']['API_DOMAIN'] == '${API_DOMAIN}'

for name, service in services.items():
    assert service.get('privileged') is not True, name

firewall = (root / 'deploy/ubuntu/mcpanel-firewall.sh').read_text()
assert '--dports 80,443,25565' in firewall

env = (root / '.env.example').read_text()
assert 'AUTH_ENCRYPTION_KEY=replace-' in env
assert 'AUTH_RECOVERY_PEPPER=replace-' in env
assert 'ADMIN_PASSWORD=replace-' in env
assert 'PANEL_DOMAIN=panel.example.com' in env
assert 'API_DOMAIN=api.example.com' in env
assert 'API_ORIGIN=https://api.example.com' in env
assert not re.search(r'^AUTH_RECOVERY_PEPPER=[0-9a-f]{64}$', env, re.M)

caddyfile = (root / 'deploy/caddy/Caddyfile').read_text()
assert '{$PANEL_DOMAIN}' in caddyfile and '{$API_DOMAIN}' in caddyfile
assert 'encode br gzip zstd' in caddyfile
assert 'reverse_proxy frontend:3000' in caddyfile
assert 'reverse_proxy backend:4000' in caddyfile
assert (root / 'deploy/caddy/Dockerfile').exists()
assert (root / 'app/healthz/route.ts').exists()
print('production deployment structure: OK')
