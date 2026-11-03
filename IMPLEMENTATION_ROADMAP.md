# PromoGuard implementation roadmap

Updated: 2026-11-03

## Purpose and completion target

This roadmap defines a practical path from the current prototype to a dependable, release-ready PromoGuard application. It assumes the confirmed **local-first** product direction: no accounts, hosted backend, cloud synchronization, or remote campaign database.

For planning, “100% complete” means every agreed platform and release gate below has been implemented and accepted. It is not a claim that the product will never need maintenance or new features. The target includes:

- A reliable Windows desktop app with local campaign and evidence management.
- An offline web/PWA companion that transfers data only through user-selected bundle files.
- A usable iOS/Android mobile experience. The recommended sequence is to validate the PWA on real devices first, then build a native/store app only if PWA limitations prevent the required user experience.
- Clearly configured and tested integrations, safety boundaries, support/recovery documentation, and release acceptance.

This is a scope-based estimate, not a measured metric. The current overall estimate is roughly **40% toward this target**. The components below are independent estimates and are not additive; the weighted plan is intended to make progress measurable at future gates.

## Weighted completion model

| Workstream | Weight | Current estimate | Evidence / remaining gate |
|---|---:|---:|---|
| Product scope and acceptance criteria | 5% | 80% | Local-first and safety boundaries are established. Final platform/release acceptance criteria still need owner approval. |
| Desktop reliability and data workflows | 20% | 70% | Core Electron/SQLite functions and automated tests exist. Clean-profile install, upgrade, restore, accessibility and user acceptance remain. |
| Web/PWA companion | 15% | 50% | Offline import, edit, draft and export paths exist. Real browser/device acceptance, broader usability and complete accessibility review remain. |
| Mobile delivery | 15% | 10% | Responsive web shell exists; no physical-device acceptance or native client exists. |
| External integrations | 15% | 35% | Integration paths and mocked tests exist. Owner configuration and live testnet/provider acceptance remain. |
| Privacy, safety and data recovery | 10% | 55% | Strong local safety controls and bundle/backup tests exist. Recovery drills, privacy review and independent security review remain. |
| Release engineering and accessibility | 15% | 25% | NSIS packaging and smoke checks exist. Signing, branding, update/recovery operations and formal acceptance remain. |
| Launch and support readiness | 5% | 0% | No public release/support process has been accepted. |

Using these weights gives an approximate current score near 40%. Re-score only when a workstream's acceptance gate is demonstrated; do not treat test count or lines of code as completion.

## Ordered implementation phases

### Phase 0 — Lock the product boundary and acceptance checklist

**Deliverable:** approved release definition for desktop, PWA, and mobile; maintain the local-first/no-cloud decision.

**Work**
- Confirm the first supported OS/browser/device matrix and the minimum accessibility target.
- Decide whether “mobile app” means an installable PWA is sufficient or whether App Store/Google Play native packages are required. Recommended first gate: PWA acceptance on actual devices before choosing a native wrapper/framework.
- Define safe data handling: desktop SQLite remains the durable source; web/PWA bundle stays user-selected and transient; no account or sync.
- Keep claims submission, trading/signing, real-money predictions, and unsupported earnings/eligibility assertions outside the release scope.

**Exit checks**
- Written platform matrix, supported workflows, non-goals, privacy behavior, and release acceptance checklist.
- Any decision to add cloud, accounts, mobile persistence, or transaction execution is treated as a new scoped design decision, not inferred from this plan.

### Phase 1 — Finish desktop product hardening

**Deliverable:** the existing Windows desktop prototype passes a repeatable user-acceptance and data-recovery checklist.

**Work**
- Test install, first launch, restart, upgrade, uninstall, and retained/deleted user data on a clean Windows profile.
- Exercise backup and restore with representative campaigns, archived records, evidence, status history, settings, and malformed files; document restore steps and backup limitations.
- Walk through campaign creation, review, edit, archive, discovery, search, evidence/history, activity, settings, and wallet-data erase/revoke paths.
- Run accessibility review for keyboard-only use, focus order, dialogs, labels, live announcements, contrast, and screen-reader navigation.
- Rerun supported Node/Electron version checks, full test suite, smoke tests at narrow and desktop sizes, and dependency/security audit.

