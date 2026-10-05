# Development: kanzo-ui's services/auth compose, reached from inside compose.
kc_url        = "http://keycloak:8080"
client_secret = "dev-only-keasy-secret"
redirect_uris = ["http://acme.localhost:3000/api/auth/callback", "http://globex.localhost:3000/api/auth/callback"]
# The web, as Keycloak reaches it inside compose.
backchannel_logout_url = "http://web:3000/api/auth/backchannel-logout"
