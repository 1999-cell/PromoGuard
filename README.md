# PromoGuard

PromoGuard is a local Windows Electron app for reviewing possible zero-payment crypto reward campaigns. The refreshed workspace provides campaign review and feed discovery, optional consent-gated **read-only** TON/EVM wallet lookups, local activity, and advisory AI/MCP tools.

The Markets view currently explains that no market-data provider is connected. Predictions is an explicitly inactive paper/demo placeholder: it has no odds, stakes, money, prizes, or payouts. Neither view fabricates live data. PromoGuard does not trade, sign, approve, send transactions, submit claims, or guarantee eligibility, legitimacy, or earnings.

## Run on Windows

Prerequisites: Windows 10/11, Node.js 22.12 or newer, and npm.

For normal use, double-click **`Start PromoGuard.bat`** in this project folder. It launches the secure Electron desktop app.

Or, open PowerShell in this folder and run:

```powershell
npm ci
npm test
npm start
```

Do not double-click `renderer\index.html` to run the application. Opening that file directly shows a static browser preview; browser pages do not receive the isolated Electron preload API and cannot access the app database, wallet services, discovery, or AI. The preview now explains this without an error popup and disables service controls rather than pretending they work.

If a browser tab is already open, press **Ctrl+F5** once to reload the HTML and its versioned script. The versioned script URL prevents the browser from reusing the older cached renderer that showed the red Electron error. For the actual working app, launch `Start PromoGuard.bat`; do not use the browser preview.

If the terminal or VS Code task that launched PromoGuard is closed while the app remains open, diagnostic output may encounter a broken pipe. PromoGuard now ignores only that closed-output condition; other stream errors are not suppressed.

Build the configured Windows NSIS installer:

```powershell
npm run dist -- --config.directories.output=dist-release
```

The installer is written to `dist-release`, avoiding replacement of existing build output. Building it does not certify clean-machine installation, upgrades, uninstall/data retention, code signing, or production readiness; those require separate validation.

## Workspace walkthrough

1. **Overview:** see local campaign totals, recent records, and the safety boundaries. Counts are not earnings or account balances.
2. **PromoGuard:** add a campaign URL from the project’s official site. Example only (not a real offer):

   ```text
   Name: Example community reward
   Official terms URL: https://project.example/terms
   Network: ton-testnet
   Token ID: ton-testnet:native
   Reward amount: 2 (only if the official terms state this)
   ```

   Add the real project’s exact public domain in **Settings & AI** only after independently checking it. The allow-list is a local policy gate, not proof that a domain or campaign is legitimate. The form has separate attestations for the payment conditions and the project source. During review, you can paste the current terms or use **Fetch official terms**; save a snapshot and use the same URL when submitting evidence. Requests are HTTPS-only, DNS-checked against non-public IP ranges, pinned to a vetted address, redirect-checked, and size/time limited. Fetched or pasted content is not independently verified. Leave attestations unchecked if uncertain. Missing or mismatched snapshots keep the campaign under review.

3. **Campaign review:** search and filter records, include archived campaigns when needed, edit campaign details in the labeled dialog, and inspect reasons and history. Editing details returns a record to review; its saved evidence revisions remain in history but may no longer match. Treat `Eligible for review` as the result of local checks—not a promise, verification, claim, or payment. **Export read-only web bundle** produces a user-selected JSON package using the versioned `promoguard.web-readonly` contract (campaigns, terms evidence and status history only); from the project source folder, open `web\index.html` in a browser and import the file for an offline preview. This source-only preview is not included in the Windows installer. It does not sync data or provide an API.
4. **Discover leads:** add a public HTTPS RSS/Atom/GDELT feed, run discovery, and approve the site-contact prompt. Results are unverified leads; open and check the official project terms yourself. Scheduled checks require separate consent.
5. **Wallet Center (optional):** start on testnet. TON Connect needs a public HTTPS manifest you host; WalletConnect needs your Reown project ID, and some networks need your RPC endpoint. Connecting and enabling public-data lookups are separate actions. Providers can see a public address when you enable lookups. Never enter a seed phrase or private key.
6. **Activity:** inspect local activity counters, notifications, alerts, and claim-preflight records. External services are not health-checked from this view. A balance increase is not proof that a campaign paid.
7. **Settings & AI (optional):** local AI requires Ollama and the configured model. AI summaries are advisory and may be wrong; compare them with the source terms. MCP tools require explicit per-tool consent.
8. **Markets / Predictions:** these sections are not active data services. Do not use them as a source of live prices, odds, recommendations, or outcomes.

