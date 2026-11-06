# ReadAloud on the k3s host from ../infra: the readaloud module without VoiceStudio,
# which stays on the Mac mini (VOICESTUDIO_REMOTE_URL in .env). deploy.sh applies it
# after pushing the web image to ECR, with the variables from the root .env (env.tf).
terraform {
  required_version = ">= 1.6"
  required_providers {
    kubernetes = { source = "hashicorp/kubernetes", version = "~> 3.5" }
  }
  # terraform.sh passes the path, outside the repository.
  backend "local" {}
}

# terraform.sh fetches it from the host through SSM; the API is reached over the tailnet.
provider "kubernetes" {
  config_path = pathexpand("~/.kube/readaloud-aws.yaml")
}

variable "web_image" {
  type        = string
  description = "Web image in ECR, e.g. <account>.dkr.ecr.<region>.amazonaws.com/readaloud-web:<commit>."
}

module "readaloud" {
  source    = "../../../terraform/modules/readaloud"
  web_image = var.web_image

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
}
