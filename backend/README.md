# 免费事件统计后台

后台已经完成，默认尚未部署。族谱和独立看板均有配置入口。只需要启用 Cloudflare Workers + D1，然后写入公开 Worker 地址；不必迁移 GitHub Pages 网站或购买域名。

使用 Cloudflare Workers **Free** 方案。D1 免费额度包括每天 500 万行读取、10 万行写入与总计 5GB 存储；免费额度用尽时查询/写入会失败，不会自动变成付费方案。[官方说明](https://developers.cloudflare.com/d1/platform/pricing/)。一条事件会写多行聚合/索引，因此额度不是 10 万条事件。

## 部署

以下步骤供维护者执行；本人只需在授权窗口完成 Cloudflare 登录与部署授权。账号注册或服务条款须由本人完成。不要把账户密码发给维护者。

1. 在 `backend` 目录安装固定版本工具：`npm install`，再执行 `npx wrangler login`，由本人在浏览器完成授权。若有多个账号，指定正确的 `CLOUDFLARE_ACCOUNT_ID`。
2. 创建数据库：`npx wrangler d1 create zongpu-analytics`。将返回的数据库 ID 填入 `wrangler.jsonc` 的 `database_id`，替换占位符。此 ID 不是秘密。
3. 初始化表：`npx wrangler d1 migrations apply zongpu-analytics --remote`。只对本项目新数据库执行；不要复用其他项目的数据库。
4. 本地生成两个独立的随机密钥（至少 32 字符）。分别执行 `npx wrangler secret put READ_TOKEN` 和 `npx wrangler secret put IP_HASH_SECRET` 输入密钥；不要写入命令行、README 或公开源码。记录本人查看密钥并保管好。保持 IP_HASH_SECRET 不变，否则新旧 IP 去重结果将不一致。
5. 执行 `npx wrangler deploy`，取得类似 `https://zongpu-private-analytics.你的子域.workers.dev` 的公开地址。
6. 将该 origin 填入**宗谱仓库和独立看板**各自的 `assets/analytics-config.json`：`{ "endpoint": "https://...workers.dev" }`，提交并等待两个 GitHub Pages 发布成功。
7. 本人打开统计页并输入 READ_TOKEN，或将 `统计页地址#key=READ_TOKEN` 收藏为私人链接。先只读验证新接口，再做少量真实访问核对；不要批量向生产接口写测试事件。

`READ_TOKEN` 只授权读取本项目报表，不是 Cloudflare 账号 token。`IP_HASH_SECRET` 用于服务端 IP 去重，不能交给客户端。主站公开 endpoint 不授予报表读取权限。

## 接口与保留

`POST /collect` 只接受 JSON `{eventId, kind, page, itemId}`。kind 为 page/article/search，栏目、文章、人物均须命中公开清单。服务端生成时间和北京时间日期。单条请求体最多 1KB。搜索只能在族谱页发生，人物名称由服务端公开清单解析。

`GET /stats` 要求 `Authorization: Bearer READ_TOKEN`，返回今日、累计、文章排行、热门人物与最近 20 条搜索。两种接口只允许族谱和看板共同的 GitHub Pages origin；CORS 是浏览器限制，不能完全阻止直接构造请求。

页面 PV 的去重口径是每次加载计一次；UV 是原始 IP 的 HMAC 值去重。文章与搜索不改变 PV/UV。eventId 去重与聚合在同一次 SQLite 触发器事务中完成。30 天前的详细事件定时删除，累计数字、每日计数、IP 哈希去重和只含 UUID 的防重记录保留。

## 开发与测试

`node --test tests/*.test.js`（Node 24+，使用内置 SQLite）。测试不需要账号，也不发送生产请求。`npm run dev` 可本地运行 Worker；本地预览需要 .dev.vars 中的测试密钥，且请求应带允许的 Origin 与模拟 CF-Connecting-IP。不要上传测试变量。

人物清单从主站 `assets/zongpu-data.js` 中提取，仅保存 ID/姓名。族谱更新后可执行 `npm run catalog -- /path/to/zongpu/assets/zongpu-data.js`。文章修改时先更新 `../assets/report-catalog.json`，再重建后台清单，避免两端版本不一致。
