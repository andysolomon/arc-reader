# ReadAloud on a single-node Kubernetes cluster: Traefik (traefik.tf) and the apps
# (readaloud.tf). Used by deploy/kind (kind on this laptop) and deploy/aws (k3s on EC2).
#
# The node must have /data/library and /data/preparations, plus /data/voicestudio when
# VoiceStudio runs in the cluster. Traffic enters on Traefik's NodePorts.
terraform {
  required_providers {
    kubernetes = { source = "hashicorp/kubernetes", version = "~> 3.5" }
  }
}

variable "web_image" {
  type        = string
  description = "Web image the node can run, e.g. readaloud-web:<commit> or an ECR URL."
}

variable "voicestudio_image" {
  type        = string
  default     = null
  description = "Run VoiceStudio in the cluster from this image. Null leaves it out; voicestudio_remote_url must then be set."
}

# The node pulls this image itself (it is multi-platform, like Traefik's).
variable "phonon_image" {
  type        = string
  default     = null
  description = "Run Gradium's Phonon speech server in the cluster from this image. Null leaves it out and hides its /api/phonon route."
}

# Measured on the laptop (i7-1355U, 12 threads): one Phonon request on one thread renders at
# about 7.7x real time on 1.5 cores; the server's default of a thread per CPU spins on about
# 9 cores for 5.2x. Two readings at once reach about 10.7x on 3.2 cores, and more add little.
variable "phonon_preparation_slots" {
  type        = number
  nullable    = false
  default     = 2
  description = "Phonon readings prepared at once, one single-threaded request each. The server takes one more for someone listening."
  validation {
    condition     = var.phonon_preparation_slots >= 1 && floor(var.phonon_preparation_slots) == var.phonon_preparation_slots
    error_message = "phonon_preparation_slots must be a whole number of at least 1."
  }
}
variable "phonon_cpus" {
  type        = number
  nullable    = false
  default     = 4
  description = "Most CPUs the Phonon pod may use; a hard ceiling above its slots plus a listener."
}
variable "voicestudio_cpus" {
  type        = number
  nullable    = false
  default     = 2
  description = "Most CPUs the in-cluster VoiceStudio may use, and the threads its models run on. It is overflow for the remote Mac."
  validation {
    condition     = var.voicestudio_cpus >= 1 && floor(var.voicestudio_cpus) == var.voicestudio_cpus
    error_message = "voicestudio_cpus must be a whole number of at least 1."
  }
}

# kind load cannot import multi-platform images; the node pulls this one itself.
variable "traefik_image" {
  type     = string
  nullable = false
  default  = "traefik:v3.7.17"
}

variable "web_node_port" {
  type     = number
  nullable = false
  default  = 30179
}

variable "voicestudio_node_port" {
  type     = number
  nullable = false
  default  = 30900
}

# From .env. An empty remote URL means the web pod uses the in-cluster VoiceStudio;
# with one, the in-cluster VoiceStudio (if any) becomes the secondary.
variable "voicestudio_remote_url" {
  type     = string
  nullable = false
  default  = ""
}
variable "voicestudio_name" {
  type     = string
  nullable = false
  default  = "VoiceStudio"
}
variable "voicestudio_secondary_remote_url" {
  type     = string
  nullable = false
  default  = ""
}
variable "voicestudio_secondary_name" {
  type     = string
  nullable = false
  default  = "Omarchy"
}
variable "llm_url" {
  type     = string
  nullable = false
  default  = "https://opencode.ai/zen/go"
}
variable "preparation_yield_ms" {
  type     = string
  nullable = false
  default  = ""
}
# Article covers (README: Article covers). "off" makes none; empty leaves them on.
variable "covers" {
  type     = string
  nullable = false
  default  = ""
}
# New cover art in any 24 hours. Empty uses the server's default of 200.
variable "cover_daily_limit" {
  type     = string
  nullable = false
  default  = ""
}
variable "voicestudio_asr_model" {
  type     = string
  nullable = false
  default  = "deepdml/faster-whisper-large-v3-turbo-ct2"
}

variable "voicestudio_api_key" {
  type      = string
  sensitive = true
}
variable "voicestudio_secondary_api_key" {
  type      = string
  sensitive = true
  nullable  = false
  default   = ""
}
variable "openai_api_key" {
  type      = string
  sensitive = true
  nullable  = false
  default   = ""
}
variable "fish_api_key" {
  type      = string
  sensitive = true
  nullable  = false
  default   = ""
}
variable "llm_api_key" {
  type      = string
  sensitive = true
  nullable  = false
  default   = ""
}

variable "typesafe_api_key" {
  type      = string
  sensitive = true
  nullable  = false
  default   = ""
}

# Reading Practice's judge: Gemini Decision 1, called directly at Google.
variable "gemini_api_key" {
  type      = string
  sensitive = true
  nullable  = false
  default   = ""
}

variable "access_token" {
  type        = string
  sensitive   = true
  nullable    = false
  default     = ""
  description = "READALOUD_ACCESS_TOKEN: requests through Tailscale Funnel need it (apps/web/vite.gate.ts). Empty refuses them all."
}
