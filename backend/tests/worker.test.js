import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker, { handleRequest, cleanup, shanghaiDate } from '../src/worker.js';

const origin = 'https://wushizupu-commits.github.io';
const token = 'owner_read_key_'.padEnd(48, 'a');
const schema = readFileSync(new URL('../migrations/0001_analytics.sql', import.meta.url), 'utf8');
function environment() {
  const sql = new DatabaseSync(':memory:'); sql.exec(schema);
  const wrap = (query, args = []) => ({
    bind: (...values) => wrap(query, values),
    async run() { return { success: true, meta: sql.prepare(query).run(...args) }; },
    async all() { return { success: true, results: sql.prepare(query).all(...args) }; }
  });
  return { sql, DB: { prepare: wrap, batch: statements => Promise.all(statements.map(statement => statement.all())) }, READ_TOKEN: token, IP_HASH_SECRET: 'random-ip-hmac-secret'.padEnd(48, 'b') };
}
function request(path, opts = {}) {
  return new Request('https://test.example.workers.dev' + path, {
    method: opts.kind ? 'POST' : opts.method || 'GET',
    headers: { Origin: origin, 'CF-Connecting-IP': opts.ip || '203.0.113.5',
      ...(opts.kind ? { 'Content-Type': 'application/json' } : { Authorization: 'Bearer ' + token }), ...opts.headers },
    ...(opts.kind ? { body: JSON.stringify({ eventId: opts.id || crypto.randomUUID(), kind: opts.kind, page: opts.page || 'index.html', itemId: opts.itemId || '', ...opts.fields }) } : {})
  });
}
const report = async (env, now) => {
  const response = await handleRequest(request('/stats'), env, new Date(now));
  assert.equal(response.status, 200); return response.json();
};

test('Beijing day boundary and same IP deduplicate across articles, pages and days', async () => {
  const env = environment(), before = new Date('2026-10-04T15:59:59.000Z'), after = new Date('2026-10-04T16:00:00.000Z');
  assert.equal(shanghaiDate(before), '2026-10-04'); assert.equal(shanghaiDate(after), '2026-10-05');
  const id = crypto.randomUUID();
  for (const event of [
    { kind: 'page', id }, { kind: 'page', id },
    { kind: 'page', page: 'biographies.html' },
    { kind: 'article', page: 'biographies.html', itemId: 'bio-1' },
    { kind: 'search', itemId: 'G01-001' }
  ]) assert.equal((await handleRequest(request('/collect', event), env, before)).status, 204);
  const first = await report(env, before);
  assert.deepEqual([first.periods.today.pv, first.periods.today.uv, first.periods.today.articleOpens, first.periods.today.searches], [2, 1, 1, 1]);
  assert.equal(first.periods.all.uv, 1);
  const emptyDay = await report(env, after);
  assert.equal(emptyDay.periods.today.pv, 0); assert.equal(emptyDay.periods.all.pv, 2);
  for (const ip of ['203.0.113.5', '203.0.113.6']) await handleRequest(request('/collect', { kind: 'page', ip }), env, after);
  const next = await report(env, after);
  assert.deepEqual([next.periods.today.pv, next.periods.today.uv, next.periods.all.pv, next.periods.all.uv], [2, 2, 4, 2]);
  assert.equal(next.recentSearches[0].name, '洵公');
  assert.equal(next.recentSearches[0].at, before.toISOString());
  assert.ok(!JSON.stringify(next).includes('203.0.113'));
  assert.equal(env.sql.prepare('SELECT count(*) AS n FROM unique_visitors WHERE visitor LIKE ?').get('%203.0.113%').n, 0);
  env.sql.close();
});

test('cleanup removes details but preserves all totals, date totals and replay protection', async () => {
  const env = environment(), old = new Date('2026-10-01T00:00:00.000Z'), later = new Date('2026-11-02T00:00:00.000Z'), id = crypto.randomUUID();
  await handleRequest(request('/collect', { kind: 'search', itemId: 'G01-001', id }), env, old);
  await handleRequest(request('/collect', { kind: 'page' }), env, old);
  await cleanup(env, later);
  assert.equal(env.sql.prepare('SELECT COUNT(*) n FROM events').get().n, 0);
  await handleRequest(request('/collect', { kind: 'search', itemId: 'G01-001', id }), env, later);
  const data = await report(env, later);
  assert.equal(data.periods.all.pv, 1); assert.equal(data.periods.all.uv, 1); assert.equal(data.periods.all.searches, 1);
  assert.equal(data.periods.today.searches, 0); assert.equal(data.recentSearches.length, 0);
  env.sql.close();
});

test('read authorization, restricted origin, CORS and invalid inputs do not write data', async () => {
  const env = environment();
  assert.equal((await handleRequest(request('/stats', { headers: { Authorization: 'Bearer wrong' } }), env)).status, 401);
  assert.equal((await handleRequest(request('/stats', { headers: { Origin: 'https://evil.example' } }), env)).status, 403);
  assert.equal((await handleRequest(request('/stats?key=secret'), env)).status, 400);
  const preflight = await handleRequest(request('/collect', { method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } }), env);
  assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), origin);
  for (const event of [
    { kind: 'page', fields: { rawSearch: 'private arbitrary input' } },
    { kind: 'page', itemId: 'bio-1' },
    { kind: 'search', itemId: 'not-a-person' },
    { kind: 'search', itemId: 'G01-001', page: 'home.html' },
    { kind: 'article', itemId: 'bio-1', page: 'revisions.html' },
    { kind: 'other' }, { kind: 'page', page: 'outside.html' },
    { kind: 'page', id: 'bad-id' }
  ]) assert.equal((await handleRequest(request('/collect', event), env)).status, 400);
  const huge = request('/collect', { kind: 'page', fields: { text: 'x'.repeat(1024) } });
  assert.equal((await handleRequest(huge, env)).status, 413);
  assert.equal(env.sql.prepare('SELECT COUNT(*) n FROM events').get().n, 0);
  const first = await handleRequest(request('/stats'), env);
  assert.equal(first.headers.get('Cache-Control'), 'no-store');
  assert.equal((await first.json()).startedAt, null);
  env.sql.close();
});

test('production fetch signature handles Workers execution context as third argument', async () => {
  const env = environment();
  const response = await worker.fetch(request('/collect', { kind: 'page' }), env, { waitUntil() {} });
  assert.equal(response.status, 204);
  const stats = await worker.fetch(request('/stats'), env, { waitUntil() {} });
  assert.equal(stats.status, 200);
  env.sql.close();
});

test('all catalogs are bounded, exact public IDs; collecting every article never increases PV', async () => {
  const env = environment(), catalog = JSON.parse(readFileSync(new URL('../src/catalog.json', import.meta.url)));
  for (const article of catalog.articles) {
    assert.equal((await handleRequest(request('/collect', { kind: 'article', page: article.page, itemId: article.id }), env)).status, 204);
  }
  const data = await report(env, new Date());
  assert.equal(data.periods.all.articleOpens, 22); assert.equal(data.periods.all.pv, 0); assert.equal(data.periods.all.uv, 0);
  assert.equal(data.periods.all.articles.length, 22); assert.equal(data.periods.all.pages.length, 7);
  for (let i = 0; i < 25; i++) await handleRequest(request('/collect', { kind: 'search', itemId: catalog.people[i].id }), env);
  const recent = await report(env, new Date());
  assert.equal(recent.recentSearches.length, 20); assert.equal(recent.periods.all.topSearches.length, 20);
  env.sql.close();
});
