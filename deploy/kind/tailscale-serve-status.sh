#!/usr/bin/env bash
# What Tailscale on this machine serves on one HTTPS port, as the JSON object Terraform's
# external data source reads (terraform/app/public-url.tf):
#   {"host": "<this machine's tailnet name>", "target": "<what / on the port proxies to, or empty>"}
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
web = json.loads(os.environ["SERVE"]).get("Web") or {}
handlers = (web.get(f"{host}:{port}") or {}).get("Handlers") or {}
print(json.dumps({"host": host, "target": (handlers.get("/") or {}).get("Proxy", "")}))
PY
