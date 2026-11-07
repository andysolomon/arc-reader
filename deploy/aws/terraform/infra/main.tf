# ReadAloud's AWS host: one EC2 instance running k3s, reachable only over Tailscale.
#
#   network.tf   VPC with one public subnet; no inbound access except Tailscale's UDP port
#   registry.tf  ECR repository for the web image
#   host.tf      the instance, its IAM role and the EBS data volume
#   backup.tf    daily snapshots of the data volume
#
# The library, prepared audio, k3s state and Tailscale identity all live on the data
# volume, so replacing the instance (a new AMI, changed user data) keeps them. Speech
# comes from the Mac mini's VoiceStudio over the tailnet; it does not run here.
# ../app deploys ReadAloud onto the cluster.
terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.72" }
  }
  # terraform.sh passes the path, outside the repository.
  backend "local" {}
}

provider "aws" {
  region = var.region
  default_tags {
    tags = { Project = "readaloud" }
  }
}

variable "region" {
  type    = string
  default = "us-east-1"
}

variable "instance_type" {
  type        = string
  default     = "t3a.medium"
  description = "x86 (the web image is built for amd64). 4 GB leaves room for k3s and the web server."
}

variable "data_volume_gb" {
  type    = number
  default = 10
}

variable "tailnet" {
  type        = string
  default     = "tail1b9428.ts.net"
  description = "MagicDNS suffix; pods resolve names under it through Tailscale."
  validation {
    condition     = can(regex("^[a-z0-9-]+\\.ts\\.net$", var.tailnet))
    error_message = "Use the MagicDNS suffix, for example tail1b9428.ts.net."
  }
}

variable "hostname" {
  type        = string
  default     = "readaloud-aws"
  description = "Tailscale machine name. The app is served at https://<hostname>.<tailnet>."
  validation {
    condition     = length(var.hostname) <= 63 && can(regex("^[a-z0-9]([a-z0-9-]*[a-z0-9])?$", var.hostname))
    error_message = "Use a lowercase DNS label for hostname (up to 63 characters)."
  }
}

variable "tailscale_auth_key" {
  type        = string
  sensitive   = true
  default     = ""
  description = "Joins the instance to the tailnet on its first boot. Afterwards the identity lives on the data volume and this may be empty."
}

variable "k3s_version" {
  type    = string
  default = "v1.37.2+k3s1"
  validation {
    condition     = can(regex("^v[0-9]+\\.[0-9]+\\.[0-9]+\\+k3s[0-9]+$", var.k3s_version))
    error_message = "Use a k3s release such as v1.37.2+k3s1."
  }
}

output "region" {
  value = var.region
}

output "instance_id" {
  value = aws_instance.host.id
}

output "repository_url" {
  value = aws_ecr_repository.web.repository_url
}

output "kube_server" {
  value = "https://${var.hostname}.${var.tailnet}:6443"
}

output "url" {
  value = "https://${var.hostname}.${var.tailnet}"
}