**Exit checks**
- Clean-profile install/upgrade/uninstall checklist passes with documented user-data behavior.
- No known data-loss, unsafe status transition, blocking accessibility defect, or release-blocking test failure.
- Backup restore is demonstrated from a real test export, not only unit tests.

### Phase 2 — Complete the offline bundle workflow

**Deliverable:** desktop and browser companion exchange a versioned bundle predictably without a server.

**Work**
- Test desktop export → PWA import → edit/draft → export → desktop re-import end to end using disposable fixtures.
- Check schema/version mismatch, large files, malformed references, duplicate IDs, timestamps, and interrupted/cancelled file flows.
- Improve UI guidance for import/export, unsaved work, desktop review, privacy of exported terms text, and recovery from invalid files.
- Maintain the current guarantees: no API calls, no imported-data browser storage, no imported-data service-worker caching, no mutation of the selected source file, no evidence/hash changes, and no eligibility/payment promotion.
- Add export compatibility fixtures so future desktop schema changes do not silently break the companion.

**Exit checks**
- Round-trip test preserves supported campaign/evidence/history data and clearly reports fields the companion cannot edit.
- On the browser, edits and drafts remain in memory until a user explicitly exports; cancel/discard and invalid-import behavior are verified.
- Service worker demonstrably caches only the static shell.

### Phase 3 — Accept the mobile PWA on real devices

**Deliverable:** supported mobile browsers can install/open the companion, import a bundle, use it offline, and export a new bundle.

**Work**
- Test current iOS Safari and Android Chrome (plus any additional agreed browsers) on representative physical devices.
- Verify installation prompts, standalone display, viewport/safe areas, touch targets, dialog behavior, keyboard/assistive technology, file selection, download/share behavior, and low-storage/error cases.
- Verify first online shell load and later offline shell launch; verify the user must select the bundle again and that imported content is not cached.
- Document platform-specific limitations and supported browser versions.

**Exit checks**
- Device/browser matrix records pass/fail for import, read, edit, draft, export, offline shell, accessibility basics, and update behavior.
- No unsupported workflow is presented as working; blockers are shown clearly.
- If this meets the product need, PWA can be the mobile release. If it does not, proceed to Phase 4.

### Phase 4 — Build a native mobile app only if required

**Deliverable:** iOS and Android application packages with the same conservative local bundle workflow.

**Work**
- Make the PWA device-test result the decision input. If store distribution or native file access is required, compare a thin Capacitor wrapper reusing the companion with a separate native UI; select and document one approach before scaffolding.
- Implement OS document-picker import and share/export, responsive accessible screens, clear unsaved-change handling, local error reporting, and platform lifecycle behavior.
- Preserve the no-account/no-cloud model. Do not retain bundle contents beyond the agreed local behavior; keep the PWA's no-persistence guarantee.
- Add platform-specific privacy manifests/permissions, signing setup, store metadata, and test builds.
- Test install, update, offline behavior, import/export, accessibility, and data erasure on physical iOS and Android devices.

**Exit checks**
- Signed test packages install and pass the agreed device workflow on both platforms.
- Permissions are minimal and explained; no hidden network, tracking, account, or synchronization behavior exists.
- Store submission is not considered complete until review/approval by each store.

### Phase 5 — Validate owner-configured integrations

**Deliverable:** documented, consented integration setups that work against intended test environments.

**Work**
- TON: owner-hosted HTTPS manifest, test wallet, network mismatch/error handling, reconnect/disconnect, consent revocation, and scoped local erasure.
- WalletConnect/EVM: owner-created Reown project ID, approved testnet RPC endpoints, chain-ID validation, unsupported-network handling, consent and erasure.
- Feeds and terms: representative live but non-sensitive sources, rate/error/redirect behavior, DNS/public-IP protections, response limits, and clear unverified-source labeling.
- Local AI/MCP: supported local Ollama/model setup, failure behavior, advisory-only labeling, and per-tool consent review.
- Record provider terms, privacy implications, rate limits, credentials owner, and renewal/rotation instructions. Never place secrets in source control or public logs.

