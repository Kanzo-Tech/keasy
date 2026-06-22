# spike — the `docker_service` gate

Proves Terraform (`kreuzwerker/docker`) can express one tenant's Swarm stack — the thing
`control-plane/src/docker.rs` `render_stack` produces today — before we commit to making
Terraform own every tenant stack. **This is the gate** (plan risk #1): if the runtime
behaviour below holds, we proceed; if not, we rethink the orchestration provider.

What it exercises: external Swarm secrets mounted at `/run/secrets/*`, Traefik discovery
via service `labels`, a container `healthcheck`, a **health-gated start-first rolling
update with auto-rollback**, a named data volume, and attachment to the shared
`keasy-edge` overlay.

## Static check (any machine with terraform)
```sh
terraform init && terraform fmt -check && terraform validate   # already green
```

## Runtime check (on a Swarm manager — the real gate)
Needs the `keasy-edge` overlay to exist (`docker network create --driver overlay --attachable keasy-edge`).
```sh
terraform init
terraform apply -auto-approve            # creates secrets, volume, server+web services
docker service ls                         # keasy-ws-acme-server / -web present
docker service ps keasy-ws-acme-server    # converges (image will fail healthcheck w/o a real
                                          # backend — that's fine; we're testing Swarm wiring)
docker service inspect keasy-ws-acme-server --format '{{json .Spec.TaskTemplate.ContainerSpec.Secrets}}'

# Rolling update + rollback gate: change server_image to a new tag and re-apply.
terraform apply -auto-approve -var server_image=ghcr.io/kanzo-tech/keasy-server:0.0.4
docker service ps keasy-ws-acme-server    # start-first: new task starts before old stops;
                                          # a failing image auto-rolls-back

terraform destroy -auto-approve           # clean up
```

**Pass criteria:** services schedule on the overlay; the 4 secrets mount at `/run/secrets/*`;
Traefik (if running) discovers `acme.<domain>`; a re-apply with a new image does a start-first
rolling update and rolls back on health failure. If all hold, P1/P2 proceed; the
per-tenant `docker_service` becomes a `for_each` over `var.tenants` in the realm module.
