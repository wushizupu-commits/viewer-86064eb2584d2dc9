const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const code = fs.readFileSync(path.join(root, 'assets/dashboard.js'), 'utf8');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'assets/report-catalog.json')));
const endpoint = 'https://analytics.example.workers.dev';
const token = 'owner-secret-'.padEnd(48, 'a');
class Element {
  constructor() { this.children = []; this.textContent = ''; this.events = {}; this.attributes = {}; this.disabled = false; this.hidden = false; }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = items; }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(key, fn) { this.events[key] = fn; }
  focus() { this.focused = true; }
}
function sample() {
  const range = pv => ({ pv, uv: 2, searches: 1, articleOpens: 3, videoClicks: pv === 5 ? 2 : 8,
    pages: catalog.pages.map(row => ({ ...row, pv: row.id === 'home.html' ? pv : 0 })),
    articles: catalog.articles.map(row => ({ ...row, opens: row.id === 'bio-1' ? 3 : 0 })),
    topSearches: [{ id: 'G01-001', name: '洵公', count: 1, lastAt: '2026-10-04T17:00:00.000Z' }] });
  return { timezone: 'Asia/Shanghai', today: '2026-10-05', startedAt: '2026-10-04T17:00:00.000Z', updatedAt: '2026-10-04T18:00:00.000Z',
    periods: { today: range(5), all: range(12) }, recentSearches: [{ id: 'G01-001', name: '洵公', page: 'index.html', at: '2026-10-04T17:00:00.000Z' }] };
}
function environment(options = {}) {
  const elements = new Map(), calls = [], storage = new Map(); let removed = '';
  const get = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  const context = {
    URL, URLSearchParams, AbortController, Date, setTimeout, clearTimeout, setInterval() {},
    location: new URL('https://wushizupu-commits.github.io/viewer-86064eb2584d2dc9/' + (options.key ? '#key=' + options.key : '')),
    history: { replaceState(_a, _b, url) { removed = url; } },
    sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    document: { currentScript: { src: 'https://wushizupu-commits.github.io/viewer-86064eb2584d2dc9/assets/dashboard.js' },
      getElementById: get, createElement: () => new Element(), querySelector: () => get('legacy-details') },
    fetch: async (url, init) => {
      calls.push({ url, ...init });
      if (url.includes('analytics-config.json')) return { ok: true, json: async () => ({ endpoint: options.endpoint || '' }) };
      if (url.includes('report-catalog.json')) return { ok: true, json: async () => catalog };
      if (url.endsWith('/stats')) return { ok: !options.status, status: options.status || 200, json: async () => options.report || sample() };
      return { ok: true, json: async () => ({ success: true, data: { site_pv: 15, site_uv: 3, page_pv: 2, page_uv: 1 } }) };
    }
  };
  vm.runInNewContext(code, context);
  return { elements, get, calls, storage, removed: () => removed };
}
async function settle() { await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)); }

test('disabled backend keeps actual legacy cumulative data and marks today/details unavailable, never zero', async () => {
  const e = environment(); await settle();
  assert.equal(e.get('analytics-site-pv').textContent, '待开启');
  assert.equal(e.calls.length, 9); assert.ok(e.calls.every(call => call.method === 'GET'));
  e.get('period-all').events.click();
  assert.equal(e.get('analytics-site-pv').textContent, '15'); assert.equal(e.get('analytics-site-uv').textContent, '3');
  assert.equal(e.get('analytics-searches').textContent, '待开启');
  assert.equal(e.get('analytics-pages').children.length, 7);
  assert.equal(e.get('legacy-details').open, true);
  assert.ok(e.get('analytics-status').textContent.includes('Cloudflare'));
});

test('open dashboard loads today and all reports without a key or authentication headers', async () => {
  const e = environment({ endpoint }); await settle();
  const enhanced = e.calls.filter(call => call.url.endsWith('/stats'));
  assert.equal(enhanced.length, 1);
  assert.ok(e.calls.every(call => !call.headers.Authorization && call.method === 'GET' && call.referrerPolicy === 'no-referrer' && call.credentials === 'omit'));
  assert.equal(e.get('analytics-site-pv').textContent, '5');
  assert.equal(e.get('analytics-video-clicks').textContent, '2');
  e.get('period-all').events.click(); assert.equal(e.get('analytics-site-pv').textContent, '12'); assert.equal(e.get('analytics-video-clicks').textContent, '8');
  assert.equal(e.get('analytics-articles').children.length, 22);
  assert.equal(e.get('analytics-top-searches').children.length, 1); assert.equal(e.get('analytics-recent-searches').children.length, 1);
  assert.ok(!e.elements.has('analytics-unlock'));
});

test('old key bookmarks are cleaned without transmitting or retaining the credential', async () => {
  const e = environment({ endpoint, key: token }); await settle();
  assert.equal(e.removed(), '/viewer-86064eb2584d2dc9/');
  assert.equal(e.storage.size, 0);
  assert.ok(e.calls.every(call => !call.url.includes(token) && !call.headers.Authorization));
  assert.equal(e.get('analytics-site-pv').textContent, '5');
});

test('unavailable service never appears as zero and requires no unlock prompt', async () => {
  for (const status of [401, 503]) {
    const e = environment({ endpoint, status }); await settle();
    assert.equal(e.get('analytics-site-pv').textContent, '暂不可用');
    assert.ok(!e.elements.has('analytics-unlock'));
    assert.equal(e.get('analytics-recent-searches').children.length, 1);
  }
});

test('invalid report and counts are rejected; names are rendered as text without unsafe links', async () => {
  const bad = sample(); bad.periods.today.pv = -1;
  const e = environment({ endpoint, key: token, report: bad }); await settle();
  assert.equal(e.get('analytics-site-pv').textContent, '暂不可用');
  const hostile = sample(); hostile.periods.today.topSearches[0].name = '<img src=x onerror=alert(1)>';
  const safe = environment({ endpoint, key: token, report: hostile }); await settle();
  const link = safe.get('analytics-top-searches').children[0].children[0].children[0];
  assert.equal(link.textContent, '<img src=x onerror=alert(1)> · G01-001');
  assert.equal(link.href, 'https://wushizupu-commits.github.io/zongpu/index.html?person=G01-001');
});

test('only configured HTTPS Worker origins can receive report requests', async () => {
  for (const endpoint of ['https://evil.example', 'http://safe.workers.dev', 'https://safe.workers.dev/path', 'https://safe.workers.dev/?key=x']) {
    const e = environment({ endpoint, key: token }); await settle();
    assert.equal(e.calls.filter(call => call.url.endsWith('/stats')).length, 0);
  }
});
