# Provider and external-data inventory

Updated: 2026-10-26

This is a source-code inventory, not a live verification of external services, rate limits, privacy terms, or provider reliability. No API credentials were supplied. Do not interpret configured endpoints as an endorsement.

| Integration | Implemented behavior | Setup or data disclosure | Validation status |
|---|---|---|---|
| RSS/Atom/GDELT discovery | Fetch and parse public campaign leads; deduplicate and store as unverified leads | User adds a public HTTPS feed and approves discovery/contact behavior; feed hosts receive the request | Parser/limits are tested with fixtures; live feeds and scheduled operation are not certified |
| TON Connect | Optional wallet session through the TON Connect SDK; no transaction-signing flow | User hosts a public HTTPS TON Connect manifest. Wallet bridge/session traffic is external. Public address is sent to TON Center only after lookup consent | Mocked tests only; manifest, wallet list, bridges, and real pairing need live testnet validation |
| TON Center API v3 | Reads account state, jetton wallets, and incoming transactions for TON mainnet/testnet | Address/network are disclosed after separate provider consent. No API key is configured by the app UI | URL paths and response handling are implemented; live endpoint behavior and service limits are not certified |
| WalletConnect / Reown | Optional EVM session; pairing asks for no signing methods | User supplies a Reown project ID, stored using OS-backed safe storage. Relay sees encrypted session traffic and app metadata | Mocked tests only; real Trust Wallet pairing and relay terms are not certified |
| EVM RPC | Native balance reads on registered chains; chain ID is verified before balance lookup | BNB Smart Chain endpoints have code defaults; Ethereum endpoints require a user-supplied HTTPS RPC. Address is disclosed only after per-network/provider lookup consent | RPC parsing, chain mismatch, retry, and consent paths have mocked tests; live endpoints are not validated |
| Ollama | Local advisory model requests to the configured Ollama service | Requires an installed local Ollama service and model; prompts are sent to that local endpoint | Unit tests use mocked HTTP; no installed-model acceptance test |
| MCP tools | Local read-only campaign/wallet analysis tools | Each tool requires explicit local consent; no eligibility or policy override | Unit tests cover dispatch and consent; no external MCP server is configured |
| Markets / Predictions | No live market feed or active prediction service | No provider, odds or outcomes are configured | Explicitly inactive/placeholders |

## Data and safety notes

- A blockchain address is public, but sending it to a chosen RPC/provider can reveal the user's network metadata and IP. Consent is per provider/network where supported.
- RPC endpoint URLs and explorer links should be checked by the app owner before use. The app checks an EVM endpoint's returned chain ID; that does not certify the provider's privacy, integrity, uptime or terms.
- TON provider requests have application-side timeouts, response-size limits, per-host throttling, and 429 backoff. These are client controls, not guarantees of a remote provider's service limits.
- The WalletConnect project ID is configuration, not a wallet secret. No seed phrase, private key, or wallet password belongs in PromoGuard.
- The user-hosted TON Connect manifest is a prerequisite, not a service PromoGuard hosts. A template is available at `docs/tonconnect-manifest.template.json`.
- No market-data provider, EVM indexer, broad social feed, or claim-submission API is configured.

Before enabling any live provider, confirm the endpoint, chain identity, privacy policy, terms, limits, and outage behavior in the target environment. Keep real wallet testing on testnets until the owner has explicitly approved the test plan.
