# PromoGuard verification report

Updated: 2026-11-03

## Summary

| Check | Result | Scope |
|---|---|---|
| `npm test` | PASS: 161 passed, 0 failed (2026-11-03) | Electron Node test runner; provider/wallet/network behavior is mocked |
| JavaScript syntax | PASS: 62 files (2026-11-03) | Main, preload, renderer, source, web client and tests |
| Electron smoke at 390px | PASS, exit 0, `failed:[]` (2026-11-03) | Eight views, Analytics APIs, archived listing, renderer isolation, review/evidence, and safety gates |
| Electron smoke at 1180px | PASS, exit 0, `failed:[]` (2026-11-03) | Same checks at desktop width |
| Offline web preview | PASS (2026-11-03) | Direct local preview imported a synthetic bundle; search and campaign evidence/history filtering worked |
| Offline PWA shell | PASS (2026-11-03) | HTTPS/localhost registration guards, secure-origin-only service worker handling, static-shell cache allow-list, and PWA manifest/icons covered by focused tests; no mobile-device install acceptance |
| Windows NSIS build | PASS (2026-11-03) | Current source packaged to a temporary directory outside the repository; temporary output removed after verification |
| Dependency audit | Previously recorded PASS: 0 reported (2026-10-26) | `npm audit` and `npm audit --omit=dev`; not rerun in this audit |

## Test coverage

Run with `npm test` (`node test/run.js`), which launches the suite under Electron's Node runtime. The 161 tests cover:

- Campaign payment assertions, source attestation, status transitions, date-only expiry, and zero-reward handling.
- Database initialization and append-only migrations, data preservation, parameterized input storage, and notification-message persistence.
- Feed parsing, URL safety, redirect restrictions, response-size limits, retry/rate-limit behavior, and duplicate handling.
- DNS classification, rejection of mixed public/private DNS answers before connecting, vetted-IP pinning, and redirect revalidation for feed/terms requests.
- TON and EVM network/account parsing, RPC chain checks, integer amount formatting, mocked wallet connection events, consent, persistence, and erasure.
- Claim preflight, missing-terms behavior, payment checks, network mismatch, and conservative receipt attribution.
- User-pasted terms snapshot validation, maximum size, safe HTTPS URL checks, immutable SHA-256 revisions, duplicate handling, and matching-snapshot review gating.
- Backup export/import round-trip of archived campaigns, evidence contents, status history and settings; idempotent imports, schedule-consent reset, pre-write validation, and evidence-hash integrity.
- Offline web bundle validation and UI behaviors, including campaign search, evidence/history filtering, invalid import handling, and clearing the local view.
- Offline PWA registration is limited to secure HTTPS or localhost origins; service-worker tests verify that only same-origin allow-listed static GET assets are cached/served, and the manifest/icon files exist. Imported bundle data is never included in the app-shell cache.
- Advisory AI prompt/data handling and explicit MCP tool consent/dispatch.
- Encrypted storage, including asynchronous OS-storage operations and errors for unreadable encrypted state.
- Closed stdout/stderr pipes (`EPIPE`) do not crash the process; other stream errors are still raised.

All external provider and wallet behavior in automated tests is simulated. These tests are not live service acceptance tests.

## Electron smoke checks

The commands were run sequentially with `PG_SMOKE=1`, first at 390px and then at 1180px. Both returned exit code 0. Assertions covered:

- The preload bridge exists while renderer Node access is unavailable.
- All eight navigation views resolve correctly and have no horizontal overflow.
- Mobile navigation opens and closes at the narrow width.
- Campaign add, duplicate detection, review transitions, separate source attestation, and domain validation.
- Terms snapshot save/hash and preflight loading the matching persisted snapshot rather than renderer-supplied terms.
- Analytics view navigation plus working flags/activity queries; archived records are available through the archive-inclusive API.
- Unsafe feed/manifest URLs and invalid WalletConnect project IDs are rejected.
- Unconnected wallet refresh is rejected; no signing, approval, or transaction-send API is exposed.
- Minimum-reward saving, feed add/remove, scheduled-discovery consent state, and notification message/dismiss behavior.
- Inline script execution is blocked by the content security policy.

The smoke test intentionally sends invalid inputs and makes refresh calls without a connected wallet. Corresponding IPC rejection messages in the console are expected negative assertions, not failed checks.

Chromium emitted non-fatal cache access warnings during this run. They did not cause smoke failures.

## Dependency and packaging checks

Resolved versions: Electron 45.0.0, Electron Builder 26.18.0, and better-sqlite3 13.0.3. `npm audit` and `npm audit --omit=dev` both reported zero vulnerabilities on this run.

Built the current source with:

```powershell
npm run dist -- --config.directories.output="$env:TEMP\PromoGuard-audit-build"
```

The NSIS installer was emitted successfully to the temporary audit-build directory and removed after verification. The builder used the locally installed Electron distribution and skipped native rebuilds because better-sqlite3 provides a platform prebuild.

The package is unsigned, has no configured author or app icon, and uses Electron's default icon; Electron Builder reported these as metadata warnings. No installer install/upgrade/uninstall was performed on a clean Windows profile, and the newly built packaged executable was not launched. A successful build is not a clean-machine installation certification.

The stale installer packages in the repository were removed; locked unpacked application bundles could not be deleted and remain ignored by Git.

## Browser preview and the Electron message

Opening `renderer/index.html` directly is a static browser preview. It intentionally has no Electron preload bridge, database, wallet, feed, or AI access. The standalone `web/index.html` is a source-only local companion for importing the read-only export bundle; it is not included in the Windows installer and has no account, sync, or network API. Its PWA install/offline-cache mode requires HTTPS or localhost; `file://` remains usable for direct bundle imports but cannot install or use the service worker. Mobile browser installation and offline acceptance have not been tested on physical devices.

For the full app, double-click `Start PromoGuard.bat` or run `npm start` from the project folder. Do not use the HTML preview as a substitute.

## Not verified

- Live TON Connect and WalletConnect pairing, real testnet RPC/provider responses, or external service rate limits/terms.
- Live feed fetching, scheduled fetch behavior over time, OS notification delivery, and outage recovery.
- Ollama with a locally installed model.
- Installer acceptance on a clean machine, upgrades, uninstall/data-retention behavior, or signed distribution.
- Accessibility acceptance, independent penetration testing, legal review, or production support.
- Campaign editing, live Markets data, active Predictions, or end-to-end claim submission/receipt proof.
- Restore acceptance with real user backups and older app versions. Local tests cover round-trip behavior and malformed-input rejection, but do not replace user-data recovery drills.
- Independent verification of website ownership or campaign terms. The app can fetch public HTTPS terms with DNS/IP/redirect protections, but a successful fetch and content hash do not establish authenticity or legitimacy.

**Conclusion:** the listed local prototype checks pass. Production readiness and public launch suitability are not established.
