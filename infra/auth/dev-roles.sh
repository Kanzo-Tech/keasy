#!/bin/sh
# Development: keasy's roles onto the groups the platform seed gives each organization —
# what an organization admin does in the console. Idempotent.
set -eu
map=/kanzo-auth/scripts/map-group-role.sh
sh "$map" acme Admins keasy admin
sh "$map" acme "Data team" keasy editor
sh "$map" acme Analysts keasy reader
sh "$map" globex Platform keasy admin
sh "$map" globex Readers keasy reader
