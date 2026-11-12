# ReadAloud: the web app and, when their images are set, VoiceStudio and Phonon. The Services
# are ClusterIP; the host reaches them through the Ingresses and Traefik (traefik.tf).
#
# Both apps run exactly one pod and update with Recreate: the shared library and the
# preparation queue live in one server process and its files, and VoiceStudio owns its
# model directory. Two copies at once would overwrite each other's state.
locals {
  voicestudio            = var.voicestudio_image != null
  in_cluster_voicestudio = local.voicestudio ? "http://voicestudio:3900" : ""
  phonon                 = var.phonon_image != null
  config = {
    # Empty leaves the web server without its /api/phonon route.
    PHONON_URL                 = local.phonon ? "http://phonon:8880" : ""
    VOICESTUDIO_URL            = var.voicestudio_remote_url != "" ? var.voicestudio_remote_url : local.in_cluster_voicestudio
    VOICESTUDIO_NAME           = var.voicestudio_name
    VOICESTUDIO_SECONDARY_URL  = var.voicestudio_secondary_remote_url != "" ? var.voicestudio_secondary_remote_url : (var.voicestudio_remote_url != "" ? local.in_cluster_voicestudio : "")
    VOICESTUDIO_SECONDARY_NAME = var.voicestudio_secondary_name
    LLM_URL                    = var.llm_url
    PREPARATION_YIELD_MS       = var.preparation_yield_ms
    VOICESTUDIO_ASR_MODEL      = var.voicestudio_asr_model
  }
  secrets = {
    VOICESTUDIO_API_KEY           = var.voicestudio_api_key
    VOICESTUDIO_SECONDARY_API_KEY = var.voicestudio_secondary_api_key
    OPENAI_API_KEY                = var.openai_api_key
    FISH_API_KEY                  = var.fish_api_key
    LLM_API_KEY                   = var.llm_api_key
    TYPESAFE_API_KEY              = var.typesafe_api_key
  }
  # Pods only read configuration at start. These change with it, so the pods restart.
  web_config_hash         = nonsensitive(substr(sha256(jsonencode([local.config, local.secrets])), 0, 16))
  voicestudio_config_hash = nonsensitive(substr(sha256("${var.voicestudio_api_key}|${var.voicestudio_asr_model}"), 0, 16))
}

resource "kubernetes_namespace_v1" "readaloud" {
  metadata { name = "readaloud" }
}

resource "kubernetes_config_map_v1" "config" {
  metadata {
    name      = "readaloud-config"
    namespace = kubernetes_namespace_v1.readaloud.metadata[0].name
  }
  data = local.config
  lifecycle {
    precondition {
      condition     = local.config.VOICESTUDIO_URL != ""
      error_message = "Set voicestudio_image (VoiceStudio in the cluster) or voicestudio_remote_url."
    }
  }
}

resource "kubernetes_secret_v1" "secrets" {
  metadata {
    name      = "readaloud-secrets"
    namespace = kubernetes_namespace_v1.readaloud.metadata[0].name
  }
  data = local.secrets
}

resource "kubernetes_deployment_v1" "web" {
  metadata {
    name      = "web"
    namespace = kubernetes_namespace_v1.readaloud.metadata[0].name
  }
  spec {
    replicas = 1
    strategy { type = "Recreate" }
    selector { match_labels = { app = "web" } }
    template {
      metadata {
        labels      = { app = "web" }
        annotations = { "readaloud/config" = local.web_config_hash }
      }
      spec {
        container {
          name              = "web"
          image             = var.web_image
          image_pull_policy = "IfNotPresent"
          port {
            name           = "http"
            container_port = 4173
          }
          env_from {
            config_map_ref { name = kubernetes_config_map_v1.config.metadata[0].name }
          }
          env_from {
            secret_ref { name = kubernetes_secret_v1.secrets.metadata[0].name }
          }
          env {
            name  = "LIBRARY_DATA_DIR"
            value = "/app/library"
          }
          env {
            name  = "PREPARATION_DATA_DIR"
            value = "/app/preparations"
          }
          readiness_probe {
            http_get {
              path = "/"
              port = "http"
            }
            period_seconds = 2
          }
          liveness_probe {
            http_get {
              path = "/"
              port = "http"
            }
            initial_delay_seconds = 20
            period_seconds        = 20
          }
          volume_mount {
            name       = "library"
            mount_path = "/app/library"
          }
          volume_mount {
            name       = "preparations"
            mount_path = "/app/preparations"
          }
        }
        volume {
          name = "library"
          host_path {
            path = "/data/library"
            type = "Directory"
          }
        }
        volume {
          name = "preparations"
          host_path {
            path = "/data/preparations"
            type = "Directory"
          }
        }
      }
    }
  }
  timeouts {
    create = "5m"
    update = "5m"
  }
}

resource "kubernetes_service_v1" "web" {
  metadata {
    name      = "web"
    namespace = kubernetes_namespace_v1.readaloud.metadata[0].name
  }
  spec {
    selector = { app = "web" }
    port {
      name        = "http"
      port        = 4173
      target_port = "http"
    }
  }
}

# Traefik's web entrypoint.
resource "kubernetes_ingress_v1" "web" {
  metadata {
    name        = "web"
    namespace   = kubernetes_namespace_v1.readaloud.metadata[0].name
    annotations = { "traefik.ingress.kubernetes.io/router.entrypoints" = "web" }
  }
  spec {
    ingress_class_name = kubernetes_ingress_class_v1.traefik.metadata[0].name
    rule {
      http {
        path {
          path      = "/"
          path_type = "Prefix"
          backend {
            service {
              name = kubernetes_service_v1.web.metadata[0].name
              port { name = "http" }
            }
          }
        }
      }
    }
  }
}

