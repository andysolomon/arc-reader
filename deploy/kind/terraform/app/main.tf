# Everything that runs in the kind cluster from ../cluster: the readaloud module, with
# VoiceStudio and Phonon in the cluster. deploy.sh applies it on every deploy, after loading the
# images into the node, and sets the variables from the root .env (env.tf). public-url.tf
# has Tailscale serve the app at its tailnet address.
terraform {
  required_version = ">= 1.6"
  required_providers {
    kubernetes = { source = "hashicorp/kubernetes", version = "~> 3.5" }
    external   = { source = "hashicorp/external", version = "~> 2.3" }
  }
  # terraform.sh passes the path, outside the repository, so every checkout shares one state.
  backend "local" {}
}

provider "kubernetes" {
  config_path    = pathexpand("~/.kube/config")
  config_context = "kind-readaloud"
}

variable "web_image" {
  type        = string
  description = "Web image already loaded into the node, e.g. readaloud-web:<commit>."
}

variable "voicestudio_image" {
  type    = string
  default = "ghcr.io/debpalash/voicestudio:stable"
}

# The tag names the release; the digest keeps a moved tag from changing what runs.
variable "phonon_image" {
  type    = string
  default = "ghcr.io/gradium-ai/ptts-openai-server:0.7.0@sha256:806af0149e6520c8dec95f21c7847d7728c5ecff22b83b61f25e1c782705f5d9"
}

module "readaloud" {
  source            = "../../../terraform/modules/readaloud"
  web_image         = var.web_image
  voicestudio_image = var.voicestudio_image
  phonon_image      = var.phonon_image

  voicestudio_remote_url           = local.env.voicestudio_remote_url
  voicestudio_name                 = local.env.voicestudio_name
  voicestudio_secondary_remote_url = local.env.voicestudio_secondary_remote_url
  voicestudio_secondary_name       = local.env.voicestudio_secondary_name
  llm_url                          = local.env.llm_url
  preparation_yield_ms             = local.env.preparation_yield_ms
  voicestudio_asr_model            = local.env.voicestudio_asr_model
  voicestudio_api_key              = local.env.voicestudio_api_key
  voicestudio_secondary_api_key    = local.env.voicestudio_secondary_api_key
  openai_api_key                   = local.env.openai_api_key
  fish_api_key                     = local.env.fish_api_key
  llm_api_key                      = local.env.llm_api_key
  typesafe_api_key                 = local.env.typesafe_api_key
}