**Exit checks**
- Each integration has an owner, documented setup, consent/revocation/erase tests, and a live acceptance record.
- Providers remain optional; provider failure cannot mark a campaign eligible or fabricate reward data.
- No claim-submission, transaction-signing, trading, or real-money behavior is enabled by this phase.

### Phase 6 — Release, accessibility, privacy, and recovery readiness

**Deliverable:** reproducible release candidates and support procedures for each platform included in the release.

**Work**
- Add production app icons, publisher metadata, versioning, code signing/notarization as applicable, and a documented update/rollback approach.
- Define crash/log privacy, user support, vulnerability reporting, backup protection, restore steps, and data deletion behavior.
- Run independent security/privacy review and accessibility acceptance; resolve all critical/high release findings.
- Re-run full tests, syntax/lint/build checks, desktop smoke, web/PWA checks, platform tests, dependency audit, and packaging from a clean checkout.
- Verify release artifacts and checksums; document known limitations and supported versions.

**Exit checks**
- Release checklist and review findings are signed off by the responsible owner(s).
- Install, update, restore, offline behavior, privacy notices, and uninstall/data behavior are documented and reproducible.
- No unresolved critical/high security or data-loss issue.

### Phase 7 — Controlled release and post-release monitoring

**Deliverable:** a limited release with a rollback and support path.

**Work**
- Release to a small, defined user group; collect only consented, privacy-reviewed feedback.
- Track crashes, support issues, compatibility reports, and data-recovery issues without collecting wallet secrets or unnecessary campaign data.
- Fix release blockers, then decide whether to broaden distribution.

**Exit checks**
- Support owner and incident/rollback procedure are active.
- No unresolved release-blocking crashes, data-loss reports, or privacy/security incidents.
- The agreed platform matrix and product acceptance checklist pass.

## Features to complete or add

**High priority for a reliable local-first product**
- Guided, recoverable desktop backup/restore and clear export privacy warnings.
- Reliable desktop↔PWA/mobile bundle round-trip with explicit schema compatibility.
- Mobile file import/export and offline acceptance, including platform/browser limitations.
- Accessibility and release/update/recovery workflows.
- Better integration setup diagnostics without transmitting credentials or campaign data.

**Optional, only after owner requirements and source/provider validation**
- Additional trusted feed adapters or campaign-source quality signals.
- A selected market-data integration with attribution, licensing, privacy, outage behavior, and tests.
- Native mobile store apps if PWA acceptance fails the agreed requirements.

**Explicitly not part of this 100% target**
- Accounts, hosted backend, cloud synchronization, social profiles, or remote campaign storage.
- Signing, transaction approval/sending, automated claim submission, or guaranteed receipt attribution.
- Real-money predictions, exchange/trading features, or promises of earnings/eligibility.
- Live market panels before a provider and its rights/limits are validated.

## Owners, prerequisites, and blockers

The code work can proceed locally, but the following require owner participation:

- Test devices and supported OS/browser choices for mobile acceptance.
- A clean Windows profile or test machine for installer lifecycle checks.
- Owner-controlled TON manifest hosting, Reown project configuration, and approved RPC endpoints if those integrations are to be accepted.
- A selected/licensed market provider only if live Markets is in scope.
- Release publisher identity, signing certificates/accounts, app-store accounts (if native distribution is required), and support contact/process.
- Accessibility, security, and privacy reviewers appropriate for the release audience.

Do not paste credentials into chat or commit them. If a prerequisite is unavailable, mark that integration/platform gate **blocked/unverified** rather than treating a mock test as acceptance.

## Definition of 100% for the agreed release

The project is considered complete for its defined release only when:

1. The Phase 0 scope and platform matrix are approved.
2. Every platform in scope passes its documented user workflow and accessibility checks.
3. Desktop storage, backup/restore, PWA/mobile bundle exchange, and data-erasure behavior pass acceptance.
4. Every advertised external integration is owner-configured and live-tested, or clearly labeled unavailable and excluded from the release promise.
5. Packaging, signing/store requirements, updates, support, recovery, privacy, and security gates pass for the release audience.
6. All release-blocking findings are closed, and known limitations are published.

The product may be complete without Markets, Predictions, claims submission, or cloud services if those remain explicit non-goals. “100%” applies to the approved, safe product scope—not every feature imaginable.
