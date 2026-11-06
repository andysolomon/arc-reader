# Single-node kind cluster for ReadAloud. It takes over the ports Docker Compose used,
# so https://omarchy.tail1b9428.ts.net:8449 (tailscale serve → 127.0.0.1:4179) and
# anything using 127.0.0.1:3900 keep working. Both host ports lead to Traefik's
# NodePorts (the shared readaloud module). Data stays in the Compose volumes, mounted into the
# node and exposed to pods as hostPath volumes.
#
# kind cannot change a running cluster: any change here replaces it. deploy.sh only
# applies this stage when the cluster is missing; apply other changes by hand.
terraform {
  required_version = ">= 1.6"
  required_providers {
    kind = { source = "tehcyx/kind", version = "~> 0.13" }
  }
  # deploy.sh passes the path, outside the repository, so every checkout shares one state.
  backend "local" {}
}

variable "name" {
  type    = string
  default = "readaloud"
}

resource "kind_cluster" "readaloud" {
  name           = var.name
  node_image     = "kindest/node:v1.37.0@sha256:a1ed56cfb0e7b93589bdf97c8cd566405a265939e3620fc4f5de89adff580ae5"
  wait_for_ready = true
  # Merged into the default kubeconfig as context kind-<name>, which ../app uses.
  kubeconfig_path = pathexpand("~/.kube/config")

  kind_config {
    kind        = "Cluster"
    api_version = "kind.x-k8s.io/v1alpha4"

    node {
      role = "control-plane"

      extra_port_mappings {
        container_port = 30179 # Traefik → web
        host_port      = 4179
        listen_address = "127.0.0.1"
        protocol       = "TCP"
      }
      extra_port_mappings {
        container_port = 30900 # Traefik → VoiceStudio
        host_port      = 3900
        listen_address = "127.0.0.1"
        protocol       = "TCP"
      }

      extra_mounts {
        host_path      = "/var/lib/docker/volumes/readaloud_library-data/_data"
        container_path = "/data/library"
      }
      extra_mounts {
        host_path      = "/var/lib/docker/volumes/readaloud_preparation-data/_data"
        container_path = "/data/preparations"
      }
      extra_mounts {
        host_path      = "/var/lib/docker/volumes/voicestudio-data/_data"
        container_path = "/data/voicestudio"
      }
    }
  }
}

output "context" {
  value = kind_cluster.readaloud.context_name
}