resource "kubernetes_deployment_v1" "voicestudio" {
  count = local.voicestudio ? 1 : 0

  metadata {
    name      = "voicestudio"
    namespace = kubernetes_namespace_v1.readaloud.metadata[0].name
  }
  spec {
    replicas = 1
    strategy { type = "Recreate" }
    selector { match_labels = { app = "voicestudio" } }
    template {
      metadata {
        labels      = { app = "voicestudio" }
        annotations = { "readaloud/config" = local.voicestudio_config_hash }
      }
      spec {
        container {
          name              = "voicestudio"
          image             = var.voicestudio_image
          image_pull_policy = "IfNotPresent"
          port {
            name           = "http"
            container_port = 3900
          }
          env {
            name = "OMNIVOICE_API_KEY"
            value_from {
              secret_key_ref {
                name = kubernetes_secret_v1.secrets.metadata[0].name
                key  = "VOICESTUDIO_API_KEY"
              }
            }
          }
          env {
            name  = "OMNIVOICE_SERVER_MODE"
            value = "1"
          }
          env {
            name  = "OMNIVOICE_ANALYTICS_DISABLED"
            value = "1"
          }
          env {
            name  = "OMNIVOICE_DATA_DIR"
            value = "/app/omnivoice_data"
          }
          # The CPU performance profile otherwise picks the smallest installed Whisper on every start.
          env {
            name = "ASR_MODEL_FASTER"
            value_from {
              config_map_key_ref {
                name = kubernetes_config_map_v1.config.metadata[0].name
                key  = "VOICESTUDIO_ASR_MODEL"
              }
            }
          }
          # Loading models can take minutes on this CPU.
          startup_probe {
            http_get {
              path = "/health"
              port = "http"
            }
            period_seconds    = 10
            failure_threshold = 60
          }
          readiness_probe {
            http_get {
              path = "/health"
              port = "http"
            }
            period_seconds = 10
          }
          volume_mount {
            name       = "data"
            mount_path = "/app/omnivoice_data"
          }
        }
        volume {
          name = "data"
          host_path {
            path = "/data/voicestudio"
            type = "Directory"
          }
        }
      }
    }
  }
  timeouts {
    create = "15m"
    update = "15m"
  }
}

resource "kubernetes_service_v1" "voicestudio" {
  count = local.voicestudio ? 1 : 0

  metadata {
    name      = "voicestudio"
    namespace = kubernetes_namespace_v1.readaloud.metadata[0].name
  }
  spec {
    selector = { app = "voicestudio" }
    port {
      name        = "http"
      port        = 3900
      target_port = "http"
    }
  }
}

# Traefik's voicestudio entrypoint, for local dev servers and scripts. The web pod
# skips Traefik and calls http://voicestudio:3900 directly.
resource "kubernetes_ingress_v1" "voicestudio" {
  count = local.voicestudio ? 1 : 0

  metadata {
    name        = "voicestudio"
    namespace   = kubernetes_namespace_v1.readaloud.metadata[0].name
    annotations = { "traefik.ingress.kubernetes.io/router.entrypoints" = "voicestudio" }
  }
  spec {
    ingress_class_name = kubernetes_ingress_class_v1.traefik.metadata[0].name
    rule {
      http {
        path {
          path      = "/"
          path_type = "Prefix"
          backend {
            service {
              name = kubernetes_service_v1.voicestudio[0].metadata[0].name
              port { name = "http" }
            }
          }
        }
      }
    }
  }
}

# Phonon: Gradium's on-device speech server. It runs on the CPU, keeps no state, and only
# the web pod calls it, so it has a Service but no Ingress.
resource "kubernetes_deployment_v1" "phonon" {
  count = local.phonon ? 1 : 0

  metadata {
    name      = "phonon"
    namespace = kubernetes_namespace_v1.readaloud.metadata[0].name
  }
  spec {
    replicas = 1
    selector { match_labels = { app = "phonon" } }
    template {
      metadata {
        labels = { app = "phonon" }
      }
      spec {
        container {
          name              = "phonon"
          image             = var.phonon_image
          image_pull_policy = "IfNotPresent"
          port {
            name           = "http"
            container_port = 8880
          }
          env {
            name  = "PTTS_LANG"
            value = "en"
          }
          env {
            name  = "PTTS_QUANT"
            value = "q8"
          }
          # It listens once the model has loaded; the first start downloads it (about 65 MB).
          startup_probe {
            http_get {
              path = "/health"
              port = "http"
            }
            period_seconds    = 5
            failure_threshold = 60
          }
          readiness_probe {
            http_get {
              path = "/health"
              port = "http"
            }
            period_seconds = 10
          }
          volume_mount {
            name       = "models"
            mount_path = "/home/phonon/.cache/huggingface"
          }
        }
        # Kept across container restarts; a replaced pod downloads the model again.
        volume {
          name = "models"
          empty_dir {}
        }
      }
    }
  }
  timeouts {
    create = "10m"
    update = "10m"
  }
}

resource "kubernetes_service_v1" "phonon" {
  count = local.phonon ? 1 : 0

  metadata {
    name      = "phonon"
    namespace = kubernetes_namespace_v1.readaloud.metadata[0].name
  }
  spec {
    selector = { app = "phonon" }
    port {
      name        = "http"
      port        = 8880
      target_port = "http"
    }
  }
}
