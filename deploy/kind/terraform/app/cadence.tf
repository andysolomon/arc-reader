# Cadence, the standalone Reading Practice app, in the same cluster: its own namespace and
# Deployment (the cadence module), reached through ReadAloud's Traefik at /cadence.
#
# Two addresses lead to it, both through the host port the cluster publishes Traefik's web
# entrypoint on (../cluster), so the cluster itself is unchanged:
#   - CADENCE_PUBLIC_URL in .env, for example https://omarchy.tail1b9428.ts.net:8466, on the
#     tailnet. Tailscale maps that port's root onto /cadence.
#   - <the Funnel address>/cadence/ from the internet (funnel.tf), behind READALOUD_ACCESS_TOKEN.
#     Funnel only has ports 443, 8443 and 10000, so Cadence shares ReadAloud's.
variable "cadence_image" {
  type        = string
  default     = null
  description = "Cadence image already loaded into the node, e.g. readaloud-cadence:<commit>. Null leaves Cadence out."
}

variable "cadence_public_url" {
  type    = string
  default = null
  validation {
    condition     = var.cadence_public_url == null || can(regex("^https://[^/:]+(:[0-9]+)?/?$", var.cadence_public_url))
    error_message = "CADENCE_PUBLIC_URL must look like https://<machine>.<tailnet>.ts.net[:port]."
  }
}

module "cadence" {
  count  = var.cadence_image == null ? 0 : 1
  source = "../../../terraform/modules/cadence"
  # ReadAloud's web server answers Cadence's API calls, and its Traefik carries the Ingress.
  depends_on = [module.readaloud]

  image        = var.cadence_image
  access_token = local.env.access_token
}

locals {
  cadence_url = var.cadence_image == null || var.cadence_public_url == null ? null : regex("^https://(?P<host>[^/:]+)(?::(?P<port>[0-9]+))?", var.cadence_public_url)
  cadence = local.cadence_url == null ? null : {
    host = local.cadence_url.host
    port = coalesce(local.cadence_url.port, "443")
    # The Traefik port of public-url.tf, at the path the cadence module's Ingress takes.
    target = "http://127.0.0.1:4179/cadence"
  }
  tailscale_cadence = local.cadence == null ? null : "tailscale serve --bg --yes --https=${local.cadence.port} ${local.cadence.target}"
}

data "external" "tailscale_cadence" {
  count   = local.cadence == null ? 0 : 1
  program = ["${path.module}/../../tailscale-serve-status.sh", local.cadence.port]
}

resource "terraform_data" "tailscale_cadence" {
  count = local.cadence == null ? 0 : 1
  # The address is served once there is something behind it.
  depends_on = [module.cadence]

  triggers_replace = local.cadence
  input            = local.cadence

  lifecycle {
    precondition {
      condition     = data.external.tailscale_cadence[0].result.host == local.cadence.host
      error_message = "CADENCE_PUBLIC_URL names ${local.cadence.host}, but this machine is ${data.external.tailscale_cadence[0].result.host}."
    }
    precondition {
      condition     = !contains(compact([try(local.public.port, ""), try(local.funnel.port, "")]), local.cadence.port)
      error_message = "CADENCE_PUBLIC_URL must use a port of its own, not ReadAloud's."
    }
  }

  provisioner "local-exec" {
    command = local.tailscale_cadence
  }
  provisioner "local-exec" {
    when    = destroy
    command = "tailscale serve --yes --https=${self.output.port} off || true"
  }
}

# Serves the address again when Tailscale lost it, as tailscale_serve_repair does for ReadAloud.
resource "terraform_data" "tailscale_cadence_repair" {
  count      = local.cadence != null && try(data.external.tailscale_cadence[0].result.target, "") != try(local.cadence.target, "") ? 1 : 0
  depends_on = [terraform_data.tailscale_cadence]

  provisioner "local-exec" {
    command = local.tailscale_cadence
  }
}

output "cadence_url" {
  value = local.cadence == null ? null : "https://${local.cadence.host}${local.cadence.port == "443" ? "" : ":${local.cadence.port}"}"
}

output "cadence_funnel_url" {
  value = var.cadence_image == null || local.funnel == null ? null : "https://${data.external.tailscale_funnel[0].result.host}${local.funnel.port == "443" ? "" : ":${local.funnel.port}"}/cadence/"
}
