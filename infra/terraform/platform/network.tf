# The shared overlay. Every instance (infra/terraform/instances) attaches to it by name.
resource "docker_network" "edge" {
  name       = "keasy-edge"
  driver     = "overlay"
  attachable = true
}
