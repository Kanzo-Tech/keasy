# The shared overlay. Every tenant stack (realm module) attaches to it by name, and the
# control-plane one-shots used to too. Owned here, in the platform, not by any app stack.
resource "docker_network" "edge" {
  name       = "keasy-edge"
  driver     = "overlay"
  attachable = true
}
