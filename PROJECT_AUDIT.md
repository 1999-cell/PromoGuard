# PromoGuard full project audit

Updated: 2026-11-03

## Executive summary

PromoGuard is a Windows desktop prototype for evidence-led review of potential zero-payment crypto rewards. The source has a cohesive responsive Electron UI, local SQLite storage, campaign policy checks, public-feed lead discovery, consent-gated read-only TON/EVM wallet paths, preflight-only claim support, and advisory local AI/MCP tools.

The current source has local campaign review, discovery, optional consent-gated read-only wallet paths, bounded terms fetching, evidence history and JSON backup/restore. Local tests and Electron smoke checks cover those code paths, but do not establish live provider acceptance, campaign legitimacy, earnings or production readiness. Several external workflows still require owner credentials, hosting and live validation; Markets, Predictions and end-to-end claims are not product-complete.

## Scope and source of truth

Reviewed first-party application code and its directly related project material: `main.js`, `preload.js`, `renderer/`, `src/`, `test/`, `package.json`/lockfile, README, status/test/security/provider docs, and implementation-plan material. Dependency advisories were checked with `npm audit`; third-party packages were not manually source-audited.

The actual package version is `0.1.0`. The older implementation plan/PDFs contain historical version and completion claims that conflict with current source and tests. Treat those numbers as historical, not as current completion. The three project-plan PDFs are duplicate copies; a separate completion-report PDF in the supplied folder describes a different Python project. The Next-Gen exchange and real-money prediction ideas are not implemented or approved requirements.

## Product boundary

- **What it is:** a local review and evidence-organizing tool for public campaign leads.
- **What it is not:** an exchange, wallet custodian, trading system, transaction signer, claim submitter, or earnings service.
- **Wallet access:** optional, read-only and consent-gated. No seed phrase/private key/password entry is required or supported.
- **Eligibility language:** local evidence and deterministic rules only. “Eligible for review” is not proof of source legitimacy, final eligibility or payment.
- **Browser preview:** `renderer/index.html` may show static navigation and a clear notice. It cannot access Electron's isolated preload/database/wallet services. Do not weaken the security boundary to make `file://` behave like the desktop app.

## Application map

| Surface | What is implemented | Important limitation |
|---|---|---|
| Overview | Persisted campaign summary, recent records, safety messages and shortcuts | Counts are local records, not earnings or wallet balances |
| PromoGuard | Add/review campaign records, inspect status/reasons, search/filter, provide evidence URL and separate attestations, save immutable user-pasted terms snapshots with SHA-256 revision history | Snapshots are user-provided, not fetched or independently verified; source allow-list and user assertions do not certify a campaign |
| Discover leads | Add/remove feeds, run discovery, deduplicate parsed items, consent to scheduled checks | Leads remain unverified; live feed reliability and external social discovery are not certified |
| Markets | Honest provider-not-configured state | No price provider, chart or current market data |
| Predictions (Paper) | Clearly inactive/demo placeholder | No active odds/outcomes, money, prizes, redeemable points or payouts |
| Wallet Center | TON Connect and WalletConnect/EVM connection and public-data panels; separate consent, network checks and local erasure | Pairing, live RPC data and provider terms require testnet/owner verification; EVM token discovery/history is not complete |
| Activity | Local counters, persisted notifications, alerts and preflight records | No external-service health monitoring; balance changes do not prove a reward |
| Settings & AI | Reward threshold, domain allow-list, feed/schedule settings, provider configuration, local Ollama AI and consent-gated MCP | AI is advisory only; Ollama must be installed/configured; no cloud AI or independent content verification |

## Defects found and work completed

