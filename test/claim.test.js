const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), os = require('os'), path = require('path');
const { runPipeline, STAGES } = require('../src/claims/prepare');
const { verifyFeeFree } = require('../src/claims/verify-fee-free');
const { matchTonTransfer, matchEvmBalanceChange, saveClaimAttempt, updateClaimAttempt, getPendingClaims, recordEvidence, monitorTon, monitorEvm } = require('../src/claims/monitor');
const { open } = require('../src/db');

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pg-')), 't.db');

const freeCampaign = {
  name: 'Test Airdrop', sourceUrl: 'https://ton.org/x', network: 'ton-testnet', tokenId: 'ton-testnet:native',
  rewardAmount: 0.05, endDate: '2099-01-01', distributionMethod: 'direct_distribution', distributionStatus: 'active',
  requiresDeposit: false, requiresGas: false, requiresPurchase: false, requiresStaking: false, requiresPaidMint: false,
  requiresSendingFunds: false, requiresUnlimitedApproval: false, requestsSeedPhrase: false, unclearSignature: false, unverifiedSite: false
};

test('pipeline: preflight never pretends a claim was submitted', () => {
  const r = runPipeline(freeCampaign, { fetchedTerms: 'terms text', userApproved: true, walletNetwork: 'ton-testnet', selectedNetwork: 'ton-testnet' });
  assert.equal(r.final, 'AWAITING_USER_APPROVAL');
  assert.equal(r.reason, 'transaction_submission_not_supported');
  assert.equal(r.pipeline.length, 7);
});

test('pipeline: gas-required campaign is REJECTED at fee check', () => {
  const r = runPipeline({ ...freeCampaign, requiresGas: true }, { fetchedTerms: 'terms', userApproved: true, walletNetwork: 'ton-testnet', selectedNetwork: 'ton-testnet' });
  assert.equal(r.final, 'REJECTED');
  assert.ok(r.pipeline.some(s => s.stage === 'fee_check' && !s.ok));
});

test('pipeline: missing eligibility field is UNVERIFIED, not rejected', () => {
  const c = { ...freeCampaign }; delete c.requiresGas;
  const r = runPipeline(c, { fetchedTerms: 'terms', userApproved: true, walletNetwork: 'ton-testnet', selectedNetwork: 'ton-testnet' });
  assert.equal(r.final, 'UNVERIFIED');
});

test('pipeline: every payment condition must be explicitly confirmed', () => {
  const c = { ...freeCampaign }; delete c.requiresStaking;
  const r = runPipeline(c, { fetchedTerms: 'terms', userApproved: true, walletNetwork: 'ton-testnet', selectedNetwork: 'ton-testnet' });
  assert.equal(r.final, 'UNVERIFIED');
  assert.deepEqual(r.unknown, ['requiresStaking']);
});

test('pipeline: network mismatch blocks at destination', () => {
  const r = runPipeline(freeCampaign, { fetchedTerms: 'terms', userApproved: true, walletNetwork: 'ton-mainnet', selectedNetwork: 'ton-testnet' });
  assert.equal(r.final, null);
  assert.ok(r.pipeline.some(s => s.stage === 'destination' && s.reason === 'network_mismatch'));
});

test('pipeline: expired campaign becomes EXPIRED at active stage', () => {
  const r = runPipeline({ ...freeCampaign, endDate: '2020-01-01' }, { fetchedTerms: 'terms', userApproved: true, walletNetwork: 'ton-testnet', selectedNetwork: 'ton-testnet' });
  assert.equal(r.final, 'EXPIRED');
});

test('pipeline: missing user approval reaches AWAITING_USER_APPROVAL', () => {
  const r = runPipeline(freeCampaign, { fetchedTerms: 'terms', walletNetwork: 'ton-testnet', selectedNetwork: 'ton-testnet' });
  assert.equal(r.final, 'AWAITING_USER_APPROVAL');
});
test('pipeline: a terms URL is not a fetched terms snapshot', () => {
  const r = runPipeline(freeCampaign, { fetchedTerms: freeCampaign.sourceUrl, walletNetwork: 'ton-testnet', selectedNetwork: 'ton-testnet' });
  assert.equal(r.final, 'UNVERIFIED');
  assert.equal(r.reason, 'official_terms_not_fetched');
  assert.equal(r.pipeline.length, 1);
});
test('claim active-stage date-only end date remains active through that day', () => {
  const { stageActive } = require('../src/claims/prepare');
  assert.equal(stageActive({ endDate: '2026-10-26' }, new Date('2026-10-26T15:32:00Z')).ok, true);
});

