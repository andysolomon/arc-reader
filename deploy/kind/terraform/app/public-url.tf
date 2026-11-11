# The address people open the app at, READALOUD_PUBLIC_URL in .env, for example
# https://omarchy.tail1b9428.ts.net:8449. Tailscale on this machine serves it from the
# host port the cluster publishes Traefik's web entrypoint on (../cluster).
#
# The iOS app is built to load the web app from this same address
# (apps/web/capacitor.config.ts), so a deploy here is also what updates the phone.
# Changing the address means rebuilding the iOS app. Unset, Terraform leaves Tailscale alone.
variable "public_url" {
  type    = string
  default = null
  validation {
    condition     = var.public_url == null || can(regex("^https://[^/:]+(:[0-9]+)?/?$", var.public_url))
    error_message = "READALOUD_PUBLIC_URL must look like https://<machine>.<tailnet>.ts.net[:port]."
  }
}

locals {
  public_url = var.public_url == null ? null : regex("^https://(?P<host>[^/:]+)(?::(?P<port>[0-9]+))?", var.public_url)
  public = local.public_url == null ? null : {
    host = local.public_url.host
    port = coalesce(local.public_url.port, "443")
    # host_port of the Traefik → web mapping in ../cluster/main.tf.
    target = "http://127.0.0.1:4179"
  }
  tailscale_serve = local.public == null ? null : "tailscale serve --bg --yes --https=${local.public.port} ${local.public.target}"
}

data "external" "tailscale_serve" {
  count   = local.public == null ? 0 : 1
  program = ["${path.module}/../../tailscale-serve-status.sh", local.public.port]
}

resource "terraform_data" "tailscale_serve" {
  count = local.public == null ? 0 : 1

  # Replaced when the port or the target changes: the old port is turned off, then the
  # new one is served. The destroy step reads the old port from the stored input.
  triggers_replace = local.public
  input            = local.public

  lifecycle {
    precondition {
      condition     = data.external.tailscale_serve[0].result.host == local.public.host
      error_message = "READALOUD_PUBLIC_URL names ${local.public.host}, but this machine is ${data.external.tailscale_serve[0].result.host}."
    }
  }

  provisioner "local-exec" {
    command = local.tailscale_serve
  }
  provisioner "local-exec" {
    when    = destroy
    command = "tailscale serve --yes --https=${self.output.port} off || true"
  }
}

# Tailscale keeps its serve settings itself, so they can be lost outside Terraform (a
# reset, a reinstall). This exists only while the address is not being served: creating
# it serves the address again, and the next apply, finding it served, drops this.
resource "terraform_data" "tailscale_serve_repair" {
  count      = local.public != null && try(data.external.tailscale_serve[0].result.target, "") != try(local.public.target, "") ? 1 : 0
  depends_on = [terraform_data.tailscale_serve]

  provisioner "local-exec" {
    command = local.tailscale_serve
  }
}

output "public_url" {
  value = local.public == null ? null : "https://${local.public.host}${local.public.port == "443" ? "" : ":${local.public.port}"}"
}
