# Security Policy

We take the security of `BotFleet` seriously. Thank you for taking
the time to disclose responsibly.

## Supported versions

Only the latest minor version is supported with security fixes.

| Version | Supported          |
| ------- | ------------------ |
| `1.x`   | Yes (latest minor) |
| `<1.0`  | No                 |

## Reporting a vulnerability

**Do not open a public GitHub issue for a suspected vulnerability.**
Instead, please use the GitHub Security Advisory workflow:

1. Open <https://github.com/ACaccel/BotFleet/security/advisories/new>.
2. Provide:
   - A description of the vulnerability and the affected code paths.
   - The conditions required to reproduce it (configuration, Discord
     permissions, network access, etc.).
   - The potential impact (RCE, data exposure, denial of service,
     account takeover, …).
   - A proof of concept, where it is safe to share one.
3. Submit. Only the maintainers and you will see the report.

If you cannot use GitHub Security Advisories, you may instead contact
the repository owner directly through the email listed on their GitHub
profile. Please mark the subject line with `[BotFleet security]`.

## Response timeline

| Stage             | Target                                                      |
| ----------------- | ----------------------------------------------------------- |
| Initial response  | within **72 hours** of report receipt                       |
| Triage decision   | within **7 days**                                           |
| Fix or mitigation | within **90 days** of triage for confirmed vulnerabilities  |
| Public disclosure | coordinated with reporter; defaults to **90 days** post-fix |

If a vulnerability is being actively exploited in the wild we will
accelerate the timeline and coordinate a faster public disclosure.

## Scope

In scope:

- The code under `src/` and `scripts/`.
- The handler / plugin / IoC contracts.
- Anything that touches user data, Discord tokens, or MongoDB
  connections.

Out of scope:

- Vulnerabilities in third-party dependencies — please report those
  upstream. We track upstream advisories via `yarn npm audit` in CI.
- Misconfiguration of a deployment (leaked `.env`, mis-scoped bot
  token, etc.). Those are operator responsibilities.
- Issues that require an attacker to already have full server-admin
  rights in a guild the bot serves.

## Safe harbour

We will not pursue legal action against researchers who:

- Make a good-faith effort to follow this policy.
- Avoid privacy violations, data destruction, and interruption of
  service.
- Give us reasonable time to respond before public disclosure.
