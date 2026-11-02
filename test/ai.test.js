const test = require('node:test'), assert = require('node:assert');
const { ollamaChat, ollamaListModels, fenceInput, fenceOutput, DEFAULT_MODEL, MAX_INPUT_CHARS } = require('../src/ai/ollama');
const { SYSTEM, PROMPT_VERSION, summarizeRules, extractAmountsDeadlines, compareTermsWithPolicy, explainRiskIndicators, writeEvidenceSummary } = require('../src/ai/prompts');
const { createMcpTools } = require('../src/ai/mcp-tools');

test('fenceInput strips markup and caps length', () => {
  const out = fenceInput('<b>hello</b> <script>alert(1)</script> ```code```');
  assert.ok(!out.includes('<b>'));
  assert.ok(!out.includes('<script>'));
  assert.ok(!out.includes('```'));
  const long = 'x'.repeat(10000);
  assert.equal(fenceInput(long).length, MAX_INPUT_CHARS);
});

test('fenceOutput strips markup', () => {
  const out = fenceOutput('<div>hi</div>');
  assert.ok(!out.includes('<div>'));
});

test('ollamaChat posts and returns content', async () => {
  let sentBody = null;
  const res = await ollamaChat({
    messages: [{ role: 'user', content: 'hi' }],
    fetchImpl: async (u, o) => { sentBody = o.body; return new Response(JSON.stringify({ message: { content: 'hello there' }, done: true })); }
  });
  assert.equal(res.content, 'hello there');
  assert.equal(res.model, DEFAULT_MODEL);
  assert.ok(res.done);
  const parsed = JSON.parse(sentBody);
  assert.equal(parsed.model, DEFAULT_MODEL);
  assert.equal(parsed.stream, false);
});

test('ollamaChat throws on non-ok', async () => {
  await assert.rejects(ollamaChat({ messages: [], fetchImpl: async () => new Response('', { status: 500 }) }), /ollama http/);
});

test('ollamaListModels returns model list', async () => {
  const list = await ollamaListModels({
    fetchImpl: async () => new Response(JSON.stringify({ models: [{ name: 'phi3:mini', size: 2000, modified_at: 'x' }] }))
  });
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'phi3:mini');
});

test('prompts: SYSTEM mentions advisory-only and zero-payment', () => {
  assert.ok(SYSTEM.includes('ADVISORY ONLY'));
  assert.ok(SYSTEM.includes('zero-payment'));
});

test('prompts: PROMPT_VERSION is v1', () => {
  assert.equal(PROMPT_VERSION, 'v1');
});

test('prompts: summarizeRules includes system and user', () => {
  const m = summarizeRules('some text');
  assert.equal(m.length, 2);
  assert.equal(m[0].role, 'system');
  assert.equal(m[1].role, 'user');
  assert.ok(m[1].content.includes('<<BEGIN UNTRUSTED INPUT>>'));
});

test('prompts: extractAmountsDeadlines structure', () => {
  const m = extractAmountsDeadlines('text');
  assert.equal(m.length, 2);
  assert.ok(m[1].content.includes('not stated'));
});

test('prompts: compareTermsWithPolicy includes flags', () => {
  const m = compareTermsWithPolicy('text', ['requiresGas', 'requiresDeposit']);
  assert.ok(m[1].content.includes('requiresGas'));
  assert.ok(m[1].content.includes('requiresDeposit'));
});

test('prompts: explainRiskIndicators includes indicators', () => {
  const m = explainRiskIndicators('text', ['ind1', 'ind2']);
  assert.ok(m[1].content.includes('ind1'));
});

test('prompts: writeEvidenceSummary includes campaign name', () => {
  const m = writeEvidenceSummary({}, 'My Campaign');
  assert.ok(m[1].content.includes('My Campaign'));
});

test('mcp-tools: listTools returns all tools with granted state', () => {
  const mcp = createMcpTools({ db: {}, getWalletContext: () => ({}), hasConsent: () => false });
  const tools = mcp.listTools();
  assert.equal(tools.length, 9);
  assert.ok(tools.every(t => t.granted === false));
  const names = tools.map(t => t.name);
  assert.ok(names.includes('get_connected_wallets'));
  assert.ok(names.includes('analyze_reward_campaign'));
  assert.ok(names.includes('check_campaign_eligibility'));
});

