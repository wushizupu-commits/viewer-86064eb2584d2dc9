# 免费事件统计后台

2026-10-05 已在 Chrome 的 Cloudflare 控制台创建并部署：

- Worker：zongpu-private-analytics
- 地址：https://zongpu-private-analytics.wurenzhe911.workers.dev
- D1：zongpu-analytics，绑定名 DB
- 数据库 ID：e256c21e-c640-4460-8a1e-13cd5b850fa0
- 0001_analytics.sql 的表、索引、触发器已初始化，不要在现有库重复建表。
- 宗谱与独立看板的 endpoint 已接通，真实页面、文章、人物搜索验证已入库。

已按所有者要求取消 READ_TOKEN 查看验证，独立看板打开即可读取。知道地址的人也能查看全部报表。IP_HASH_SECRET 仍作为 Secret 配置，只用于 IP 匿名化，必须保持不变，不得提交 GitHub；原 READ_TOKEN 无须删除或公开，代码不再使用它。

使用 Workers/D1 免费方案，没有开启付费升级。D1 免费额度含每日 500 万行读取、10 万行写入和 5GB 总存储，一条事件会写多行，因此不等于每日 10 万事件。额度用尽查询或写入会失败。[官方说明](https://developers.cloudflare.com/d1/platform/pricing/)。

## 接口和统计口径

POST /collect 接受 JSON {eventId,kind,page,itemId}，kind 仅 page/article/search，项目 ID 必须命中公开白名单；请求体最多 1KB。服务端生成时间和北京时间日期。搜索只在世系栏目记录选中的公开人物 ID，名称由公开清单解析，不收集原始输入。

GET /stats 无需 Authorization 或查看密钥，返回今日、累计、文章排行、热门人物与最近 30 天最多 20 条搜索。接口只允许共同 GitHub Pages origin；CORS 不能阻止主动构造请求。

页面加载计 PV，原始 IP 的 HMAC 值做今日和全期 UV 去重。无原始 IP 存储或展示。文章和搜索不增加 PV/UV。单次插入及 SQLite 触发器事务完成防重和聚合；event_receipts 保存 UUID 防止明细清理后重放。

当前未配置 cron，不自动删除明细。worker.js 的 cleanup 函数是可选的 30 天明细清理，仅在获得所有者明确授权后开启；它保留每日/累计聚合、IP 哈希去重和 UUID 防重结果。查看页的最近列表始终只查最近 30 天。

## 维护与重新部署

源文件 src/worker.js 导入 src/catalog.json。Cloudflare 在线编辑器需要先打包成单文件，不能只粘贴未打包源码；复制时关闭浏览器自动翻译以免改动代码。固定工具版本已写 package-lock.json。

可选命令行维护：在 backend 执行 npm install；经本人浏览器授权后使用 wrangler deploy。现有 D1 已初始化，勿重复应用首个迁移。wrangler.jsonc 与目前数据库、日期、日志和空 cron 配置一致。账号密码、部署凭据不得写入仓库。

Node 24+ 测试：node --test tests/*.test.js。测试使用本地 SQLite 和模拟请求，不依赖账号，不写生产计数。npm run dev 可本地预览；.dev.vars 只能放测试密钥，不得上传。

人物清单由主站 assets/zongpu-data.js 提取，仅含公开 ID/姓名。更新族谱后可运行 npm run catalog -- /path/to/zongpu/assets/zongpu-data.js。文章变动先更新 ../assets/report-catalog.json，再重建后台清单。


视频以 video/family-introduction 接收，复用现有 schema 的 article/video:family-introduction 保留项存储；文章总数和排行排除此项，无需迁移数据库。今日按北京时间，重复 eventId 不再累计。
