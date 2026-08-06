# Cubox 收藏与文本承载契约

- 来源票: 查清 Cubox 收藏与文本承载契约 (chessl/sortify#4)
- 日期: 2026-08-07
- 方法: 官方文档 + 登录态网页版 (cubox.pro) 现场探针。所有"实测"均为对真实账号的可逆探针，完成后已全部删除并清空回收站、删除探针标签，账号已恢复原状。未泄露任何 API Key、登录令牌或账号内部 ID。
- 标注: [文档] = 官方文档明文; [客户端] = 网页版打包代码/网络请求中观察到的接口; [实测] = 真实调用验证。

## 结论速览（三种表示边界）

| 表示 | 可行边界 |
| --- | --- |
| 普通条目 (url) | `type:"url"` + `content`(URL) + `title`(存储截断到 256 字符) + `description`(存储截断到 ~300 字符) + `tags[]` + `folder`。成功响应仅 `{"code":200}`，无 cardId，解析异步排队。服务端不去重，需客户端按规范化 URL 去重。 |
| 视频成功 (原视频 + 完整字幕) | 单条目承载完整字幕**不可行**：公开 API 只有 `url`/`memo` 两种类型，memo `content` 硬上限 3000 字符，`description` 实测截断到 ~300 字符，卡片模型无任何字幕/transcript 字段，客户端无字幕接口。可行上限：`type:"memo"` 单条 ≤3000 字符（或拆多条 memo 按标签/标题关联），原视频 URL 单独存 `type:"url"` 条目，两者用相同标签关联。 |
| 视频降级 (仅原视频) | 完全可行：`type:"url"` 存视频 URL，即使服务端解析失败卡片也会落库（实测 YouTube 解析失败，快照为 fail 页，条目仍在）。 |

## 公开保存 API（文档明文 + 实测）

官方文档页: https://help.cubox.pro/save/89d3/（"开放 API"）

- 入口: 网页版 偏好设置 → 扩展中心和自动化 → API 扩展 → 启用并复制链接。API 链接即个人唯一凭证，可"重新生成"，旧链接随即失效。仅高级账户可用（客户端代码里基础账户弹升级窗）。[文档][客户端]
- 端点格式: `POST https://cubox.pro/c/api/save/<apiKey>`（客户端代码按 `https://cubox.pro/c/api/save/${key}` 拼接，另存在 cubox.cc / test.* 变体）。[客户端] 注意 `<apiKey>` 是"API 扩展"专用 key，与网页登录令牌、扩展专用码都不是同一个：拿扩展专用码调用会返回 `-1100 API Key does not exist`。[实测]
- 请求: `Content-Type: application/json`，body 为 JSON，无需额外请求头（key 在 URL 中即鉴权）。[实测]
- 请求字段（文档示例 + 实测全部字段可用）:
  ```json
  {
    "type": "url",
    "content": "https://apple.com",
    "title": "标题",
    "description": "描述",
    "tags": ["标签A", "标签B"],
    "folder": "收藏夹名称"
  }
  ```
  - `type` 仅支持 `url` 与 `memo`；其它值（含 `text`）返回 `-1102 Wrong type, only supports links and memos`。[实测]
  - `url` 条目: `content` 为链接；`title`/`description`/`tags[]`/`folder`(按名称) 均实测生效。
  - `memo` 条目: `content` 为纯文本；`title`/`tags[]`/`folder` 生效；内容里的 URL 保持为文本，不会变成链接卡片；未传 `title` 时标题自动取 `content` 前 256 字符。[实测]
- 响应: HTTP 恒为 200，业务状态在 body 的 `code` 字段（`200` 成功）。成功响应 `{"code":200,"message":"","data":null}`，**不返回 cardId**；保存后服务端排队解析与快照，稍后出现在账号里（文档原话"调用成功后会排队解析和快照"）。[文档][实测]
- 长度限制（实测，服务端校验）:
  - `content`（memo）: **0–3000 字符**。3001 字符 → `-5000 content length must be between 0 and 3000`；恰好 3000 → 成功。[实测]
  - `description`: 3001 字符的请求被接受，但**存储时截断为 300 字符 + "..."**（回读 303 字符，尾部为省略号）。[实测]
  - `title`: 500 字符的请求被接受，但**存储时截断为 256 字符**。[实测]
- 去重: **服务端不去重**。同一 URL 连续保存两次，生成两条独立条目。[实测]
- 限流: 文档写明高级账户每天最多 500 次调用。[文档]（500 以内未见限流错误，未实测超限行为。）
- 错误码（实测观察）: `-1100` API Key 不存在（key 错误/失效）; `-1102` type 非法; `-5000` 参数校验失败（content 超长等）; `-1006` 网页会话令牌无效。客户端代码另有 `-1025` 用于基础账户升级拦截。[实测][客户端]

## 视频条目与字幕承载能力

- 保存 YouTube 链接: 生成 `type` 0 的 url 卡片；实测该次**服务端解析失败**（快照文件为 fail 页 `archive/fail.html`、无封面），但卡片正常落库。[实测]（单样本，可能受服务端抓取 YouTube 的网络环境影响。）
- 保存 bilibili 链接: 生成 type 0 卡片，解析成功（有页面快照与封面）。[实测]
- 卡片详情模型（`/norm/card/detail` 实测返回的字段集合）对 memo/url/视频卡片一致，**没有任何 videoId/时长/字幕/transcript/subtitle 字段**；在全部网页端打包代码中搜索 subtitle/caption/transcript/danmaku/videoInfo 均无接口。`type` 字段实测取值: 0 = 链接卡片, 2 = memo 卡片。[实测][客户端]
- 结论: Cubox 当前不提供任何把字幕文本附加到视频条目的通道；公开 API 中唯一能承载长文本的是 `memo` 的 `content`（≤3000 字符）和 `url` 的 `description`（存储 ~300 字符）。[实测]

## 搜索 / 更新 / 去重（内部接口，UI 推断）

以下均为网页版内部 API（`https://cubox.pro/c/api/*`），未公开、可能随时变更；鉴权为请求头 `Authorization: <36 位网页登录令牌>`（无 Bearer 前缀），与保存 API 的 key 不是一回事。[客户端][实测]

- 列表/搜索: `GET /norm/card/query?page=1&orderType=4&asc=false&isArticle=false&archiving=false[&keyword=…]`。`keyword` 为全文关键词，实测**匹配 title/description/content，不匹配 URL 字段**（按 URL 搜不到条目）。另有 `GET /norm/card/keyword/list`、`GET /norm/card/search/preview`（全文搜索/搜索预览）。[实测][客户端]
- 详情: `GET /norm/card/detail?cardId=<id>`。[实测]
- 更新: `POST /norm/card/update`（客户端用于改标题/描述/标签/文件夹/已读星标等）。**未验证成功**：实测以 `{cardId,…}` 调用返回 `-5000 cardId 参数错误`，参数名未确认，不建议依赖。[客户端][实测]
- 删除: `POST /norm/cards/delete`（body 需 `application/x-www-form-urlencoded`，`cardIds=a,b`）→ 移入最近删除（回收站保留 30 天自动永久删除，UI 明文）。[实测][客户端]
- 彻底删除: UI"彻底删除"实际调用 `POST /search_engines/recycle/clean`（接口名与用途不符），body `searchEngines=<JSON>`，值为 `[{"userSearchEngineID":"<cardId>"},…]`（form 编码），实测可将回收站条目立即永久删除。[实测][客户端]
- 去重建议: 因保存 API 无去重、且内部搜索不索引 URL，流水线需自行维护"规范化 URL → 已保存"状态，或用标题关键词搜索近似判断；公开契约层面无 URL 查询能力。

## 失败标记

- 保存请求失败: HTTP 200 + `code` 非 200（见错误码表），请求方需自己检查 `code`。
- 解析失败: 条目仍存在，快照为失败页（实测 YouTube 为 `archive/fail.html`），无结构化失败字段；`isParsed` 恒为 true 不代表解析成功。[实测]

## 未确认 / 缺口

- `description` 截断的精确规则（3001 输入 → 300+"..." 存储；300–3000 之间的边界未逐点测试）。
- `title` 截断边界（500 → 256 存储；未测 256–500 之间）。
- `/norm/card/update` 的合法参数形状（内部接口，参数名未确认）。
- 超过 500 次/天的具体限流响应（未测试）。
- YouTube 解析失败是否稳定复现（单样本，疑似服务端抓取环境问题）。
- 视频成功表示若需完整字幕，Cubox 侧无原生承载点，属本调研的关键约束。

## 来源

- 官方保存 API 文档: https://help.cubox.pro/save/89d3/
- 官方 RSS 自动化故事页（字段用法、folder/tags 说明）: https://story.cubox.pro/rss-autosave
- 官方旧文档域名 docs.cubox.pro/started/save/api（故事页引用）: 当前已无法访问（连接失败）。
- 网页版: https://cubox.pro/web/unread（登录态；设置页、最近删除页、打包代码、网络请求均为客户端证据来源）。
