# The public address for the iOS app, READALOUD_FUNNEL_PORT in .env, for example 10000:
# Tailscale Funnel serves the app at https://<this machine>.<tailnet>.ts.net:<port> to the
# whole internet, so the phone reaches it without the iOS Tailscale client, which can
# stall. It leads to the same Traefik port as the tailnet address.
#
# The web server refuses every Funnel request that lacks READALOUD_ACCESS_TOKEN
# (apps/web/vite.gate.ts), so the token must be set, and the Funnel opens only after the
# web Deployment running that check has rolled out. The iOS app is built with the token
# and READALOUD_APP_URL set to this address (apps/web/capacitor.config.ts).
# Unset, Terraform leaves Funnel alone.
variable "funnel_port" {
  type    = number
  default = null
  validation {
    # The only ports Funnel serves.
    condition     = var.funnel_port == null || contains([443, 8443, 10000], coalesce(var.funnel_port, 0))
    error_message = "READALOUD_FUNNEL_PORT must be 443, 8443 or 10000."
  }
}

locals {
  funnel = var.funnel_port == null ? null : {
    port   = tostring(var.funnel_port)
    target = "http://127.0.0.1:4179" # the same Traefik port as public-url.tf
  }
  tailscale_funnel = local.funnel == null ? null : "tailscale funnel --bg --yes --https=${local.funnel.port} ${local.funnel.target}"
}

data "external" "tailscale_funnel" {
  count   = local.funnel == null ? 0 : 1
  program = ["${path.module}/../../tailscale-serve-status.sh", local.funnel.port]
}

resource "terraform_data" "tailscale_funnel" {
  count = local.funnel == null ? 0 : 1
  # The rollout of the web server that checks the token.
  depends_on = [module.readaloud]

  triggers_replace = local.funnel
  input            = local.funnel

  lifecycle {
    precondition {
      condition     = length(nonsensitive(coalesce(local.env.access_token, ""))) >= 32
      error_message = "Set READALOUD_ACCESS_TOKEN in .env (at least 32 characters, e.g. openssl rand -base64 32) before opening the Funnel."
    }
    precondition {
      condition     = local.public == null || try(local.public.port, "") != local.funnel.port
      error_message = "READALOUD_FUNNEL_PORT must differ from the port in READALOUD_PUBLIC_URL."
    }
  }

  provisioner "local-exec" {
    command = local.tailscale_funnel
  }
  provisioner "local-exec" {
    when    = destroy
    command = "tailscale funnel --yes --https=${self.output.port} off || true"
  }
}

# Re-opens the Funnel when Tailscale lost it, as tailscale_serve_repair does for the
# tailnet address.
resource "terraform_data" "tailscale_funnel_repair" {
  count = local.funnel != null && (
    try(data.external.tailscale_funnel[0].result.target, "") != try(local.funnel.target, "") ||
    try(data.external.tailscale_funnel[0].result.funnel, "") != "true"
  ) ? 1 : 0
  depends_on = [terraform_data.tailscale_funnel]

  provisioner "local-exec" {
    command = local.tailscale_funnel
  }
}

output "funnel_url" {
  value = local.funnel == null ? null : "https://${data.external.tailscale_funnel[0].result.host}${local.funnel.port == "443" ? "" : ":${local.funnel.port}"}"
}
