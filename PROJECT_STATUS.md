# PromoGuard project status

Updated: 2026-11-03

## Verdict

PromoGuard is a local Windows Electron prototype for evidence-led review of possible zero-payment crypto reward campaigns. The campaign, feed, settings, local activity, advisory AI/MCP, and read-only wallet paths have automated coverage. It is not a production-ready financial product, and no software result can guarantee that an offer is legitimate, a user qualifies, or a reward will be paid.

The application does not trade, sign, approve, send transactions, submit claims, or promise earnings. Wallet access is optional and consent-gated. **Eligible for review** is a local policy result, not a certification or payment confirmation.

## Current feature state

| Area | State |
|---|---|
| Electron application shell | Implemented: eight navigable views, responsive layout, isolated renderer, narrow preload API, CSP, local SQLite |
| Browser preview | Implemented: static navigation and a non-modal notice; secure-service controls are unavailable outside Electron by design |
| Campaign review | Implemented: explicit payment-condition assertions, separate source attestation, allow-list gate, review history, conservative expiry handling, and immutable terms snapshots with SHA-256 revision history; HTTPS terms fetch is DNS/IP checked and pinned |
| Lead discovery | Implemented: RSS/Atom/GDELT parsing, public-IP DNS vetting and pinned HTTPS requests, redirect/response limits, deduplication and explicit discovery consent; live feeds not certified |
| Wallet Center | Implemented in source: optional TON Connect and WalletConnect/EVM flows, encrypted local session storage, network and per-provider lookup consent; live pairing not certified |
| Claims | Preflight and limited monitoring only; no supported claim submission or complete verified receipt workflow |
| AI and MCP | Local advisory AI and consent-gated read-only tools; outputs cannot decide eligibility or bypass campaign policy |
| Activity and settings | Local counters, persisted notification messages, alerts, feed/schedule management, reward threshold, domain allow-list and wallet-data controls |
| Markets | Not connected to a market-data provider |
| Predictions (Paper) | Inactive placeholder; no live odds, money, prizes, points or payouts |
| Windows packaging | NSIS build configured and verified in an alternate output directory; unsigned and not installed on a clean profile |
| Backup/restore | Implemented: JSON export/import includes archived campaigns, evidence revisions, status history, and validated app settings; scheduled-fetch consent is reset |
| Offline web companion | Implemented as a source-only local read-only bundle viewer with campaign search, per-campaign evidence/history filtering, and an HTTPS/localhost-only installable PWA shell; not included in the Windows installer; no login, sync, or network API |

## Fixes completed in this audit

- Fixed date-only campaign expiry so the chosen end date remains valid through that UTC date. Expiry sweeping no longer attempts invalid transitions for terminal campaign states.
- Prevented zero rewards from becoming eligible when the configured minimum is zero; malformed dates remain unverified.
- Kept a terms URL distinct from terms content. Added user-pasted terms snapshots with SHA-256 revision history; review now requires a saved snapshot for the matching URL, and claim preflight reads the stored snapshot rather than trusting renderer-supplied text. PromoGuard does not fetch or independently verify the pasted source.
- Closed the feed/terms DNS-rebinding gap: resolve each HTTPS target before requesting it, reject any special-use/private IP answer, pin the TLS request to a vetted address, and repeat validation for every redirect.
- Completed backup round-trip support: include archived records, evidence content and status history; validate campaigns, settings and evidence hashes before transactional import; deduplicate records and reset imported schedule consent.
- Fixed archived filtering to use the archive-inclusive API, repaired notification analytics to use `shown_at`, enabled Analytics navigation, and corrected the smoke assertion to match all eight views.
- Added migration v10 so notification messages are persisted and displayed; prior notifications remain intact.
- Corrected feed removal/listing, scheduled-discovery status, minimum-reward settings, and the UI path for revoking wallet lookup consent.
- Scoped wallet-data erasure to the selected provider and revoked related lookup permissions. Encrypted session and project-ID erasure remains a separate provider action.
- Removed a manual "record health check" control that created a timestamp without checking a service. The Activity view now describes local activity counters and explicitly says external services are not checked there.
- Updated Electron to 45 and Electron Builder to 26.18, upgraded `better-sqlite3` to its Node-API prebuild release, and disabled unnecessary native rebuilds. This avoids the previous Electron/native-module ABI mismatch and builds without requiring local Visual Studio C++ tools.
- Switched OS-backed wallet storage to Electron's asynchronous safe-storage API, removing the Electron 45 deprecation warning.
- Corrected the Windows packaging configuration and made the builder use the installed Electron distribution, avoiding an observed Windows archive rename/lock failure.
- Bumped renderer asset URLs so an already-open HTML preview can load the latest browser-safe notice rather than a cached renderer.
- Added a narrow stdout/stderr error handler for the reported broken-pipe (`EPIPE`) condition. It does not suppress other stream errors or use a global uncaught-exception handler.

## Verification

See [TEST_REPORT.md](./TEST_REPORT.md) for exact commands and results. The latest recorded checks are:

- `npm test`: 164 passed, 0 failed, including DNS policy/pinning, redirect validation, backup round-trip/invalid-input, offline web UI, and secure-origin PWA coverage.
- JavaScript syntax checks: all 62 project JavaScript files passed.
- Electron smoke checks at 390px and 1180px: exited 0 with `failed:[]`.
- Direct local web preview: synthetic bundle import, campaign search, and evidence/history filtering passed.
- Current Windows NSIS packaging build: succeeded to a temporary directory; package is unsigned and has no configured author or app icon.
- Dependency audit: the last recorded `npm audit` and production-only audit reported zero advisories on 2026-10-26; they were not rerun in this audit.

These checks cover local code paths and mocked providers. They do not establish live integration, clean-install acceptance, legal compliance, security certification, or production readiness.

The checkout contains many source and documentation files as untracked files; only `README.md` and `renderer/app.js` are currently tracked by Git. No files were staged or committed during this audit. Preserve this local checkout before moving it or cleaning any further artifacts.

## Remaining work, in priority order

1. Run a clean-profile installer acceptance test: install, launch, restart, upgrade, uninstall, and confirm user-data retention and deletion behavior.
2. Complete live testnet pairing for TON and WalletConnect with an owner-hosted HTTPS TON manifest, a Reown project ID, verified RPC endpoints, provider terms, and explicit consent/revocation/erasure checks.
3. Independently validate source ownership and continue testing the bounded terms-fetch flow; fetched content is not proof of legitimacy. Backups are plaintext JSON and must be kept private.
4. Keep claim execution disabled until an independently reviewed workflow can safely attribute a real submission and verified receipt. A balance increase alone is not proof.
5. Select and validate a market-data provider before implementing charts. Keep Predictions visibly inactive or implement only unmistakable paper/demo behavior with no value or payout.
6. Add accessibility acceptance, icon and release metadata, code signing, update strategy, support and recovery procedures before public distribution.

## Product and planning documents

Older planning documents were removed because they duplicated current documentation or contained stale status claims. The supplied plan PDFs remain historical design material; their version/completion claims do not describe the current source. The project PDFs are duplicate copies; the separate completion-report PDF in the supplied folder describes an unrelated Python prompt-optimization project. The exchange and real-money prediction concepts in the Next-Gen PDFs are not implemented or approved requirements.

Do not treat a plan percentage, a test pass, or a local eligibility result as evidence of business success, earnings, safety or regulatory approval.
