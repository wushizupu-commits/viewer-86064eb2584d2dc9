(() => {
  'use strict';
  const assetUrl = document.currentScript.src;
  const source = 'https://wushizupu-commits.github.io/zongpu/';
  const legacyEndpoint = 'https://busuanzi.9420.ltd/api';
  const $ = id => document.getElementById(id);
  let endpoint = '', catalog, snapshot = null, legacy = null, period = 'today', busy = false;
  let mode = 'loading', statusMessage = '正在读取统计配置…';
  const number = value => value.toLocaleString('zh-CN');
  const count = value => Number.isSafeInteger(value) && value >= 0;
  const timestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value));
  const person = item => item && /^G\d{2}-\d{3}$/.test(item.id) && typeof item.name === 'string' && item.name.length > 0 && item.name.length <= 128;
  const formatTime = value => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
  function workerOrigin(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+workers\.dev$/.test(url.hostname)
        && !url.username && !url.password && !url.port && url.pathname === '/' && !url.search && !url.hash ? url.origin : '';
    } catch { return ''; }
  }
  // Remove credentials left by old personal bookmarks; no credential is used now.
  if (new URLSearchParams(location.hash.slice(1)).has('key')) {
    history.replaceState(null, '', location.pathname + location.search);
  }
  try { sessionStorage.removeItem('zongpu-private-read-key'); } catch {}

  async function getJson(url, headers = {}) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(url, { method: 'GET', headers, signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
      if (!response.ok) { const error = new Error('query_failed'); error.status = response.status; throw error; }
      return await response.json();
    } finally { clearTimeout(timer); }
  }
  function validateReport(report) {
    if (!report || report.timezone !== 'Asia/Shanghai' || !/^\d{4}-\d{2}-\d{2}$/.test(report.today)
      || !timestamp(report.updatedAt) || (report.startedAt !== null && !timestamp(report.startedAt))) return false;
    for (const range of ['today', 'all']) {
      const data = report.periods?.[range];
      if (!data || !['pv', 'uv', 'searches', 'articleOpens', 'videoClicks'].every(field => count(data[field]))
        || !Array.isArray(data.pages) || data.pages.length !== 7 || !Array.isArray(data.articles) || data.articles.length !== 22
        || !Array.isArray(data.topSearches) || data.topSearches.length > 20) return false;
      if (new Set(data.pages.map(row => row?.id)).size !== 7 || new Set(data.articles.map(row => row?.id)).size !== 22) return false;
      if (!data.pages.every(row => catalog.pages.some(page => page.id === row?.id) && count(row.pv))) return false;
      if (!data.articles.every(row => catalog.articles.some(article => article.id === row?.id && article.page === row.page) && count(row.opens))) return false;
      if (!data.topSearches.every(row => person(row) && count(row.count) && timestamp(row.lastAt))) return false;
    }
    return Array.isArray(report.recentSearches) && report.recentSearches.length <= 20
      && report.recentSearches.every(row => person(row) && row.page === 'index.html' && timestamp(row.at));
  }
  function emptyRow(body, message, columns = 2) {
    body.replaceChildren();
    const row = document.createElement('tr'), cell = document.createElement('td');
    cell.colSpan = columns; cell.textContent = message; row.append(cell); body.append(row);
  }
  function addRow(body, title, value, url, uv) {
    const row = document.createElement('tr'), name = document.createElement('th'), cell = document.createElement('td');
    name.scope = 'row';
    if (url) { const link = document.createElement('a'); link.href = url; link.textContent = title; link.rel = 'noreferrer'; name.append(link); }
    else name.textContent = title;
    cell.textContent = typeof value === 'number' ? number(value) : value;
    row.append(name, cell);
    if (uv !== undefined) { const u = document.createElement('td'); u.textContent = typeof uv === 'number' ? number(uv) : uv; row.append(u); }
    body.append(row);
  }
  function pageUrl(page) { return source + page + (page === 'index.html' ? '?view=tree' : ''); }
  function render() {
    const today = period === 'today', data = snapshot?.periods[period];
    $('period-panel').setAttribute('aria-labelledby', 'period-' + period);
    for (const range of ['today', 'all']) {
      $('period-' + range).setAttribute('aria-selected', String(range === period));
      $('period-' + range).tabIndex = range === period ? 0 : -1;
    }
    $('analytics-status').textContent = statusMessage;
    const fallback = !endpoint && !today && legacy;
    const unavailable = mode === 'disabled' ? '待开启' : mode === 'error' ? '暂不可用' : '—';
    $('analytics-pv-label').textContent = today ? '今日浏览量' : '累计浏览量';
    $('analytics-uv-label').textContent = fallback ? '估算访客数' : '独立 IP 数';
    $('analytics-uv-note').textContent = fallback ? '原公共服务估算，不代表精确人数' : '按 IP 去重，不代表精确人数';
    $('analytics-site-pv').textContent = data ? number(data.pv) : fallback ? number(legacy.pv) : unavailable;
    $('analytics-site-uv').textContent = data ? number(data.uv) : fallback ? number(legacy.uv) : unavailable;
    $('analytics-video-clicks').textContent = data ? number(data.videoClicks) : unavailable;
    $('analytics-searches').textContent = data ? number(data.searches) : unavailable;
    $('analytics-article-opens').textContent = data ? number(data.articleOpens) : unavailable;
    $('analytics-period-note').textContent = data
      ? today ? snapshot.today + ' · 北京时间零点起，查询时为 ' + formatTime(snapshot.updatedAt)
        : '增强统计启用以来的全部累计' + (snapshot.startedAt ? ' · 起始于 ' + formatTime(snapshot.startedAt) : ' · 尚无记录')
      : today ? '今日按北京时间（UTC+8）统计；需启用免费后台。'
        : fallback ? '原有累计：从 2026 年 10 月 4 日接入后开始，文章与搜索明细尚未启用。' : '增强统计从后台启用后累计；历史明细无法补录。';
    const pageBody = $('analytics-pages'); pageBody.replaceChildren();
    for (const page of catalog?.pages || []) {
      addRow(pageBody, page.title, data ? data.pages.find(row => row.id === page.id).pv : fallback ? legacy.pages.get(page.id)?.page_pv ?? '暂不可用' : unavailable, pageUrl(page.id));
    }
    const articleBody = $('analytics-articles');
    if (data) {
      articleBody.replaceChildren();
      const sorted = [...catalog.articles].sort((a, b) => data.articles.find(row => row.id === b.id).opens - data.articles.find(row => row.id === a.id).opens);
      for (const article of sorted) addRow(articleBody, article.title, data.articles.find(row => row.id === article.id).opens, source + article.page + '#' + encodeURIComponent(article.id));
    } else emptyRow(articleBody, unavailable + ' · 启用后台后显示各篇文章打开次数');
    const searchBody = $('analytics-top-searches');
    if (data?.topSearches.length) {
      searchBody.replaceChildren();
      for (const item of data.topSearches) addRow(searchBody, item.name + ' · ' + item.id, item.count, source + 'index.html?person=' + encodeURIComponent(item.id));
    } else emptyRow(searchBody, data ? '这个时间范围内还没有人物搜索选择' : unavailable + ' · 启用后台后显示被搜索的人物');
    const recentBody = $('analytics-recent-searches'); recentBody.replaceChildren();
    if (snapshot?.recentSearches.length) {
      for (const item of snapshot.recentSearches) {
        const li = document.createElement('li'), link = document.createElement('a'), time = document.createElement('time');
        link.href = source + 'index.html?person=' + encodeURIComponent(item.id); link.rel = 'noreferrer'; link.textContent = item.name + ' · ' + item.id;
        time.dateTime = item.at; time.textContent = formatTime(item.at); li.append(link, time); recentBody.append(li);
      }
    } else { const li = document.createElement('li'); li.textContent = snapshot ? '最近 30 天还没有人物搜索选择' : unavailable + ' · 新增记录从后台启用后开始'; recentBody.append(li); }
  }
  async function readLegacy() {
    const results = await Promise.allSettled(catalog.pages.map(page => getJson(legacyEndpoint, { 'x-bsz-referer': source + page.id })));
    const good = [], byPage = new Map(); $('legacy-pages').replaceChildren();
    results.forEach((result, i) => {
      const page = catalog.pages[i], value = result.status === 'fulfilled' ? result.value : null;
      const valid = value?.success === true && ['site_pv', 'site_uv', 'page_pv', 'page_uv'].every(field => count(value.data?.[field]));
      if (valid) { good.push(value.data); byPage.set(page.id, value.data); }
      addRow($('legacy-pages'), page.title, valid ? value.data.page_pv : '暂不可用', pageUrl(page.id), valid ? value.data.page_uv : '暂不可用');
    });
    legacy = good.length ? { pv: Math.max(...good.map(row => row.site_pv)), uv: Math.max(...good.map(row => row.site_uv)), pages: byPage } : null;
    $('legacy-site-pv').textContent = legacy ? number(legacy.pv) : '暂不可用';
    $('legacy-site-uv').textContent = legacy ? number(legacy.uv) : '暂不可用';
    $('legacy-status').textContent = good.length === 7 ? '更新于 ' + formatTime(new Date().toISOString()) + '（北京时间）' : '部分或全部原有累计暂不可用，可稍后刷新。';
  }
  async function readEnhanced() {
    snapshot = null;
    if (!endpoint) { mode = 'disabled'; statusMessage = '今日、文章和搜索明细待开启：还需登录 Cloudflare 启用免费后台。原有累计仍可查询。'; return; }
    try {
      const value = await getJson(endpoint + '/stats');
      if (!validateReport(value)) throw Error('invalid_report');
      snapshot = value; mode = 'ready'; statusMessage = '更新于 ' + formatTime(value.updatedAt) + '（北京时间）；本页只查询，不增加计数。';
    } catch (error) {
      mode = 'error';
      statusMessage = '明细暂时无法查询，可稍后刷新；未将失败显示为零。';
    }
  }
  async function update() {
    if (busy || !catalog) return;
    busy = true; $('analytics-refresh').disabled = true; $('period-panel').setAttribute('aria-busy', 'true');
    snapshot = null; statusMessage = '正在查询访问数据…'; render();
    try { await Promise.all([readLegacy(), readEnhanced()]); }
    finally { busy = false; $('analytics-refresh').disabled = false; $('period-panel').setAttribute('aria-busy', 'false'); render(); }
  }
  function select(range) { period = range; render(); }
  for (const range of ['today', 'all']) {
    $('period-' + range).addEventListener('click', () => select(range));
    $('period-' + range).addEventListener('keydown', event => {
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); const next = event.key === 'Home' ? 'today' : event.key === 'End' ? 'all' : period === 'today' ? 'all' : 'today'; select(next); $('period-' + next).focus();
      }
    });
  }
  $('analytics-refresh').addEventListener('click', update);
  if (location.protocol === 'file:') { $('analytics-refresh').disabled = true; $('analytics-status').textContent = '请通过 HTTP 或 HTTPS 打开统计页。'; return; }
  Promise.all([
    getJson(new URL('analytics-config.json?v=20261005-open', assetUrl).href),
    getJson(new URL('report-catalog.json?v=20261005-open', assetUrl).href)
  ]).then(([config, list]) => {
    if (!Array.isArray(list?.pages) || list.pages.length !== 7 || !Array.isArray(list.articles) || list.articles.length !== 22
      || !list.pages.every(row => /^(home|index|biographies|image_archive|family_customs|revisions|source_migration)\.html$/.test(row.id) && typeof row.title === 'string')
      || !list.articles.every(row => /^[a-z0-9-]+$/.test(row.id) && list.pages.some(page => page.id === row.page) && typeof row.title === 'string')) throw Error('invalid_catalog');
    catalog = list; endpoint = workerOrigin(config?.endpoint);
    if (!endpoint) document.querySelector('.analytics-legacy').open = true;
    update();
  }).catch(() => { $('analytics-status').textContent = '统计配置暂时无法读取，请刷新页面再试。'; $('analytics-refresh').disabled = true; });
  // A tab left open over midnight must not present yesterday as today's figures.
  setInterval(() => {
    if (snapshot && new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10) !== snapshot.today) update();
  }, 60000);
})();