| Finding | Impact | Resolution |
|---|---|---|
| Date-only campaign end dates could expire too early; expiry sweep's open set included terminal states | Valid offers could expire on their stated final date, and a sweep could attempt invalid state transitions | Shared inclusive date-only logic; sweep now touches only valid campaign-review states; regression tests added |
| Zero reward could pass when the minimum threshold was configured as zero | Incorrect eligibility result | Require a positive reward independently of the configured threshold |
| A terms URL could be mistaken for the terms themselves | Claim preflight could imply it had evidence that was never fetched | Require actual terms content; URL-only entries remain blocked/unverified |
| Campaign review could rely on a terms URL and attestations without a retained terms revision | A later reviewer could not reproduce which terms the user reviewed | Added user-pasted terms snapshots with size/HTTPS validation, immutable SHA-256 revisions, matching-URL review gating, and preflight loading from persisted evidence. The app does not fetch or independently verify the pasted source. |
| Feed and terms DNS answers were not checked before the request, leaving DNS rebinding/redirect exposure | A public-looking hostname could resolve to a local or special-use address during the outbound request | Resolve and vet every answer before connection, pin HTTPS to a vetted IP while retaining TLS hostname verification, and repeat for each redirect; add mocked mixed-answer and redirect tests |
| Backup export omitted archived campaigns and importer ignored evidence, history, and settings | Restore could silently lose archived state and review provenance | Export the archive-inclusive campaign set plus evidence/history/settings; validate all payload sections and evidence hashes before transactional, deduplicating restore; reset scheduled-discovery consent |
| Archive checkbox queried only the default active list; analytics selected a nonexistent notification timestamp | Archived records could not be displayed; Analytics activity query failed | Use archive-inclusive listing when selected and query notification `shown_at`; add Analytics navigation smoke coverage |
| Notification text was discarded by storage | Activity entries were uninformative | Append-only migration v10 adds message storage and UI rendering without deleting old rows |
| Feed and setting controls did not expose all supported operations/state | Users could not reliably manage a feed, see scheduling state or change the minimum reward | Added the missing actions and state display, with smoke assertions |
| Wallet lookup consent could not be revoked consistently; provider erasure left related local records/permissions | Users lacked an adequate local privacy control | Added revocation and provider-scoped erasure, retaining the boundary between session/configuration and cached chain data |
| “Record health check” created a timestamp without contacting or checking a service | UI implied a check had occurred when none had | Removed the fake action; the Activity view says external services are not health-checked there |
| Electron 45 with an older SQLite binary produced an ABI mismatch | Database tests/app could not load the native module | Upgraded to `better-sqlite3` 13 Node-API prebuilds and configured packaging to skip unnecessary native rebuild |
| Electron 45 deprecated synchronous safeStorage calls | Runtime emitted a deprecation warning and future compatibility risk existed | Switched session/config storage to async safeStorage methods; test coverage added |
| Windows builder config had an invalid signing option and archive extraction could hit a locked rename | Packaging failed | Corrected the Windows config and configured `electronDist` to use the installed Electron distribution; verified a fresh NSIS output |
| Existing browser tab retained an old renderer resource | Users repeatedly saw a stale Electron-required message | Root cause confirmed as stale cached JS; the current versioned assets render the static preview notice, not the old error |
| Closing the launching terminal could make Electron's main-process error logging write to a closed stdout/stderr pipe | A logging `EPIPE` could trigger a JavaScript error dialog even when the underlying IPC error was handled | Added a narrow output-stream guard that ignores only `EPIPE`; other stream errors remain visible. Regression tests cover both cases. |

No wallet signing, transfers, claim execution, made-up market data, or real-money prediction functionality was introduced.

## Step-by-step: run and use the current prototype

### 1. Install and run the desktop application

Use Windows 10/11 and Node.js 22.12 or newer. In PowerShell, from the project root:

```powershell
npm ci
npm test
npm start
```

Or double-click `Start PromoGuard.bat`. The full application is the Electron window. Opening `renderer\index.html` directly is only a static preview. If a browser tab shows stale content, press **Ctrl+F5** once; the current HTML requests versioned assets.

