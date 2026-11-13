#!/usr/bin/env bash
# What Tailscale on this machine serves on one HTTPS port, as the JSON object Terraform's
# external data source reads (terraform/app/public-url.tf):
#   {"host": "<this machine's tailnet name>", "target": "<what / on the port proxies to, or empty>",
#    "funnel": "true" when the port is open to the internet through Funnel, else "false"}
#   deploy/kind/tailscale-serve-status.sh 8449
set -euo pipefail
port=${1:?usage: $0 <https-port>}
command -v tailscale >/dev/null || { echo "tailscale is not on the PATH" >&2; exit 1; }
self=$(tailscale status --json)
serve=$(tailscale serve status --json)
SELF=$self SERVE=${serve:-{\}} python3 - "$port" <<'PY'
import json, os, sys
port = sys.argv[1]
host = json.loads(os.environ["SELF"])["Self"]["DNSName"].rstrip(".")
serve = json.loads(os.environ["SERVE"])
web = serve.get("Web") or {}
handlers = (web.get(f"{host}:{port}") or {}).get("Handlers") or {}
funnel = bool((serve.get("AllowFunnel") or {}).get(f"{host}:{port}"))
print(json.dumps({"host": host, "target": (handlers.get("/") or {}).get("Proxy", ""), "funnel": str(funnel).lower()}))
PY
