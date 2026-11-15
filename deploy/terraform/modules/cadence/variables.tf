# Cadence, the standalone Reading Practice app, in a cluster that already runs the readaloud
# module: its own namespace, behind the same Traefik, at /cadence on the web entrypoint.
#
# The pod serves the app and its access gate, and forwards the practice engine's API routes
# to ReadAloud's web server, which keeps the judge's key, the speech server and word lookups
# (apps/cadence/vite.server.ts). So Cadence needs no keys of its own beyond the access token.
terraform {
  required_providers {
    kubernetes = { source = "hashicorp/kubernetes", version = "~> 3.5" }
  }
}

variable "image" {
  type        = string
  description = "Cadence image the node can run, e.g. readaloud-cadence:<commit>."
}

variable "api_url" {
  type        = string
  nullable    = false
  default     = "http://web.readaloud.svc.cluster.local:4173"
  description = "ReadAloud's web server, as the Cadence pod reaches it."
}

variable "ingress_class" {
  type        = string
  nullable    = false
  default     = "traefik"
  description = "The readaloud module's Traefik."
}

variable "path" {
  type        = string
  nullable    = false
  default     = "/cadence"
  description = "Where Traefik's web entrypoint sends to Cadence. The app expects this path (MOUNT in apps/cadence/vite.server.ts)."
}

variable "access_token" {
  type        = string
  sensitive   = true
  nullable    = false
  default     = ""
  description = "READALOUD_ACCESS_TOKEN, the same one ReadAloud checks: requests through Tailscale Funnel need it. Empty refuses them all."
}