test('mcp-tools: grant and revoke consent', () => {
  const grants = {};
  const mcp = createMcpTools({
    db: {},
    getWalletContext: () => ({}),
    hasConsent: (t) => !!grants[t],
    grantConsent: (t) => { grants[t] = true; },
    revokeConsent: (t) => { delete grants[t]; }
  });
  assert.equal(mcp.listTools().find(t => t.name === 'get_wallet_balance').granted, false);
  mcp.grant('get_wallet_balance');
  assert.equal(mcp.listTools().find(t => t.name === 'get_wallet_balance').granted, true);
  mcp.revoke('get_wallet_balance');
  assert.equal(mcp.listTools().find(t => t.name === 'get_wallet_balance').granted, false);
});

test('mcp-tools: invoke requires consent and resolves the public snake-case tool name', async () => {
  const grants = new Set();
  const mcp = createMcpTools({
    db: {},
    getWalletContext: () => ({ selected: { network: 'ton-testnet' }, snapshot: { native_balance_nano: '20', retrieved: 'now', provider: 'test' } }),
    hasConsent: tool => grants.has(tool),
    grantConsent: tool => grants.add(tool),
    revokeConsent: tool => grants.delete(tool)
  });
  await assert.rejects(mcp.invoke('get_wallet_balance'), /consent required/);
  assert.equal(grants.size, 0);
  mcp.grant('get_wallet_balance');
  const result = await mcp.invoke('get_wallet_balance');
  assert.equal(result.nativeBalance, '20');
  await assert.rejects(mcp.invoke('grant', { tool: 'get_wallet_balance' }), /unknown or disallowed/);
});

test('mcp-tools: getConnectedWallets returns provider+network only', async () => {
  const mcp = createMcpTools({
    db: {},
    getWalletContext: () => ({ wallets: [{ provider: 'ton', network: 'ton-testnet', address: '0:abc' }] }),
    hasConsent: () => true
  });
  const r = await mcp.getConnectedWallets();
  assert.equal(r.wallets.length, 1);
  assert.equal(r.wallets[0].provider, 'ton');
  assert.equal(r.wallets[0].network, 'ton-testnet');
});

test('mcp-tools: analyzeRewardCampaign returns summary', async () => {
  const db = {
    prepare: (sql) => ({
      get: () => ({ id: 1, name: 'Test', status: 'ELIGIBLE_FOR_REVIEW', network: 'ton-testnet', reward_amount: 0.05, token_id: 'native', end_date: '2099-01-01', reasons: '[]', evidence: null })
    })
  };
  const mcp = createMcpTools({ db, getWalletContext: () => ({}), hasConsent: () => true });
  const r = await mcp.analyzeRewardCampaign({ campaignId: 1 });
  assert.equal(r.id, 1);
  assert.equal(r.status, 'ELIGIBLE_FOR_REVIEW');
  assert.ok(r.note.includes('advisory'));
});

test('mcp-tools: checkCampaignEligibility returns policy result', async () => {
  const db = {
    prepare: (sql) => ({
      get: () => ({ id: 2, name: 'X', status: 'REJECTED', reasons: '["requiresGas"]' })
    })
  };
  const mcp = createMcpTools({ db, getWalletContext: () => ({}), hasConsent: () => true });
  const r = await mcp.checkCampaignEligibility({ campaignId: 2 });
  assert.equal(r.status, 'REJECTED');
  assert.deepEqual(r.reasons, ['requiresGas']);
});

test('mcp-tools: explainTransactionRequest warns when undecodable', async () => {
  const mcp = createMcpTools({ db: {}, getWalletContext: () => ({}), hasConsent: () => true });
  const r = await mcp.explainTransactionRequest({ foo: 'bar' });
  assert.equal(r.decoded, null);
  assert.ok(r.warning.includes('cannot be decoded'));
});

test('mcp-tools: invalid campaign id rejects', async () => {
  const db = { prepare: () => ({ get: () => null }) };
  const mcp = createMcpTools({ db, getWalletContext: () => ({}), hasConsent: () => true });
  await assert.rejects(mcp.analyzeRewardCampaign({ campaignId: -1 }), /invalid/);
  await assert.rejects(mcp.analyzeRewardCampaign({ campaignId: 'x' }), /invalid/);
});

test('mcp-tools: unknown tool name rejected', () => {
  const mcp = createMcpTools({ db: {}, getWalletContext: () => ({}), hasConsent: () => true });
  assert.throws(() => mcp.grant('nonexistent_tool'), /unknown/);
});
