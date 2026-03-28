/**
 * Integration test script for Agent #1 (TradeLogger) and Agent #2 (MarketAnalyzer)
 * Usage: npx tsx scripts/test-agents.ts
 */

const BASE_URL = 'http://localhost:3000';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

function log(label: string, msg: string) {
  console.log(`${CYAN}[${label}]${RESET} ${msg}`);
}
function ok(msg: string) {
  console.log(`${GREEN}✅ ${msg}${RESET}`);
}
function fail(msg: string) {
  console.log(`${RED}❌ ${msg}${RESET}`);
}
function section(title: string) {
  console.log(`\n${BOLD}${YELLOW}━━━ ${title} ━━━${RESET}`);
}

async function request(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  return { status: res.status, data };
}

// ─── Test 0: Health Check ────────────────────────────────────────────────────
async function testHealth() {
  section('Health Check');
  const { status, data } = await request('GET', '/health');
  if (status === 200 && data.status === 'ok') {
    ok(`Server is healthy (${data.timestamp})`);
    return true;
  }
  fail(`Server not responding — status: ${status}`);
  return false;
}

// ─── Test 1: Agent #1 — Log Trade ────────────────────────────────────────────
async function testLogTrade(): Promise<string | null> {
  section('Agent #1 — POST /api/trades (Log New Trade)');

  const body = {
    symbol: 'EURUSD',
    direction: 'BUY',
    timeframe: '1h',
    entryPrice: 1.0852,
    tpPrice: 1.0920,
    slPrice: 1.0800,
    entryTime: new Date().toISOString(),
    userReason: 'EMA14 crossed above EMA60 with RSI recovering from oversold zone (RSI~35). MACD bullish crossover on 1h.',
    indicatorsUsed: ['EMA14', 'EMA60', 'RSI14', 'MACD'],
    userAnalysis: 'Strong demand zone at 1.0840. DXY showing weakness. EUR fundamentals stable.',
  };

  log('REQUEST', `POST /api/trades — ${body.symbol} ${body.direction} @ ${body.entryPrice}`);
  log('BODY', JSON.stringify(body, null, 2));

  const { status, data } = await request('POST', '/api/trades', body);

  log('RESPONSE', `HTTP ${status}`);
  console.log(JSON.stringify(data, null, 2));

  if (status === 201 && data.success) {
    ok(`Trade logged — ID: ${data.tradeId}`);
    if (data.aiComment) {
      log('AI COMMENT', data.aiComment);
    }
    return data.tradeId;
  }

  fail(`Log trade failed — ${data.error ?? data.message ?? JSON.stringify(data)}`);
  return null;
}

// ─── Test 2: Agent #1 — Close Trade ─────────────────────────────────────────
async function testCloseTrade(tradeId: string) {
  section(`Agent #1 — PUT /api/trades/${tradeId}/result (Close Trade)`);

  const body = {
    result: 'WIN',
    exitPrice: 1.0918,
    exitTime: new Date().toISOString(),
    pips: 66,
    profitUsd: 66.0,
    userExitReason: 'TP nearly hit, price stalled at resistance 1.0920. Closed manually.',
    userLesson: 'Entry timing was good. EMA14/60 cross confirmed trend direction effectively.',
  };

  log('REQUEST', `PUT /api/trades/${tradeId}/result`);
  log('BODY', JSON.stringify(body, null, 2));

  const { status, data } = await request('PUT', `/api/trades/${tradeId}/result`, body);

  log('RESPONSE', `HTTP ${status}`);
  console.log(JSON.stringify(data, null, 2));

  if (status === 200 && data.success) {
    ok(`Trade closed — result: WIN, pips: ${body.pips}, profit: $${body.profitUsd}`);
    if (data.lesson) {
      log('AI LESSON', data.lesson);
    }
    return true;
  }

  fail(`Close trade failed — ${data.error ?? data.message ?? JSON.stringify(data)}`);
  return false;
}

