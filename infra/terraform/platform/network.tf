# The shared overlay. Every tenant stack (realm module) attaches to it by name.
resource "docker_network" "edge" {
  name       = "keasy-edge"
  driver     = "overlay"
  attachable = true
}