test('pipeline: undecodable claim data stops at explain', () => {
  const r = runPipeline({ ...freeCampaign, tokenId: undefined, rewardAmount: undefined },
    { fetchedTerms: 'terms', userApproved: true, walletNetwork: 'ton-testnet', selectedNetwork: 'ton-testnet' });
  assert.equal(r.final, null);
  assert.ok(r.pipeline.some(s => s.stage === 'explain' && s.reason === 'undecodable_claim_data'));
});

test('pipeline: terms changed sends back to UNDER_REVIEW', () => {
  const c = { ...freeCampaign, contentHash: 'oldhash', evidence: 'x' };
  const r = runPipeline(c, { fetchedTerms: 'new terms text', userApproved: true, walletNetwork: 'ton-testnet', selectedNetwork: 'ton-testnet' });
  assert.equal(r.final, 'UNDER_REVIEW');
});

test('pipeline: same terms content hash remains preflight-only', () => {
  const c = { ...freeCampaign, contentHash: runPipeline(freeCampaign, { fetchedTerms: 'terms text' }).pipeline[0].contentHash };
  const r = runPipeline(c, { fetchedTerms: 'terms text', userApproved: true, walletNetwork: 'ton-testnet', selectedNetwork: 'ton-testnet' });
  assert.equal(r.final, 'AWAITING_USER_APPROVAL');
  assert.equal(r.reason, 'transaction_submission_not_supported');
});

test('feeFree: verified free direct distribution allowed', () => {
  const r = verifyFeeFree(freeCampaign);
  assert.ok(r.allowed);
  assert.equal(r.reason, 'direct_distribution');
});

test('feeFree: gas required rejected', () => {
  const r = verifyFeeFree({ ...freeCampaign, requiresGas: true });
  assert.ok(!r.allowed);
  assert.ok(r.reason.includes('gas_not_free'));
});

test('feeFree: unlimited approval rejected outright', () => {
  const r = verifyFeeFree({ ...freeCampaign, requiresUnlimitedApproval: true });
  assert.ok(!r.allowed);
  assert.ok(r.reason.includes('unlimited_approval_rejected'));
});

test('feeFree: sponsored proof with documentation + zero-cost sim allowed', () => {
  const r = verifyFeeFree({ ...freeCampaign, distributionMethod: 'sponsored', sponsoredProof: { documented: true, zeroCostSimulated: true } });
  assert.ok(r.allowed);
  assert.equal(r.reason, 'sponsored_relayed');
});

test('feeFree: sponsored without proof rejected', () => {
  const r = verifyFeeFree({ ...freeCampaign, distributionMethod: 'sponsored', sponsoredProof: {} });
  assert.ok(!r.allowed);
});

test('feeFree: missing payment assertion is blocked as unconfirmed', () => {
  const campaign = { ...freeCampaign };
  delete campaign.requestsSeedPhrase;
  const r = verifyFeeFree(campaign);
  assert.equal(r.allowed, false);
  assert.ok(r.reason.includes('requestsSeedPhrase_unconfirmed'));
});

test('explain stage accepts database campaign column names', () => {
  const { stageExplain } = require('../src/claims/prepare');
  const r = stageExplain({ network: 'ton-testnet', token_id: 'ton-testnet:native', reward_amount: 2, end_date: '2099-01-01' });
  assert.equal(r.ok, true);
  assert.equal(r.contract, 'ton-testnet:native');
  assert.equal(r.amount, 2);
});

