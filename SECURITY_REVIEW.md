# PromoGuard security posture and issue register

Updated: 2026-11-03

This is an engineering review of the current source and dependency audit, not an independent penetration test, formal security certification, or legal/compliance assessment.

## Controls preserved or improved

- Electron renderer isolation, sandboxing, disabled Node integration, restrictive CSP, and a narrow preload API remain in place.
- Campaign policy is fail-closed: unknown payment conditions and missing terms do not become free/eligible. Source attestation is separate from fee attestation.
- TON and WalletConnect integrations remain read-only. The app exposes no signing/approval/transaction-send bridge methods.
- Public-address lookups require separate consent; network/provider identity is checked before RPC reads.
- Wallet sessions and WalletConnect project configuration use OS-backed safe storage; asynchronous safeStorage APIs are used. Unreadable encrypted state is surfaced and explicit erasure is available.
- Provider-scoped erasure now removes associated local snapshots/transactions and revokes relevant lookup permission.
- Main-process stdout/stderr ignores only a broken-pipe `EPIPE` event from a closed parent terminal; non-EPIPE errors remain raised.
- Feed and terms requests resolve each HTTPS target before connecting, reject any DNS answer in non-public/special-use ranges, pin the TLS request to a vetted address, and repeat DNS/IP validation after redirects. Response size, time, redirect count and feed host rate are bounded. UI/renderer does not render remote campaign HTML as trusted markup.
- Backup restore validates all campaign, settings, evidence and status-history records (including evidence content hashes) before transactional writes. It preserves archived state and resets scheduled-fetch consent.
- Notifications persist message text through schema migration v10 without deleting existing notification rows.
- Electron and Electron Builder were upgraded; `better-sqlite3` uses a platform prebuild and packaging skips an unnecessary native rebuild.

## Open risks and release blockers

1. **Campaign provenance remains unverified.** A constrained app fetch and saved content hash preserve what was retrieved, but do not independently prove source ownership, authenticity, completeness, or campaign legitimacy. Keep unknown claims unverified.
2. **External providers receive metadata.** A provider may see a public address and network when the user enables lookups, and may see network metadata such as IP. Provider availability, privacy, and terms require owner/live validation.
3. **Wallet integrations are not live-certified.** Test suites use mocks. A real testnet pairing and consent/erase validation is required before release.
4. **Claim monitoring is limited.** The app does not submit claims. EVM balance increases are unconfirmed; TON matching requires an exact expected transaction hash. Do not interpret balance changes as proof.
5. **Release trust is incomplete.** The NSIS build is unsigned, has no custom icon, and has not been installed or upgraded on a clean profile.
6. **Product placeholders must stay honest.** Markets has no provider; Predictions is inactive. Do not add fake data or real-money features as a shortcut.
7. **Dependency scanning is not a source audit.** A zero `npm audit` result does not prove that first-party code has no vulnerabilities. Continue dependency review and obtain independent review before handling broader user adoption.
8. **Backup files are plaintext.** They include campaign evidence/history and application settings; configured RPC URLs can carry provider tokens. Users should store exports as sensitive files. Import resets schedule consent and cannot make an untrusted backup trustworthy.

## Dependency scan evidence

On 2026-10-26, `npm audit` and `npm audit --omit=dev` both reported zero known vulnerabilities for the resolved lockfile. This is point-in-time package-advisory evidence only; re-run it before every release.

## Required release gate

Before public distribution: test clean install/upgrade/uninstall and data retention; complete real testnet wallet/provider exercises; validate the terms/provenance design; review all IPC and external-link paths; perform accessibility checks; configure a custom icon and code signing; and obtain independent security and legal/compliance advice appropriate to the intended distribution and features.
