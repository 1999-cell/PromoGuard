'use strict';
// Phase 5: Receipt monitoring.
// TON: poll TON Center for incoming transfers; match amount and token to the campaign; require confirmed status.
// EVM: needs an indexer API with a key. Until then rely on balance change plus official campaign confirmation, labeled unconfirmed.
// REWARD_RECEIVED requires chain evidence: hash, network, time. Never count pending as received.

const now = () => new Date().toISOString();

function matchTonTransfer(campaign, tx) {
  if (tx.status !== 'confirmed') return null;
  if (!campaign.expectedTxHash || tx.hash !== campaign.expectedTxHash) return null;
  if (tx.amountNano !== String(campaign.expectedAmountNano || '')) return null;
  return { matched: true, txHash: tx.hash, network: campaign.network, time: tx.time, amountNano: tx.amountNano };
}

function matchEvmBalanceChange(campaign, prevBalance, currentBalance) {
  const prev = BigInt(prevBalance || '0');
  const curr = BigInt(currentBalance || '0');
  if (curr <= prev) return null;
  const increase = (curr - prev).toString();
  const expected = BigInt(campaign.expectedAmountWei || '0');
  if (expected > 0n && curr - prev !== expected) return null;
  return { matched: true, increase, network: campaign.network, time: now(), confirmed: false };
}

async function monitorTon(db, claimAttempts, tonProvider, walletAddress) {
  const results = [];
  for (const attempt of claimAttempts) {
    if (attempt.state !== 'CLAIM_SUBMITTED' && attempt.state !== 'REWARD_PENDING') continue;
    try {
      const txs = tonProvider.incoming ? await tonProvider.incoming(walletAddress) : [];
      const confirmed = [];
      for (const tx of txs) {
        const m = matchTonTransfer({ ...attempt, expectedAmountNano: attempt.expectedAmountNano }, tx);
        if (m) confirmed.push(m);
      }
      if (confirmed.length > 0) {
        const best = confirmed[0];
        db.prepare("UPDATE claim_attempts SET state='REWARD_RECEIVED', confirmed_at=?, tx_hash=? WHERE id=?").run(now(), best.txHash, attempt.id);
        results.push({ id: attempt.id, state: 'REWARD_RECEIVED', txHash: best.txHash, network: best.network });
      } else if (attempt.state === 'CLAIM_SUBMITTED') {
        db.prepare("UPDATE claim_attempts SET state='REWARD_PENDING' WHERE id=?").run(attempt.id);
        results.push({ id: attempt.id, state: 'REWARD_PENDING', reason: 'awaiting_confirmation' });
      }
    } catch (e) {
      results.push({ id: attempt.id, state: attempt.state, error: e.message });
    }
  }
  return results;
}

async function monitorEvm(db, claimAttempts, evmProvider, walletAddress) {
  const results = [];
  for (const attempt of claimAttempts) {
    if (attempt.state !== 'CLAIM_SUBMITTED' && attempt.state !== 'REWARD_PENDING') continue;
    try {
      const balance = evmProvider.balance ? await evmProvider.balance(walletAddress) : null;
      if (!balance) continue;
      const m = matchEvmBalanceChange({ ...attempt, expectedAmountWei: attempt.expectedAmountWei, previousBalance: attempt.previousBalance }, attempt.previousBalance || '0', balance);
      if (m) {
        if (m.confirmed) {
          db.prepare("UPDATE claim_attempts SET state='REWARD_RECEIVED', confirmed_at=?, tx_hash=? WHERE id=?").run(now(), 'balance_change:' + m.network, attempt.id);
          results.push({ id: attempt.id, state: 'REWARD_RECEIVED', txHash: m.txHash, network: m.network, note: 'balance change, unconfirmed without indexer' });
        } else {
          db.prepare("UPDATE claim_attempts SET state='REWARD_PENDING', previous_balance=? WHERE id=?").run(balance, attempt.id);
          results.push({ id: attempt.id, state: 'REWARD_PENDING', reason: 'balance_rise_unconfirmed', network: m.network });
        }
      }
    } catch (e) {
      results.push({ id: attempt.id, state: attempt.state, error: e.message });
    }
  }
  return results;
}

function saveClaimAttempt(db, { campaignId, network, wallet, state, feeCheckResult, feeCheckEvidence, expectedAmountNano, expectedAmountWei, previousBalance, expectedTxHash }) {
  return Number(db.prepare(`INSERT INTO claim_attempts(campaign_id,network,wallet,state,fee_check_result,fee_check_evidence,approved_at,expected_amount_nano,expected_amount_wei,previous_balance,expected_tx_hash)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(campaignId, network, wallet, state, feeCheckResult || null, feeCheckEvidence || null, null, expectedAmountNano || null, expectedAmountWei || null, previousBalance || null, expectedTxHash || null).lastInsertRowid);
}

function updateClaimAttempt(db, id, { state, txHash, confirmedAt, failureReason }) {
  db.prepare(`UPDATE claim_attempts SET state=?, tx_hash=COALESCE(?,tx_hash), confirmed_at=COALESCE(?,confirmed_at), failure_reason=COALESCE(?,failure_reason) WHERE id=?`)
    .run(state, txHash || null, confirmedAt || null, failureReason || null, id);
}

function getPendingClaims(db) {
  return db.prepare(`SELECT ca.*, rc.name, rc.token_id, rc.reward_amount, rc.network as campaign_network
    FROM claim_attempts ca JOIN reward_campaigns rc ON rc.id=ca.campaign_id
    WHERE ca.state IN ('CLAIM_SUBMITTED','REWARD_PENDING','AWAITING_USER_APPROVAL')`).all();
}

function recordEvidence(db, { campaignId, url, contentHash, note }) {
  return Number(db.prepare(`INSERT INTO campaign_evidence(campaign_id,url,fetched_at,content_hash,note) VALUES(?,?,?,?,?)`)
    .run(campaignId, url, now(), contentHash, note || null).lastInsertRowid);
}

module.exports = { matchTonTransfer, matchEvmBalanceChange, monitorTon, monitorEvm, saveClaimAttempt, updateClaimAttempt, getPendingClaims, recordEvidence };
