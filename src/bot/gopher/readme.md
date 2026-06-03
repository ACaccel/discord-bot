# BotFleet - Gopher

A focused, database-free personality ("老鼠人"). It ports nijika's
self-hosted LLM auto-reply and adds two gopher-only capabilities:

- **settings-api** — an owner-only, bearer-authenticated HTTP REST API to
  read/update the LLM `endpoint` at runtime and persist it to `config.json`
  (used when the self-hosted LLM host URL changes). Bound to `127.0.0.1` by
  default; the key is read from `GOPHER_SETTINGS_API_KEY` in `.env`.
- **identity-sync** — a daily check that mirrors a source user's avatar and
  their per-guild server nickname, or applies a static fallback identity when
  sync is off.

Run with `yarn gopher`. Register its `/help` command with
`yarn deploy -t gopher`. See `config.example.json` for the config shape.

## Settings API transport security

Bearer auth authenticates the caller; it does NOT encrypt the request. Over
plain HTTP the `Authorization: Bearer <key>` header (and the endpoint you
PUT) travel in cleartext, so a firewall / source-IP allow-list limits *who*
can connect but does not stop on-path eavesdropping. If you expose the port
(router port-forward, or `settings_api.host: "0.0.0.0"`), front it with TLS —
a reverse proxy (Caddy/nginx + Let's Encrypt) terminating HTTPS and proxying
to `127.0.0.1:<PORT>` — or reach it through an encrypted tunnel (SSH,
Tailscale/WireGuard) and keep the bind on loopback. Rotate
`GOPHER_SETTINGS_API_KEY` if it may have been sent in cleartext.
