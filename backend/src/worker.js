import catalog from './catalog.json' with { type: 'json' };

const ORIGIN = 'https://wushizupu-commits.github.io';
const MAX_BODY_BYTES = 1024;
const DAY_MS = 86400000;
// Reserved metric in the existing schema; excluded from article totals and rankings.
const VIDEO_METRIC = 'video:family-introduction';
const pageById = new Map(catalog.pages.map(item => [item.id, item]));
const articleById = new Map(catalog.articles.map(item => [item.id, item]));
const personById = new Map(catalog.people.map(item => [item.id, item]));
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const encoder = new TextEncoder();

export function shanghaiDate(now) {
  return new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
}

function respond(status, data, cors = true, extra = {}) {
  const headers = {
    'Cache-Control': 'no-store', 'Vary': 'Origin',
    'X-Content-Type-Options': 'nosniff', ...extra
  };
  if (cors) headers['Access-Control-Allow-Origin'] = ORIGIN;
  if (data !== undefined) headers['Content-Type'] = 'application/json; charset=utf-8';
  return new Response(data === undefined ? null : JSON.stringify(data), { status, headers });
}

class RequestError extends Error {
  constructor(status, code) { super(code); this.status = status; }
}

async function readEvent(request) {
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new RequestError(415, 'json_required');
  }
  const declared = request.headers.get('Content-Length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)) {
    throw new RequestError(413, 'body_too_large');
  }
  const reader = request.body?.getReader();
  if (!reader) throw new RequestError(400, 'invalid_event');
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new RequestError(413, 'body_too_large');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let event;
  try { event = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new RequestError(400, 'invalid_event'); }
  if (!event || Array.isArray(event) || typeof event !== 'object'
    || Object.keys(event).sort().join(',') !== 'eventId,itemId,kind,page'
    || !Object.values(event).every(value => typeof value === 'string')
    || !uuidPattern.test(event.eventId) || !pageById.has(event.page)) {
    throw new RequestError(400, 'invalid_event');
  }
  if (event.kind === 'page') {
    if (event.itemId !== '') throw new RequestError(400, 'invalid_event');
  } else if (event.kind === 'article') {
    if (articleById.get(event.itemId)?.page !== event.page) throw new RequestError(400, 'invalid_event');
  } else if (event.kind === 'video') {
    if (event.page !== 'home.html' || event.itemId !== 'family-introduction') throw new RequestError(400, 'invalid_event');
  } else if (event.kind === 'search') {
    if (event.page !== 'index.html' || !personById.has(event.itemId)) throw new RequestError(400, 'invalid_event');
  } else throw new RequestError(400, 'invalid_event');
  event.eventId = event.eventId.toLowerCase();
  return event;
}

