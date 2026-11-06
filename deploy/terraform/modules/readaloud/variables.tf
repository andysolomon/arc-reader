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
