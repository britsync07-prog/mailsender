# MailSender (MailCouse)
<div align="center">

![License](https://img.shields.io/github/license/britsync07-prog/mailsender?style=flat-square&label=license&color=06b6d4) ![Language](https://img.shields.io/github/languages/top/britsync07-prog/mailsender?style=flat-square&color=0ea5e9) ![Stars](https://img.shields.io/github/stars/britsync07-prog/mailsender?style=flat-square&color=f59e0b) ![Last commit](https://img.shields.io/github/last-commit/britsync07-prog/mailsender?style=flat-square&color=22c55e) ![Repo size](https://img.shields.io/github/repo-size/britsync07-prog/mailsender?style=flat-square&color=94a3b8)

</div>

> A self-hosted, Postal-inspired multi-tenant email delivery and cold-outreach infrastructure platform.

MailSender (internal project name `mailcouse`) is a TypeScript email infrastructure system that replicates the core feature set of the open-source Postal mail server: multi-tenant organizations, scoped mail servers, an inbound SMTP relay, DKIM signing, domain/subdomain verification with live DNS checks, IP-style subdomain pools, message inspection, suppressions, and webhooks. It is driven by a formal Technical Specification Document (TSD v3) targeting engagement-first cold outreach at up to 100,000 emails/day across 50 root domains, with reputation-safe volume distribution via subdomain identities.

## Overview

The platform follows an "engagement-first" architecture defined in `TSD_v3_final.txt`: every sending identity stays under conservative per-SMTP daily caps (10 emails/day post-warmup, 200 subdomain SMTPs per root domain, 2,000 emails/domain/day total) so that behavioral trust is built before scale. The application implements the full delivery pipeline itself: lead ingestion with validation and deduplication, spintax content generation, queue-based dispatch through pooled subdomain credentials, IMAP-based bounce and reply detection, suppression handling, and a Postal-replica web UI built with EJS.

Twenty numbered implementation plans (`plans/plan1.txt` ... `plan20.txt`) break the TSD into concrete engineering tasks (lead ingestion, validation stages, warmup scheduling, DNS provisioning, etc.), and `docs/superpowers/` holds detailed specs such as the domain/subdomain verification design.

## Features

- Multi-tenant portals with authentication (JWT + bcrypt), organizations, servers, and scoped dashboards
- Built-in SMTP relay (`smtp-server`) with dedicated listen ports per traffic class: mass mail (587), personal (588), transactional (589)
- DKIM signing and SPF-aligned root-domain envelope-from on outbound messages
- Subdomain-aware domain resolution: sending from `user@sub.example.com` resolves to the most specific verified parent domain and signs with its DKIM key
- DNS verification pipeline (SPF, MX, DKIM, return-path CNAME, postal-verification records) with trailing-dot normalization
- Cloudflare API-driven DNS provisioning scripts and bulk subdomain provisioning/statistics tooling
- Warmup engine: scheduler, gate, activator, monitor, plus optional external Warmbox API integration
- Bounce and complaint processing via IMAP polling (`mailparser`), suppression list enforcement
- Engagement tracking: open/click tracking routes, fingerprints, counters, response classification, threading
- Lead ingestion from CSV/API with staged validation, deduplication, industry segmentation, and enrichment provider hooks (Prospeo, Blitz, RapidAPI, DiscoLike)
- Spintax-extended content rotation for message uniqueness
- Webhooks, message detail views with delivery attempts, held/outgoing/incoming/queued scopes, track-domain SSL checks
- Postal-replica light-theme UI (EJS layouts, BEM CSS) with sidebar navigation, server header metrics, subdomain and pool views
- Monitoring dashboard with message rates, cron runner, and Telegram alert notifications
- Jest test suite covering validators, deduplicator, importer, subdomain resolution, and API integration flows

## Tech Stack

| Layer | Technology |
| --- | --- |
| Language | TypeScript (Node.js, CommonJS) |
| Web framework | Express 5, express-ejs-layouts, EJS views |
| SMTP | smtp-server (relay), nodemailer (submission) |
| IMAP / Parsing | imap server module, mailparser |
| Database | PostgreSQL (pg pool) |
| Cache / Queue | Redis (ioredis), custom worker and cron runners |
| Auth / Security | jsonwebtoken, bcryptjs, helmet, express-rate-limit, cookie-parser |
| Content | spintax-extended, csv-parse, multer |
| DNS / Deliverability | Cloudflare API (node-fetch), custom dkim/dns modules, MXToolbox checks |
| Notifications | Telegram Bot API |
| Testing | Jest, ts-jest, Supertest |
| Docs | TSD v3 specification, plans/, docs/superpowers specs |

## Architecture

The entrypoint (`src/index.ts`) wires Express middleware (helmet, compression, morgan, rate limiting, cookie sessions), mounts REST routers (`api/routes`, `admin-routes`, `send-routes`, `auth-routes`, `portal-routes`, `tracking-routes`, health routes), and renders the EJS portal. Separate long-running concerns are started alongside the HTTP server: the cron runner (warmup scheduling, retries, notifications), the bounce handler (IMAP poller), and the SMTP relay listener.

Outbound flow: lead selection and segmentation -> content builder (spintax personalization) -> queue worker -> connection-pooled sender bound to the correct outbound IPv4/IPv6 -> DKIM signature applied -> delivery through the per-traffic-class SMTP port -> session logging and retry management. Inbound feedback flow: IMAP fetch -> parse -> bounce/complaint classification -> suppression update -> counter/engagement metrics -> dashboard and Telegram alerts.

Domain trust flow: Cloudflare provisioning creates verification, SPF, DKIM, and return-path records; the verifier performs live DNS checks with normalized hostnames; the subdomain resolver picks the longest verified match so subdomains inherit the root domain's DKIM identity without multiplying reputation units (root-domain reputation is shared across all 200 subdomains per TSD capacity formula).

## Project Structure

```text
mailsender/
+-- README.md
+-- TSD_v3_final.docx / TSD_v3_final.txt   # Technical Specification Document v3
+-- docs/
�   +-- superpowers/
�       +-- plans/                         # e.g. domain-subdomain-setup plan
�       +-- specs/                         # design specs (verification, relaying)
+-- plans/                                 # plan1..plan20 implementation task lists
+-- soruce/
�   +-- postal/                            # Postal reference material
+-- mailcouse/                             # the application
    +-- package.json                       # build/dev/test/provisioning scripts
    +-- jest.config.js, tsconfig.json
    +-- scripts/copy-assets.js
    +-- src/
        +-- index.ts                       # Express bootstrap, portal UI, lifecycle
        +-- api/                           # REST + portal routes, domain logic, auth
        +-- smtp/                          # relay, connection pool, email builder,
        �                                  #   ip-selector, retry-manager, sender
        +-- warmup/                        # scheduler, gate, activator, monitor
        +-- dns/                           # provisioner, record-builder, verifier
        +-- dkim/                          # signing + key encryption
        +-- bounce/ complaint/             # feedback loops
        +-- imap/ ingestion/               # mailbox polling, lead sources
        +-- validation/                    # staged lead validation
        +-- segmentation/ suppression/     # audience + exclusion management
        +-- content/                       # spintax rendering
        +-- queue/ worker/ cron/           # dispatch pipeline
        +-- engagement/ fingerprint/       # opens, clicks, threading
        +-- counters/ monitoring/          # metrics + HTML dashboard
        +-- cloudflare/                    # DNS API client
        +-- db/ config/ scripts/           # pool, typed config, seed/provision CLIs
        +-- public/ views/                 # Postal-replica assets and EJS templates
        +-- **/__tests__/                  # colocated Jest suites
```

## Getting Started

### Prerequisites

- Node.js 18+ (TypeScript 5.x toolchain via ts-node)
- PostgreSQL 14+
- Redis 6+
- A VPS with outbound mail ports (25, 587) and rDNS configured for production sending
- Cloudflare account API token for automated DNS provisioning (optional but recommended)

### Installation

```bash
cd mailcouse
npm install

# Build (compiles TypeScript and copies static assets/views to dist/)
npm run build

# Provision a fresh database with domains, server, and credentials
npm run seed

# Optional infrastructure helpers
npm run dns:provision          # create verification/SPF/DKIM/return-path records via Cloudflare
npm run subdomains:provision   # bulk-create subdomain sending identities
npm run subdomains:stats       # report active/inactive subdomains per root domain
npm run setup:vps              # VPS baseline setup script
```

### Environment Variables

Copy your secrets into `.env` (names below are read by `src/config/index.ts`; values are placeholders):

| Variable | Placeholder |
| --- | --- |
| NODE_ENV | development |
| DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD | localhost / 5432 / mailcouse / postgres / postgres |
| DB_SSL | false |
| REDIS_PRIMARY_HOST / REDIS_BACKUP_HOST / REDIS_PORT / REDIS_PASSWORD / REDIS_TLS | localhost / (empty) / 6379 / (empty) / false |
| API_PORT / API_HOST | 3000 / 0.0.0.0 |
| JWT_SECRET | change-me-to-a-long-random-string |
| SMTP_PORT / SMTP_PORT_ALT | 587 / 25 |
| SMTP_PORT_MASS / SMTP_PORT_PERSONAL / SMTP_PORT_TRANSACTIONAL | 587 / 588 / 589 |
| IMAP_ENABLED / IMAP_PORT / IMAPS_PORT | true / 143 / 993 |
| SMTP_TLS_CERT (or SMTP_TLS_FULLCHAIN) / SMTP_TLS_KEY (or SMTP_TLS_PRIVKEY) | /path/fullchain.pem / /path/privkey.pem |
| OUTBOUND_IPV4 (or OUTBOUND_LOCAL_ADDRESS) / OUTBOUND_IPV6 | 203.0.113.10 / (empty) |
| CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID | cf-token-placeholder / cf-account-placeholder |
| PROSPEO_API_KEY / BLITZ_API_KEY / RAPIDAPI_KEY / DISCOLIKE_API_KEY | provider-key-placeholder |
| WARMBOX_API_KEY / WARMBOX_ACCOUNT_ID / WARMUP_API_URL | wb-key-placeholder / wb-account-placeholder / https://api.warmbox.com/v1 |
| MXTOOLBOX_API_KEY | mxtoolbox-key-placeholder |
| TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID | tg-token-placeholder / tg-chat-placeholder |
| DKIM_ENCRYPTION_KEY | dkim-key-encryption-placeholder |
| DNS_DKIM_IDENTIFIER / DNS_DOMAIN_VERIFY_PREFIX / DNS_CUSTOM_RETURN_PATH_PREFIX | postal / postal-verification / psrp |
| IMPORT_MAX_BATCH / DNS_TIMEOUT | 1000 / 5 |

### Running

```bash
# Development (ts-node, hot reload of source tree)
npm run dev

# Production (compiled dist/)
npm run build
npm start

# Test suite with coverage
npm test
npm run test:unit
npm run test:integration
```

No docker-compose file ships with this repository; deployment targets a dedicated VPS (see `npm run setup:vps`) where the process owns ports 25/587/143 directly.

## Challenges Faced & Solutions

- **SMTP handler hung on handshake**: the relay stalled when clients sent multi-line EHLO replies. **Solution**: rewrote the EHLO parsing path in the SMTP handler so continuation lines are consumed correctly (commit `fix: SMTP handler no longer hangs (multi-line EHLO fix)`), then added DKIM signing and SPF root-domain envelope-from in the same pass.
- **Subdomain sending had no trust model**: messages from `sub.example.com` were rejected or mis-signed even when the parent domain was verified. **Solution**: centralized subdomain matching into a resolver that selects the longest verified parent domain, normalized trailing dots returned by nameservers during DNS checks, and routed both the portal send route and the relay's `onData` handler through it (commits around `feat: use subdomain-aware resolver ...` and `feat: centralize subdomain matching ...`).
- **Reputation math misunderstood**: treating 200 subdomains as 200 independent reputations would have destroyed deliverability. **Solution**: encoded the TSD capacity formula (2,000 emails/day ceiling shared per root domain) into provisioning limits and warmup gates rather than allowing unlimited per-subdomain volume.
- **Build output incomplete**: `tsc` did not emit static assets, leaving the portal without CSS/JS in production. **Solution**: added a `copy-assets` step to the build script and a fix commit ensuring assets land in `dist/` (`fix: copy static assets to dist ...`).
- **Header fidelity and spoofing**: forwarded messages lost their original `From` header, and unverified domains could still submit mail. **Solution**: preserved original `From` passthrough and hard-rejected unverified domains at relay time; later accepted RFC display-name format (`Name <address>`) on the web send form.
- **Live delivery failed over IPv6**: outbound connections preferred broken IPv6 routes on some VPSes. **Solution**: forced outbound binding via IPv4 (`OUTBOUND_IPV4`/`OUTBOUND_LOCAL_ADDRESS`) together with enabling STARTTLS on the relay (`fix: enable SMTP STARTTLS, live delivery via IPv4 ...`).
- **Credential UX gap**: operators needed safe handoff of SMTP credentials. **Solution**: added copyable credential modal, per-credential sender controls, and domain diagnostics with real authentication checks.
- **Regression safety**: subdomain resolution logic kept drifting. **Solution**: locked behavior with unit tests for parent-domain parsing and resolution, plus an integration test suite (`test: add unit tests for subdomain resolution and parent domain parsing`).

## Known Limitations & Roadmap

- Warmup currently leans on an external Warmbox API for part of the ramp; the internal scheduler/gate should fully own warming in future phases.
- Phase 2 scale target (75 domains / 150k emails/day) requires additional IP pools and per-pool routing beyond the current subdomain pool model.
- The Postal reference in `soruce/postal` is material only; feature parity is partial (no full inbound message routing rules engine yet).
- Repository hygiene: the top-level directory `soruce/` is a misspelling of `source/`, several git commit messages are placeholder noise, and licensing has been standardized as MIT (see [LICENSE](./LICENSE)) instead of the ISC declared in package.json.
- Roadmap candidates: per-tenant IP pool management UI, reply categorization ML, deeper webhook retry policies, and Prometheus metrics export.

## Security Notes

- JWT-based portal auth with bcrypt password hashing; portal responses set no-store cache headers.
- Unverified domains are rejected at the SMTP relay; DKIM keys are stored encrypted using `DKIM_ENCRYPTION_KEY`.
- helmet, compression, morgan, and express-rate-limit are applied globally; JSON body size is capped (10 MB).
- Before publishing this repository, audit history for accidentally committed `.env` values, DKIM private keys, and Cloudflare tokens; rotate any credential that has ever been committed.
- CSP and cross-origin embedder policies are intentionally relaxed for the embedded Postal-replica UI; tighten before exposing the portal publicly.

## License
MIT License � Copyright (c) 2026 Musfiqur Rahman Saimon. See [LICENSE](./LICENSE).


---
Keywords: mta, smtp relay, dkim spf, email deliverability, multi-tenant, warmup, typescript