### 2. Review a campaign conservatively

Use only an official project source that you independently checked. Add the actual public domain to Settings only after checking it. Example form data below is deliberately fictitious and must not be treated as a real offer:

```text
Name: Example community reward
Terms URL: https://project.example/terms
Network: ton-testnet
Token ID: ton-testnet:native
Reward amount: 2 (only when official terms state that amount)
```

The `.example` domain is a placeholder and cannot establish legitimacy. Confirm payment-related conditions and official source separately. Unknown terms stay **Unverified**. A qualifying local review is not a claim or payment.

### 3. Discover leads

Add a public HTTPS RSS/Atom/GDELT source you control or independently trust. Run discovery and review each returned lead on the actual project's official site. Grant separate consent before enabling scheduled fetches. Discovery never makes a lead eligible by itself.

### 4. Optional read-only wallet setup

- Start on testnet. TON Connect requires a public HTTPS manifest hosted by the owner.
- WalletConnect requires the owner's Reown project ID. Some EVM networks also need a user-supplied HTTPS RPC endpoint.
- Pairing and public-data lookup consent are separate. Only enable lookups after reviewing what the selected provider receives.
- Do not enter or share seed phrases/private keys. No signing or transfers are available in PromoGuard.

### 5. Optional local AI/MCP

Install and start Ollama locally, configure a model available on that machine, then treat summaries as fallible advice and compare them with primary terms. Grant MCP tools individually; these tools do not override deterministic policy.

### 6. Do not use inactive features as live services

Markets has no market data. Predictions is inactive. Claim tools prepare/check information only; they do not submit an on-chain claim. Stop if a purported free offer asks for a deposit, purchase, staking, transfer, gas payment, unlimited approval or secret phrase.

## External integration prerequisites and remaining work

1. **TON:** publish and verify the manifest over HTTPS; configure it; pair a test wallet; validate network mismatch, provider errors, consent revocation and erase/reconnect behavior.
2. **WalletConnect/EVM:** use an owner-created Reown project ID; test supported testnets and configured RPC chain ID; validate privacy/terms, disconnection and data erasure.
3. **Campaign trust:** safe app-initiated terms fetching now has DNS/IP/redirect/response bounds and IP pinning. Independently validate source ownership; fetched content and hashes are not proof, and unknown or failed fetches must stay unverified.
4. **Claim receipts:** do not enable submission. A future design needs exact expected-transaction evidence and a robust provider/indexer; a balance rise is not a receipt.
5. **Markets:** choose a provider, document attribution/licensing/limits and privacy, then validate response/outage behavior before charts.
6. **Operations/release:** clean-profile install/upgrade/uninstall tests, data-retention checks, app icon, publisher metadata, code signing, accessibility acceptance, recovery/support and independent security/legal review.
7. **Future predictions:** keep the feature inactive or strictly valueless paper/demo mode. Real-money prediction or exchange functions need a separate legal/compliance and security approval, not a disclaimer.

There is no honest completion percentage or earnings forecast to report from this code audit. The next release decision should depend on the integration and clean-install acceptance gates above.

## Verification snapshot

See [TEST_REPORT.md](./TEST_REPORT.md) for the full command/results table and [API_AND_DATA_SOURCES.md](./API_AND_DATA_SOURCES.md) for provider prerequisites. At the latest local test run on 2026-11-03, 164 automated tests passed; all 57 project JavaScript files passed syntax checks, Electron smoke checks at 390px and 1180px returned `failed:[]`, the local web companion and secure-origin PWA behavior were exercised with local fixtures, and a current Windows NSIS package build succeeded. Real providers, a clean installer install/upgrade/uninstall, physical-device PWA installation, a public launch, and production readiness remain unverified. The initial public-repository upload includes the current source, tests, and project docs; local credentials/configuration, the personal wallet note, unrelated analytics files, dependencies, and generated build output are excluded.
