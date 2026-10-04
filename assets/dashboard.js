(() => {
  "use strict";

  const endpoint = "https://busuanzi.9420.ltd/api";
  const siteUrl = "https://wushizupu-commits.github.io/zongpu/";
  const pages = [
    ["home.html", "首页"],
    ["index.html", "世系族谱"],
    ["biographies.html", "族贤传略"],
    ["image_archive.html", "宗族图志"],
    ["family_customs.html", "家训礼俗"],
    ["revisions.html", "历代修谱"],
    ["source_migration.html", "源流迁徙"]
  ];
  const status = document.getElementById("analytics-status");
  const refresh = document.getElementById("analytics-refresh");
  const rows = document.getElementById("analytics-pages");
  const sitePv = document.getElementById("analytics-site-pv");
  const siteUv = document.getElementById("analytics-site-uv");
  if (!status || !refresh || !rows || !sitePv || !siteUv) return;

  // The read-only dashboard has no connection to the site's counting module.
  // The referer is always one of these seven fixed public paths.
  async function readCounts(page) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(endpoint, {
        method: "GET",
        headers: { "x-bsz-referer": siteUrl + page },
        signal: controller.signal,
        credentials: "omit",
        referrerPolicy: "no-referrer",
        cache: "no-store"
      });
      if (!response.ok) throw new Error("Statistics service unavailable");
      const result = await response.json();
      const fields = ["site_pv", "site_uv", "page_pv", "page_uv"];
      if (result.success !== true || !fields.every(key => Number.isSafeInteger(result.data?.[key]) && result.data[key] >= 0)) {
        throw new Error("Invalid statistics response");
      }
      return result.data;
    } finally {
      clearTimeout(timeout);
    }
  }

  const cells = pages.map(([page, title]) => {
    const row = document.createElement("tr");
    const name = document.createElement("th");
    name.scope = "row";
    const link = document.createElement("a");
    link.href = siteUrl + page + (page === "index.html" ? "?view=tree" : "");
    link.textContent = title;
    name.append(link);
    const pv = document.createElement("td");
    const uv = document.createElement("td");
    pv.textContent = uv.textContent = "—";
    row.append(name, pv, uv);
    rows.append(row);
    return { pv, uv };
  });

  if (location.protocol === "file:") {
    refresh.disabled = true;
    status.textContent = "请通过 HTTP 或 HTTPS 打开本页，以连接统计服务。";
    return;
  }

  async function update() {
    if (refresh.disabled) return;
    refresh.disabled = true;
    rows.setAttribute("aria-busy", "true");
    status.textContent = "正在查询累计数据…";
    sitePv.textContent = siteUv.textContent = "—";
    cells.forEach(({ pv, uv }) => { pv.textContent = uv.textContent = "—"; });
    try {
      const results = await Promise.allSettled(pages.map(([page]) => readCounts(page)));
      const successful = [];
      results.forEach((result, i) => {
        if (result.status === "fulfilled") {
          const data = result.value;
          cells[i].pv.textContent = data.page_pv.toLocaleString("zh-CN");
          cells[i].uv.textContent = data.page_uv.toLocaleString("zh-CN");
          successful.push(data);
        } else {
          cells[i].pv.textContent = cells[i].uv.textContent = "暂不可用";
        }
      });
      if (successful.length) {
        // Requests can see slightly different snapshots while the site receives visits.
        sitePv.textContent = Math.max(...successful.map(data => data.site_pv)).toLocaleString("zh-CN");
        siteUv.textContent = Math.max(...successful.map(data => data.site_uv)).toLocaleString("zh-CN");
      }
      status.textContent = successful.length === pages.length
        ? "更新于 " + new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) + "（北京时间）"
        : successful.length ? "部分栏目暂时无法查询；可稍后刷新。" : "统计服务暂时不可用；可稍后刷新。";
    } finally {
      rows.setAttribute("aria-busy", "false");
      refresh.disabled = false;
    }
  }

  refresh.addEventListener("click", update);
  update();
})();