If an offer asks you to pay gas, deposit, buy, stake, transfer funds, grant an unlimited approval, or reveal a secret to receive a purportedly free reward, stop and reject it.

## Current limitations

- No campaign is independently certified by PromoGuard, and no earnings, eligibility, safety, or reward delivery are guaranteed.
- Wallet/RPC/feed automated coverage is mocked. Real wallet pairing, live provider responses, Ollama integration, and clean-Windows user acceptance are not certified.
- Claim support is preflight only. There is no safe, verified end-to-end claim submission or receipt verification workflow.
- Terms fetching is constrained and records the result, but neither a fetched page nor a user-pasted snapshot proves source ownership or campaign legitimacy.
- JSON backup/restore covers campaigns, archived state, evidence revisions, status history, and app settings. It is not encrypted; configured RPC URLs may contain provider tokens, so protect the exported file. Import validates the whole payload before writing and resets scheduled-fetch consent.
- The versioned read-only web bundle is an offline integration seam, not a hosted API or authenticated web app. It includes campaign terms evidence, excludes wallet data/settings/provider credentials, and remains under the user's file-export control.
- Keyboard navigation in the desktop app moves focus to the selected section heading; the narrow-screen menu receives focus when opened and Escape closes it and restores focus to its toggle.
- Campaign results are exposed as a named list for screen-reader navigation; search and status/archive filters announce the visible record count and empty-result state.
- Overview campaign totals are grouped into a named list of four metric cards for assistive-technology navigation.
- Analytics charts have text alternatives linked to their canvases and expandable, structured data tables for exact counts.
- The source-only web prototype (`web\index.html`) imports the versioned bundle locally; it is not included in the packaged installer. Its optional installable PWA mode requires HTTPS or localhost: the service worker caches only the static app shell, only for same-origin GET requests. It never caches imported bundle files; select the JSON again whenever the page is reopened. Direct `file://` preview still supports import but cannot register a service worker or be installed. The page validates contract shape and references, renders untrusted values as text, labels data tables for assistive technology, and makes horizontally scrollable tables keyboard-focusable on narrow screens. It blocks external connections with CSP. Search filters campaign name, publisher, network, status, and reasons locally; its campaign selector scopes evidence and status history without changing the imported bundle. It does not offer editing, authentication, synchronization, or a network API.
- **Optional mobile installation:** serve the `web` folder as static files from an HTTPS host, or use `localhost` when testing on the same device. Open `index.html` in a supporting browser, then choose **Install app** or **Add to Home Screen** from that browser's menu. This repository does not include or start a web server. Open the installed viewer once while the static origin is reachable so its shell can be cached; after that, the shell can open offline. Choose the exported JSON bundle each time—the data file is neither cached nor saved by the viewer.
- Markets data, active paper predictions, EVM token discovery/history, broad social discovery, signed releases, and production support are not complete.

See [PROJECT_STATUS.md](./PROJECT_STATUS.md) for the current feature state and [TEST_REPORT.md](./TEST_REPORT.md) for the latest verification. [PROJECT_AUDIT.md](./PROJECT_AUDIT.md) records the detailed audit and remaining work. Provider setup and privacy notes are in [API_AND_DATA_SOURCES.md](./API_AND_DATA_SOURCES.md), and the offline bundle contract is in [docs/API_CONTRACT.md](./docs/API_CONTRACT.md). Older planning documents were removed because they duplicated current documentation or contained stale status claims. The supplied PDFs are retained as historical reference material; their completion estimates and future-feature descriptions are not current implementation evidence.
