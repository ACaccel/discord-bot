# 0010 - Read X timelines through a third-party mirror, not the official API

- Date: 2026-08-28
- Status: accepted
- Supersedes: -

## Context

The `x-media-feed` plugin needs to notice, within a few minutes, that a
followed X (Twitter) account has published a new image or video post.
That requires polling a _timeline_ endpoint — not just resolving a single
post, which the existing `social-link-preview` layer already does.

X's API pricing changed in February 2026: pay-per-use became the default
for new developers and the general free tier was withdrawn. Reads are
billed per post. A five-minute poll of a handful of accounts reads on the
order of 10^5 posts a month, so the metered API turns a small
convenience feature into a standing subscription cost.

This choice constrains later work (it fixes the plugin's boundary and its
failure modes), is awkward to reverse once operators depend on the feed,
and is not obvious — it trades a supported vendor API for a free
community service.

## Options considered

**A. X official API v2 (pay-per-use).** Supported, stable, unambiguously
within the platform's terms. Costs roughly $0.005 per post read with no
free allowance, which for this feature is real recurring money for a
nice-to-have. Also needs credential management (a new secret in `Env`)
that nothing else in the bot requires.

**B. FxTwitter-compatible public API (`api.fxtwitter.com`).** Free, no
API key, and exposes exactly the endpoint this feature needs
(`/2/profile/{handle}/statuses`) including a `since` parameter that
answers `204` when nothing is new — the shape a poller wants. The
project already depends on the same service family: `social-link-preview`
rewrites links onto `fxtwitter.com` so Discord can unfurl playable video.
The cost is a community-run upstream that may change, rate-limit, or
disappear, and access that sits in a grey area of X's terms.

**C. Self-hosted Nitter (RSS).** Free and self-controlled in principle.
Rejected on current evidence: X Corp issued cease-and-desist letters
against Nitter instances and the project repository in August 2026, and
surviving instances need real account session tokens to function at all.
Building on it would mean adopting a dependency that is actively being
shut down.

**D. A commercial scraping service.** Reliable and supported, but
introduces a paid third-party subscription and an account boundary for
what is a single-endpoint read — disproportionate to the feature.

## Decision

Option B, behind an `XTimelineSource` Strategy in `src/infra/x-feed/`.

Three deliberate hedges make the dependency reversible and containable:

1. The plugin depends on the `XTimelineSource` interface, never on the
   concrete client, so adopting option A later is one new file in
   `src/infra/x-feed/` plus one composition-root line.
2. `apiBaseUrl` is operator configuration, so a self-hosted instance of
   the same software can replace the public host without a code change.
3. The plugin ships `enabled: false`. Nothing polls anything until an
   operator opts in, which keeps the grey-area access a deployment
   decision rather than a property of the codebase.

## Rationale

The deciding factor is that the failure mode is mild and the cost
asymmetry is large. If the upstream degrades, the feed goes quiet and
logs `XFeedError`s — no user-facing breakage, no data loss, and the
cursor design means nothing is double-posted when it recovers. Paying a
metered API to avoid that outcome is poor value for a convenience
feature.

Depending on this service family is also not a new exposure: the bot
already routes user-visible previews through `fxtwitter.com`. What is new
is a _polling_ dependency rather than a per-message one, which is why the
poll interval has a 60-second floor, why passes run in series rather than
fanning out, and why requests carry a descriptive User-Agent — a
misbehaving client should be attributable and rate-limitable rather than
anonymous.

The upstream's undocumented behaviours are treated as part of the
contract and pinned by tests, because they are load-bearing and could
change silently: `count` is ignored, `since` gates the status code
without filtering the page, `since` is a strict `>` (hence the periodic
full sweep, without which a post created in the same second as the
newest one already forwarded would be missed permanently), and entries
are not ordered by creation time.