async function visitorHash(request, env) {
  if (typeof env.IP_HASH_SECRET !== 'string' || env.IP_HASH_SECRET.length < 32) throw new RequestError(503, 'service_unavailable');
  // This is Cloudflare's incoming request header, never a JSON/client event field.
  const ip = request.headers.get('CF-Connecting-IP')?.trim().toLowerCase();
  if (!ip || ip.length > 45 || !/^[0-9a-f:.]+$/.test(ip)) throw new RequestError(503, 'service_unavailable');
  const key = await crypto.subtle.importKey('raw', encoder.encode(env.IP_HASH_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(ip));
  return [...new Uint8Array(signature)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function collect(request, env, now) {
  const event = await readEvent(request);
  if (request.cf?.botManagement?.verifiedBot === true) return respond(204);
  const visitor = event.kind === 'page' ? await visitorHash(request, env) : null;
  const at = now.toISOString();
  const storedKind = event.kind === 'video' ? 'article' : event.kind;
  const storedItem = event.kind === 'video' ? VIDEO_METRIC : event.itemId;
  // A single statement + trigger is atomic. Receipt survives deletion of event details.
  await env.DB.prepare(`INSERT INTO events(event_id, kind, page, item_id, period, at, visitor)
    SELECT ?, ?, ?, ?, ?, ?, ?
    WHERE NOT EXISTS (SELECT 1 FROM event_receipts WHERE event_id = ?)
    ON CONFLICT(event_id) DO NOTHING`)
    .bind(event.eventId, storedKind, event.page, storedItem, shanghaiDate(now), at, visitor, event.eventId).run();
  return respond(204);
}

function summarize(rows) {
  const count = (kind, id) => rows.find(row => row.kind === kind && row.item_id === id)?.count || 0;
  const sum = kind => rows.filter(row => row.kind === kind).reduce((total, row) => total + row.count, 0);
  const topSearches = rows.filter(row => row.kind === 'search' && personById.has(row.item_id))
    .sort((a, b) => b.count - a.count || b.last_at.localeCompare(a.last_at) || a.item_id.localeCompare(b.item_id))
    .slice(0, 20).map(row => ({ id: row.item_id, name: personById.get(row.item_id).name, count: row.count, lastAt: row.last_at }));
  return {
    pv: sum('page'), uv: count('visitor', ''), searches: sum('search'), articleOpens: sum('article') - count('article', VIDEO_METRIC), videoClicks: count('article', VIDEO_METRIC),
    pages: catalog.pages.map(page => ({ ...page, pv: count('page', page.id) })),
    articles: catalog.articles.map(article => ({ ...article, opens: count('article', article.id) })),
    topSearches
  };
}

async function stats(request, env, now) {
  const today = shanghaiDate(now);
  const cutoff = new Date(now.getTime() - 30 * DAY_MS).toISOString();
  const results = await env.DB.batch([
    env.DB.prepare('SELECT period, kind, item_id, count, last_at FROM metrics WHERE period IN (?, ?)').bind('all', today),
    env.DB.prepare("SELECT item_id, page, at FROM events WHERE kind = 'search' AND at >= ? ORDER BY at DESC, event_id DESC LIMIT 20").bind(cutoff),
    env.DB.prepare("SELECT value FROM metadata WHERE key = 'started_at'")
  ]);
  const metrics = results[0].results;
  return respond(200, {
    timezone: 'Asia/Shanghai', today,
    startedAt: results[2].results[0]?.value || null, updatedAt: now.toISOString(),
    periods: { today: summarize(metrics.filter(row => row.period === today)), all: summarize(metrics.filter(row => row.period === 'all')) },
    recentSearches: results[1].results.filter(row => personById.has(row.item_id))
      .map(row => ({ id: row.item_id, name: personById.get(row.item_id).name, page: row.page, at: row.at }))
  });
}

export async function handleRequest(request, env, now = new Date()) {
  const cors = request.headers.get('Origin') === ORIGIN;
  if (!cors) return respond(403, { error: 'origin_not_allowed' }, false);
  const url = new URL(request.url);
  const method = url.pathname === '/collect' ? 'POST' : url.pathname === '/stats' ? 'GET' : null;
  if (!method) return respond(404, { error: 'not_found' });
  if (url.search) return respond(400, { error: 'query_not_allowed' });
  if (request.method === 'OPTIONS') {
    const allowedHeader = method === 'POST' ? 'content-type' : 'authorization';
    const requestedHeaders = (request.headers.get('Access-Control-Request-Headers') || '').toLowerCase().split(',').map(value => value.trim()).filter(Boolean);
    if (request.headers.get('Access-Control-Request-Method') !== method || requestedHeaders.some(header => header !== allowedHeader)) return respond(403, { error: 'preflight_not_allowed' });
    return respond(204, undefined, true, {
      'Access-Control-Allow-Methods': method,
      'Access-Control-Allow-Headers': allowedHeader,
      'Access-Control-Max-Age': '86400'
    });
  }
  if (request.method !== method) return respond(405, { error: 'method_not_allowed' }, true, { Allow: method });
  try {
    if (!env.DB) throw new RequestError(503, 'service_unavailable');
    return await (method === 'POST' ? collect(request, env, now) : stats(request, env, now));
  } catch (error) {
    // Never expose SQL, identity hashes, submitted input, or secrets in errors/logs.
    return respond(error instanceof RequestError ? error.status : 503, {
      error: error instanceof RequestError ? error.message : 'service_unavailable'
    });
  }
}

export async function cleanup(env, now = new Date()) {
  const cutoff = new Date(now.getTime() - 30 * DAY_MS).toISOString();
  await env.DB.prepare('DELETE FROM events WHERE at < ?').bind(cutoff).run();
}

export default {
  fetch: (request, env) => handleRequest(request, env),
  async scheduled(_controller, env) { await cleanup(env); }
};
