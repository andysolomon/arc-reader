# Traefik, the cluster's ingress controller.
#
# Its Service holds the NodePorts the host forwards to (kind port mappings, or
# tailscale serve on EC2), so every request goes through Traefik and the Ingresses in
# readaloud.tf pick the backend. Each host port has its own
# entrypoint; an Ingress names the one it serves with the router.entrypoints annotation.
resource "kubernetes_namespace_v1" "traefik" {
  metadata { name = "traefik" }
}

resource "kubernetes_service_account_v1" "traefik" {
  metadata {
    name      = "traefik"
    namespace = kubernetes_namespace_v1.traefik.metadata[0].name
  }
}

resource "kubernetes_cluster_role_v1" "traefik" {
  metadata { name = "traefik" }
  rule {
    api_groups = [""]
    resources  = ["services", "secrets", "nodes"]
    verbs      = ["get", "list", "watch"]
  }
  rule {
    api_groups = ["discovery.k8s.io"]
    resources  = ["endpointslices"]
    verbs      = ["list", "watch"]
  }
  rule {
    api_groups = ["networking.k8s.io"]
    resources  = ["ingresses", "ingressclasses"]
    verbs      = ["get", "list", "watch"]
  }
  rule {
    api_groups = ["networking.k8s.io"]
    resources  = ["ingresses/status"]
    verbs      = ["update"]
  }
}

resource "kubernetes_cluster_role_binding_v1" "traefik" {
  metadata { name = "traefik" }
  role_ref {
    api_group = "rbac.authorization.k8s.io"
    kind      = "ClusterRole"
    name      = kubernetes_cluster_role_v1.traefik.metadata[0].name
  }
  subject {
    kind      = "ServiceAccount"
    name      = kubernetes_service_account_v1.traefik.metadata[0].name
    namespace = kubernetes_namespace_v1.traefik.metadata[0].name
  }
}

resource "kubernetes_ingress_class_v1" "traefik" {
  metadata { name = "traefik" }
  spec { controller = "traefik.io/ingress-controller" }
}

resource "kubernetes_deployment_v1" "traefik" {
  metadata {
    name      = "traefik"
    namespace = kubernetes_namespace_v1.traefik.metadata[0].name
  }
  spec {
    replicas = 1
    selector { match_labels = { app = "traefik" } }
    template {
      metadata { labels = { app = "traefik" } }
      spec {
        service_account_name = kubernetes_service_account_v1.traefik.metadata[0].name
        container {
          name              = "traefik"
          image             = var.traefik_image
          image_pull_policy = "IfNotPresent"
          args = concat([
            "--entryPoints.web.address=:8000",
            # Traefik stops reading a request after 60 s by default; long uploads over
            # Tailscale need longer, and the NodePort it replaced had no limit.
            "--entryPoints.web.transport.respondingTimeouts.readTimeout=0",
            "--providers.kubernetesingress.ingressClass=${kubernetes_ingress_class_v1.traefik.metadata[0].name}",
            "--ping",
            "--global.checkNewVersion=false",
            "--global.sendAnonymousUsage=false",
            ], local.voicestudio ? [
            "--entryPoints.voicestudio.address=:3900",
            "--entryPoints.voicestudio.transport.respondingTimeouts.readTimeout=0",
          ] : [])
          port {
            name           = "web"
            container_port = 8000
          }
          dynamic "port" {
            for_each = local.voicestudio ? [3900] : []
            content {
              name           = "voicestudio"
              container_port = port.value
            }
          }
          port {
            name           = "admin"
            container_port = 8080
          }
          readiness_probe {
            http_get {
              path = "/ping"
              port = "admin"
            }
            period_seconds = 2
          }
          liveness_probe {
            http_get {
              path = "/ping"
              port = "admin"
            }
            period_seconds = 20
          }
          security_context {
            run_as_non_root            = true
            run_as_user                = 65532
            allow_privilege_escalation = false
            read_only_root_filesystem  = true
            capabilities { drop = ["ALL"] }
          }
        }
      }
    }
  }
}

resource "kubernetes_service_v1" "traefik" {
  metadata {
    name      = "traefik"
    namespace = kubernetes_namespace_v1.traefik.metadata[0].name
  }
  spec {
    type     = "NodePort"
    selector = { app = "traefik" }
    port {
      name        = "web"
      port        = 80
      target_port = "web"
      node_port   = var.web_node_port
    }
    dynamic "port" {
      for_each = local.voicestudio ? [var.voicestudio_node_port] : []
      content {
        name        = "voicestudio"
        port        = 3900
        target_port = "voicestudio"
        node_port   = port.value
      }
    }
  }
}
