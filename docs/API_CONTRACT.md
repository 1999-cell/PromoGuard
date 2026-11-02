# PromoGuard read-only campaign contract

**Contract:** `promoguard.web-readonly`  
**Version:** `1`  
**Current transport:** user-selected offline JSON export from the desktop app

This contract is the client-neutral seam for a future shared API. It is not a running HTTP service, hosted backend, authentication system, or sync mechanism. The desktop currently emits it only after the user chooses **Export read-only web bundle** and selects a destination.

## Bundle shape

```json
{
  "format": "promoguard.web-readonly",
  "contractVersion": 1,
  "exportedAt": "ISO-8601 timestamp",
  "readOnly": true,
  "resources": {
    "campaigns": [],
    "evidence": [],
    "statusHistory": []
  }
}
```

Resources use camelCase field names independent of SQLite's column names.

### Campaign

`id`, `name`, `publisher`, `sourceUrl`, `network`, `tokenId`, `rewardAmount`, `endDate`, `status`, `reasons`, `evidenceUrl`, `lastChecked`, `archived`, `reviewNote`, plus each policy assertion (`requiresDeposit`, `requiresGas`, `requiresPurchase`, `requiresStaking`, `requiresPaidMint`, `requiresSendingFunds`, `requiresUnlimitedApproval`, `requestsSeedPhrase`, `unclearSignature`, `unverifiedSite`). Unknown assertions are `null`; they must not be interpreted as false.

### Evidence

`id`, `campaignId`, `url`, `fetchedAt`, `contentHash`, `note`, `content`. Evidence text may be user-provided or fetched, but the bundle does not claim that it is authentic or independently verified.

### Status history

`id`, `campaignId`, `fromStatus`, `toStatus`, `reason`, `occurredAt`.

## Future HTTP resource paths

These are reserved design targets, not implemented endpoints:

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/campaigns` | Read campaign collection |
| GET | `/api/v1/campaigns/{campaignId}` | Read one campaign |
| GET | `/api/v1/campaigns/{campaignId}/evidence` | Read evidence revisions |
| GET | `/api/v1/campaigns/{campaignId}/status-history` | Read status history |

No mutation routes are defined. A future server must not reuse the offline-export trust model: before any hosted or local network service, separately design and review authentication, authorization, tenant isolation, consent, data retention/deletion, rate limiting, auditability, transport protections, and incident response. The bundle intentionally excludes settings, wallet records, provider credentials, and schedule consent; it does include terms text, so exported files should be handled as private user data.
