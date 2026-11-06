# Settings from the root .env, set as TF_VAR_* by deploy/terraform/shared/env.sh. Symlinked
# into each root that deploys the readaloud module; null keeps the module's default.
variable "voicestudio_remote_url" {
  type    = string
  default = null
}
variable "voicestudio_name" {
  type    = string
  default = null
}
variable "voicestudio_secondary_remote_url" {
  type    = string
  default = null
}
variable "voicestudio_secondary_name" {
  type    = string
  default = null
}
variable "llm_url" {
  type    = string
  default = null
}
variable "preparation_yield_ms" {
  type    = string
  default = null
}
variable "voicestudio_asr_model" {
  type    = string
  default = null
}
variable "voicestudio_api_key" {
  type      = string
  sensitive = true
}
variable "voicestudio_secondary_api_key" {
  type      = string
  sensitive = true
  default   = null
}
variable "openai_api_key" {
  type      = string
  sensitive = true
  default   = null
}
variable "fish_api_key" {
  type      = string
  sensitive = true
  default   = null
}
variable "llm_api_key" {
  type      = string
  sensitive = true
  default   = null
}

variable "typesafe_api_key" {
  type      = string
  sensitive = true
  default   = null
}

locals {
  env = {
    voicestudio_remote_url           = var.voicestudio_remote_url
    voicestudio_name                 = var.voicestudio_name
    voicestudio_secondary_remote_url = var.voicestudio_secondary_remote_url
    voicestudio_secondary_name       = var.voicestudio_secondary_name
    llm_url                          = var.llm_url
    preparation_yield_ms             = var.preparation_yield_ms
    voicestudio_asr_model            = var.voicestudio_asr_model
    voicestudio_api_key              = var.voicestudio_api_key
    voicestudio_secondary_api_key    = var.voicestudio_secondary_api_key
    openai_api_key                   = var.openai_api_key
    fish_api_key                     = var.fish_api_key
    llm_api_key                      = var.llm_api_key
    typesafe_api_key                 = var.typesafe_api_key
  }
}