// ─── Test 3: Agent #1 — Validation Error ─────────────────────────────────────
async function testValidationError() {
  section('Agent #1 — Validation Error Test (expect 400)');

  const badBody = {
    symbol: 'EU',       // too short
    direction: 'LONG',  // invalid (must be BUY/SELL)
    entryPrice: -100,   // negative
  };

  log('REQUEST', 'POST /api/trades with invalid body');

  const { status, data } = await request('POST', '/api/trades', badBody);

  log('RESPONSE', `HTTP ${status}`);
  console.log(JSON.stringify(data, null, 2));

  if (status === 400 && data.error === 'Invalid input') {
    ok('Validation correctly returned 400 with error details');
    return true;
  }

  fail(`Expected 400 but got ${status}`);
  return false;
}

// ─── Test 4: Agent #2 — Analyze Market ───────────────────────────────────────
async function testAnalyze() {
  section('Agent #2 — POST /api/analyze (Market Analysis)');

  const body = {
    symbol: 'EURUSD',
    timeframe: '1h',
    riskLevel: 'medium',
  };

  log('REQUEST', `POST /api/analyze — ${body.symbol} ${body.timeframe} risk:${body.riskLevel}`);

  const { status, data } = await request('POST', '/api/analyze', body);

  log('RESPONSE', `HTTP ${status}`);
  console.log(JSON.stringify(data, null, 2));

  if (status === 200 && data.success) {
    ok(`Analysis complete — confidence: ${data.confidence ?? 'N/A'}%`);
    if (data.recommendation) log('RECOMMENDATION', data.recommendation);
    if (data.similarTradesCount !== undefined) {
      log('SIMILAR TRADES', `Found ${data.similarTradesCount} similar historical trades`);
    }
    return true;
  }

  fail(`Analysis failed — ${data.error ?? data.message ?? JSON.stringify(data)}`);
  return false;
}

// ─── Test 5: Agent #2 — Multiple Symbols ─────────────────────────────────────
async function testAnalyzeMultiple() {
  section('Agent #2 — Multiple Symbols Test');

  const pairs = [
    { symbol: 'GBPUSD', timeframe: '4h', riskLevel: 'low' },
    { symbol: 'USDJPY', timeframe: '15m', riskLevel: 'high' },
  ] as const;

  let passed = 0;
  for (const body of pairs) {
    log('REQUEST', `${body.symbol} ${body.timeframe}`);
    const { status, data } = await request('POST', '/api/analyze', body);
    if (status === 200 && data.success) {
      ok(`${body.symbol} — confidence: ${data.confidence ?? 'N/A'}%`);
      passed++;
    } else {
      fail(`${body.symbol} — ${data.error ?? data.message}`);
    }
    // ป้องกัน rate limit
    await new Promise(r => setTimeout(r, 1500));
  }

  return passed === pairs.length;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${BOLD}${CYAN}╔══════════════════════════════════════════╗`);
  console.log(`║    Forex AI Agent — Integration Tests    ║`);
  console.log(`╚══════════════════════════════════════════╝${RESET}\n`);

  const results: Record<string, boolean> = {};

  // Health check ก่อนเสมอ
  results['Health'] = await testHealth();
  if (!results['Health']) {
    fail('Server is not running. Please start with: npm run dev');
    process.exit(1);
  }

  // Agent #1 tests
  const tradeId = await testLogTrade();
  results['Agent#1 Log Trade'] = tradeId !== null;

  if (tradeId) {
    // รอ 1 วินาทีหลัง log เพื่อให้ AI comment เสร็จก่อน close
    await new Promise(r => setTimeout(r, 1000));
    results['Agent#1 Close Trade'] = await testCloseTrade(tradeId);
  }

  results['Agent#1 Validation'] = await testValidationError();

  // Agent #2 tests
  results['Agent#2 Analyze'] = await testAnalyze();
  results['Agent#2 Multi-Symbol'] = await testAnalyzeMultiple();

  // ─── Summary ────────────────────────────────────────────────────────────────
  section('Test Summary');
  let passed = 0;
  let total = 0;
  for (const [name, result] of Object.entries(results)) {
    total++;
    if (result) {
      passed++;
      ok(name);
    } else {
      fail(name);
    }
  }

  console.log(`\n${BOLD}Result: ${passed === total ? GREEN : RED}${passed}/${total} passed${RESET}\n`);
  process.exit(passed === total ? 0 : 1);
}

main().catch(err => {
  console.error(`${RED}Unexpected error:${RESET}`, err);
  process.exit(1);
});
