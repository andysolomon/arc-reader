locals {
  # The pod only reads its configuration at start. These change with it, so the pod restarts.
  config_hash = nonsensitive(substr(sha256(jsonencode([var.api_url, var.access_token])), 0, 16))
}

resource "kubernetes_namespace_v1" "cadence" {
  metadata { name = "cadence" }
}

resource "kubernetes_secret_v1" "secrets" {
  metadata {
    name      = "cadence-secrets"
    namespace = kubernetes_namespace_v1.cadence.metadata[0].name
  }
  data = {
    READALOUD_ACCESS_TOKEN = var.access_token
  }
}

# Stateless: progress lives in each reader's browser, so pods can be replaced one at a time.
resource "kubernetes_deployment_v1" "web" {
  metadata {
    name      = "web"
    namespace = kubernetes_namespace_v1.cadence.metadata[0].name
  }
  spec {
    replicas = 1
    selector { match_labels = { app = "cadence" } }
    template {
      metadata {
        labels      = { app = "cadence" }
        annotations = { "cadence/config" = local.config_hash }
      }
      spec {
        container {
          name              = "web"
          image             = var.image
          image_pull_policy = "IfNotPresent"
          port {
            name           = "http"
            container_port = 4183
          }
          env {
            name  = "CADENCE_API_URL"
            value = var.api_url
          }
          env_from {
            secret_ref { name = kubernetes_secret_v1.secrets.metadata[0].name }
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
          resources {
            requests = {
              cpu    = "25m"
              memory = "96Mi"
            }
          }
          security_context {
            run_as_non_root            = true
            run_as_user                = 1000 # node, as the image runs
            allow_privilege_escalation = false
            capabilities { drop = ["ALL"] }
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
    namespace = kubernetes_namespace_v1.cadence.metadata[0].name
  }
  spec {
    selector = { app = "cadence" }
    port {
      name        = "http"
      port        = 4183
      target_port = "http"
    }
  }
}

# Traefik's web entrypoint, beside ReadAloud's Ingress for "/". The longer path wins, and the
# request reaches the pod with the path still on it.
resource "kubernetes_ingress_v1" "web" {
  metadata {
    name        = "web"
    namespace   = kubernetes_namespace_v1.cadence.metadata[0].name
    annotations = { "traefik.ingress.kubernetes.io/router.entrypoints" = "web" }
  }
  spec {
    ingress_class_name = var.ingress_class
    rule {
      http {
        path {
          path      = var.path
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
