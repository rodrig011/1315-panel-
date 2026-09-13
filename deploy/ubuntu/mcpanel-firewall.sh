#!/usr/bin/env bash
set -euo pipefail

# Docker can bypass UFW for published ports. Enforce the public container-port
# allowlist in DOCKER-USER as well. This deployment intentionally permits only
# HTTP, HTTPS, and the default Minecraft port.
iptables -N MCPANEL-PUBLIC 2>/dev/null || true
iptables -F MCPANEL-PUBLIC
iptables -C DOCKER-USER -j MCPANEL-PUBLIC 2>/dev/null || iptables -I DOCKER-USER 1 -j MCPANEL-PUBLIC

iptables -A MCPANEL-PUBLIC -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
iptables -A MCPANEL-PUBLIC -i lo -j RETURN
# Let containers initiate outbound connections and communicate on Docker bridges.
iptables -A MCPANEL-PUBLIC -s 172.16.0.0/12 -j RETURN
iptables -A MCPANEL-PUBLIC -s 10.0.0.0/8 -j RETURN
iptables -A MCPANEL-PUBLIC -p tcp -m multiport --dports 80,443,25565 -j RETURN
iptables -A MCPANEL-PUBLIC -j DROP