test('monitorTon: confirmed matching transfer yields REWARD_RECEIVED', async () => {
  const db = open(tmp());
  db.prepare("INSERT INTO reward_campaigns(name,status,last_checked) VALUES('x','ELIGIBLE_FOR_REVIEW','x')").run();
  const id = saveClaimAttempt(db, { campaignId: 1, network: 'ton-testnet', wallet: '0:' + 'ab'.repeat(32), state: 'CLAIM_SUBMITTED', expectedAmountNano: '100', expectedTxHash: 'h1' });
  const txs = [{ hash: 'h1', status: 'confirmed', amountNano: '100', time: Date.now() }];
  const prov = { incoming: async () => txs };
  const res = await monitorTon(db, [{ id, network: 'ton-testnet', wallet: '0:' + 'ab'.repeat(32), state: 'CLAIM_SUBMITTED', expectedAmountNano: '100', expectedTxHash: 'h1' }], prov, '0:' + 'ab'.repeat(32));
  assert.equal(res[0].state, 'REWARD_RECEIVED');
  assert.equal(res[0].txHash, 'h1');
  db.close();
});

test('monitorTon: unconfirmed transfer moves to REWARD_PENDING', async () => {
  const db = open(tmp());
  const res = await monitorTon(db, [{ id: 1, network: 'ton-testnet', wallet: '0:' + 'ab'.repeat(32), state: 'CLAIM_SUBMITTED', expectedAmountNano: '100', expectedTxHash: 'h1' }], { incoming: async () => [{ hash: 'h1', status: 'unknown', amountNano: '100', time: Date.now() }] }, '0:' + 'ab'.repeat(32));
  assert.equal(res[0].state, 'REWARD_PENDING');
  db.close();
});

test('monitorTon: amount match alone cannot be attributed as a campaign receipt', async () => {
  const db = open(tmp());
  const res = await monitorTon(db, [{ id: 1, network: 'ton-testnet', wallet: '0:' + 'ab'.repeat(32), state: 'CLAIM_SUBMITTED', expectedAmountNano: '100' }],
    { incoming: async () => [{ hash: 'h1', status: 'confirmed', amountNano: '100', time: Date.now() }] }, '0:' + 'ab'.repeat(32));
  assert.equal(res[0].state, 'REWARD_PENDING');
  db.close();
});

test('monitorEvm: balance rise matching expected yields REWARD_PENDING (unconfirmed)', async () => {
  const db = open(tmp());
  const res = await monitorEvm(db, [{ id: 1, network: 'eip155:97', wallet: '0x' + 'cd'.repeat(20), state: 'CLAIM_SUBMITTED', expectedAmountWei: '1000000000000000000', previousBalance: '0' }], { balance: async () => '1000000000000000000' }, '0x' + 'cd'.repeat(20));
  assert.equal(res[0].state, 'REWARD_PENDING');
  db.close();
});

test('monitorEvm: no balance change stays CLAIM_SUBMITTED', async () => {
  const db = open(tmp());
  const res = await monitorEvm(db, [{ id: 1, network: 'eip155:97', wallet: '0x' + 'cd'.repeat(20), state: 'CLAIM_SUBMITTED', expectedAmountWei: '1000000000000000000', previousBalance: '5' }], { balance: async () => '5' }, '0x' + 'cd'.repeat(20));
  assert.equal(res.length, 0);
  db.close();
});

test('claim attempt CRUD: save, update, list pending', () => {
  const db = open(tmp());
  db.prepare("INSERT INTO reward_campaigns(name,status,last_checked) VALUES('x','ELIGIBLE_FOR_REVIEW','x')").run();
  const id = saveClaimAttempt(db, { campaignId: 1, network: 'ton-testnet', wallet: '0:ab', state: 'AWAITING_USER_APPROVAL', feeCheckResult: 'direct_distribution' });
  assert.ok(id > 0);
  updateClaimAttempt(db, id, { state: 'CLAIM_SUBMITTED', txHash: 'h1' });
  const pending = getPendingClaims(db);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].state, 'CLAIM_SUBMITTED');
  assert.equal(pending[0].tx_hash, 'h1');
  db.close();
});

test('recordEvidence: stores content hash and url', () => {
  const db = open(tmp());
  db.prepare("INSERT INTO reward_campaigns(name,status,last_checked) VALUES('x','ELIGIBLE_FOR_REVIEW','x')").run();
  const id = recordEvidence(db, { campaignId: 1, url: 'https://ton.org/terms', contentHash: 'abc123', note: 'official terms' });
  assert.ok(id > 0);
  db.close();
});

test('STAGES lists all seven pipeline stages', () => {
  assert.equal(STAGES.length, 7);
  assert.equal(STAGES[0], 'recheck');
  assert.equal(STAGES[6], 'approve_monitor');
});
