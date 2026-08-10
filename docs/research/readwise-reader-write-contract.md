# Readwise Reader 写入载荷、格式与大小约束

研究日期：2026-08-10

## 一行结论

Reader REST API 同时支持“只交 URL 由 Reader 抓取”和“必填 URL + `html` 直接交正文”；REST 没有纯文本/Markdown 字段，官方 MCP/CLI 另行暴露 `markdown`，但其到 REST 的转换未说明；两条路径的正文/元数据大小上限均未说明，因此“单文档承载任意长度完整转写”尚不能视为已获官方保证。

## 证据口径

- **官方承诺**：Readwise 自有 API/帮助文档明确写出的契约。
- **实测观察**：对官方 API 的非写入请求在研究日期得到的响应；这是当前行为，不等于稳定契约。
- **官方未说明**：已检查的第一方资料没有给出约束。它不表示“无限制”。
- 本次没有调用创建接口，没有创建或修改任何 Reader 用户数据。

## 已确认的创建契约

### 认证与端点

**官方承诺：**

- 创建文档：`POST https://readwise.io/api/v3/save/`，请求体是 JSON 对象。
- 请求头：`Authorization: Token <access token>`；官方示例还发送 `Content-Type: application/json`。
- token 可通过 `GET https://readwise.io/api/v2/auth/` 校验；有效时返回 `204`。

来源：[Reader API — Authentication / Document CREATE](https://readwise.io/reader_api)

**实测观察：** 2026-08-10 对 `https://readwise.io/api/v3/save/` 发送无凭证 `OPTIONS`，响应为 `401`，并包含 `WWW-Authenticate: Token` 与 `Allow: POST, DELETE, OPTIONS`。这只印证当前端点要求 Token；没有绕过认证，也没有写数据。

### 两种正文来源

| 模式 | 最小载荷 | Reader 的处理 | 结论强度 |
| --- | --- | --- | --- |
| 远程 URL | `{"url":"https://…"}` | 未提供 `html` 时，Reader 尝试从公开网络抓取该 URL 的 HTML。 | 官方承诺 |
| 直接正文 | `{"url":"https://…","html":"<p>…</p>"}` | 使用调用方提供的**有效 HTML**；`url` 仍必填。没有真实 URL 时可使用调用方构造的唯一 URL，例如 `https://yourapp.com#document1`。 | 官方承诺 |

来源：[Reader API — Document CREATE 参数与示例](https://readwise.io/reader_api)

所以：

- 普通公开 URL 可使用 URL-only 模式。
- 对 **REST `POST /api/v3/save/`** 而言，纯文本和完整视频转写可以进入直接正文模式，但参数表没有 `text`、`content`、`markdown` 或 transcript 专用字段；调用方须先正确 HTML 转义并包成有效 HTML（例如段落）。这是由官方字段集合和“valid html”要求推出的集成结论，不是 Readwise 对纯文本字段的单独承诺。
- 直接正文也必须有稳定且唯一的 `url`。构造 URL 被官方允许，但命名规则、最大长度和允许字符范围官方未说明。

### REST 与官方 MCP/CLI 不同

Readwise 官方 MCP/CLI 把 `reader_create_document` 描述为可保存 URL 或 HTML/text 文档；其当前工具 schema 还暴露独立 `markdown` 参数，官方 skill 给出 `reader_create_document(title=..., markdown=..., url=...)` 的直接 Markdown 示例。

来源：[Readwise MCP — Supported Tools](https://readwise.io/mcp)、[Readwise CLI — `reader-create-document`](https://readwise.io/cli)、[Readwise 官方 skill — Saving documents](https://github.com/readwiseio/readwise-skills/blob/master/skills/readwise-mcp/SKILL.md)

这不改变 REST 契约：`markdown` 未出现在 REST CREATE 参数表，官方未说明 MCP 服务是转成 HTML 后调用 REST、还是调用另一条内部接口，也未说明 REST 直接收到 `markdown` 会怎样。MCP schema 又没有 REST 的 `location`、`saved_using`、`should_clean_html` 参数。因此 Sortify 若采用 REST，不应把 MCP 的 `markdown` 当成 REST 可写字段；若改用 MCP/CLI，则需另行确认认证、部署方式、`location=new`、HTML/Markdown 优先级和字段子集。

### HTML 清理与元数据解析

- `should_clean_html` 仅在提供 `html` 时有效。
- `should_clean_html: true` 会让 Reader 自动清理 HTML，并从中解析 title/author；默认是 `false`。
- 显式 `title` 覆盖原 title；显式 `author` 覆盖解析阶段发现的 author。

来源：[Reader API — `html`, `should_clean_html`, `title`, `author`](https://readwise.io/reader_api)

**边界：** 官方没有说明清理器允许的元素/属性、会删除或改写什么、脚本/样式/表格/嵌入媒体/内联图片/data URL 的处理、空白与换行保真度，也没有保证 `should_clean_html: false` 会逐字节保存输入。完整转写若要求排版和内容不丢失，仍需用代表性正文做写入后读取/渲染验收。

## 可写字段

下表全部来自官方 [Document CREATE 参数表](https://readwise.io/reader_api)：

| 字段 | 官方类型/语义 | 必填/默认 | 与 Sortify 的关系 |
| --- | --- | --- | --- |
| `url` | 文档唯一 URL；无真实 URL 时可构造 | **必填** | 普通入口用原 URL；纯文本/转写需设计稳定构造 URL |
| `html` | 有效 HTML 正文；省略则抓取 `url` | 可选 | 纯文本和完整转写的承载字段 |
| `should_clean_html` | 清理 HTML 并解析 title/author | 可选，默认 `false` | 是否允许 Reader 改写正文需决策并实测 |
| `title` | 覆盖原 title | 可选 | 可显式保持 Folo/视频标题 |
| `author` | 覆盖解析出的 author | 可选 | 支持显式作者 |
| `summary` | 文档摘要 | 可选 | 可写摘要；长度未说明 |
| `language` | 如 `en`、`de`、`en-US`；省略则自动检测 | 可选 | 可辅助 TTS；值域仅给示例，未给完整规范 |
| `published_date` | ISO 8601 datetime；无时区默认 UTC | 可选 | 可保留发布日期 |
| `image_url` | 封面图片 URL | 可选 | 支持远程封面；不是二进制上传字段 |
| `location` | `new`、`later`、`archive`、`feed` 之一 | 可选，默认 `new` | 目标应显式传 `new`，但见下方回退限制 |
| `category` | `article`、`email`、`rss`、`highlight`、`note`、`pdf`、`epub`、`tweet`、`video` 之一 | 可选；按 URL 猜测，通常 `article` | 视频可显式标 `video`；纯文本应由产品选择 `note` 或其他类别 |
| `saved_using` | 文档来源 | 可选 | 可标记 Sortify；格式/长度/展示行为未说明 |
| `tags` | 字符串列表，如 `["tag1","tag2"]` | 可选 | 创建时可直接加标签 |
| `notes` | 文档顶层 note | 可选 | 不应与正文混用，除非产品明确选择 |

### `location=new` 的限制

`new` 是创建端点允许的值且是默认值；但是，官方同时说明：如果用户没有在设置中启用所请求的 location，服务会把它改成用户的默认 location。因此即使显式传 `location: "new"`，也不能仅凭请求参数保证最终仍为 `new`。

来源：[Reader API — `location`](https://readwise.io/reader_api)

后续规格必须二选一：要求目标账号启用 `new` 并在集成验收时验证最终 location，或接受 Reader 回退到账号默认 location。

### 来源 URL 与返回 URL

- 创建输入没有独立的 `source_url` 字段；必填 `url` 同时承担唯一标识和原始来源 URL 的角色。
- 创建响应示例中的 `url` 是 Reader 内部阅读地址（`https://read.readwise.io/.../read/<id>`），不是原始来源地址。
- 文档列表响应则同时展示内部 `url` 与原始 `source_url`。

来源：[Reader API — CREATE response 与 LIST response](https://readwise.io/reader_api)

因此调用方不能把创建响应的 `url` 当作原始链接；如后续需要两者，应保留输入 URL，或从 LIST 返回的 `source_url` 读取。官方示例展示了这种对应关系，但没有明确承诺构造 URL、重定向 URL 或规范化 URL 在 `source_url` 中是否保持原字符串。

### 作者、图片、标签

- 作者：`author` 可写且覆盖解析所得作者。
- 封面：`image_url` 接受远程图片 URL。官方未说明图片下载时机、允许协议/格式/尺寸、失效 URL、缓存、鉴权图片，或对 URL 的长度限制。
- HTML 内图片：官方只要求 `html` 为有效 HTML，没有承诺 `<img>`、内联资源或图片代理的保留行为。不要把 `image_url` 的封面能力等同于正文内图片能力。
- 标签：`tags` 是字符串列表。官方未说明最大标签数、单标签长度、大小写/空白规范化、非法字符、重复标签或层级语法。

来源：[Reader API — `author`, `image_url`, `tags`](https://readwise.io/reader_api)

## URL 抓取与直接正文的差异

| 方面 | URL-only | 提供 `html` |
| --- | --- | --- |
| 正文取得 | Reader 从公开网络尝试抓取 | 调用方提供有效 HTML |
| 登录态/付费墙 | API 只拿到 URL；官方说明“裸 URL”可能因站点阻拦而只得到部分内容 | 调用方可提交自己已经取得的完整正文，但仍受未说明的 HTML 清理/大小边界影响 |
| 解析可靠性 | 官方明确说开放网络无法 100% 正确解析；可能缺文字、图片、视频、表格或混入广告 | 避开 Reader 重新抓取正文；是否自动清理/解析 title/author 由 `should_clean_html` 控制 |
| 元数据 | Reader 可从抓取页面取得；显式 title/author 可覆盖 | `should_clean_html: true` 才有文档所承诺的自动清理及 title/author 解析；也可显式提供元数据 |
| 后续网页变化 | Reader 保存最初解析版本，不会自动重新解析 | 同样应把首次保存结果视为固定版本；官方没有另行承诺原始 HTML 的字节级保真 |

第一方证据：

- [Reader API — 省略 `html` 时抓取公开网页](https://readwise.io/reader_api)
- [Readwise Docs — Parsing](https://docs.readwise.io/reader/docs/faqs/parsing)：开放网络解析不可能始终 100% 正确；拿到完整页面内容通常优于只拿裸 URL；Reader 保存首次解析结果且不自动重新解析。
- [Readwise Docs — Saving Content](https://docs.readwise.io/reader/docs/saving-content)：浏览器扩展因能取得浏览器渲染后的底层内容，比只传 URL 更稳健；仅 URL 在付费墙场景可能部分解析。

对 Sortify 的直接含义：普通公开 URL 可以委托 Reader 抓取；已有纯文本和完整视频转写应直接提交 HTML，不能再把原 URL 交给 Reader 后假定它会使用 Sortify 已取得的文本。

## 大小与格式边界

### 官方已说明

- API 文档只规定 `html` 必须是有效 HTML，JSON 字段类型如上。
- Readwise 的通用“从设备上传文件”帮助页写明：多数**文件上传**限制为 500 MB，Markdown 文件限制为 10 MB。

来源：[Reader API — Document CREATE](https://readwise.io/reader_api)、[Readwise Docs — Adding Content to Reader / file uploads](https://docs.readwise.io/reader/docs/faqs/adding-new-content)

### 官方未说明

针对 `POST /api/v3/save/`，官方未说明以下任一上限：

- 整个 HTTP/JSON 请求体大小；
- `html` 的字节数、字符数、DOM 节点数或最终字数；
- `url`、`title`、`author`、`summary`、`notes`、`saved_using`、`image_url` 等字符串长度；
- 标签数量与标签字符串长度；
- 远程抓取页面的最大下载体积、抓取超时或重定向次数；
- HTML 编码、允许标签/属性、CSS、表格、代码块、视频嵌入和图片资源限制。
- MCP/CLI `markdown` 正文的大小、字符数或转换后 HTML 大小；

文件上传的 500 MB/Markdown 10 MB 是另一条 UI/文件导入路径，**不能外推**为 JSON 创建 API 或 `html` 字段上限。缺少 API 上限也**不能解释为无限制**。

因此，当前第一方证据只能确认接口形状，不能证明任意长度的完整 YouTube/bilibili 转写都能装进一个 Reader document，也不能证明提交成功后正文不会被截断或清理。

## 给迁移规格的建议边界

1. URL 入口：提交原始公开 URL，可显式附 `location: "new"`、标题/作者/封面/标签；接受 Reader 抓取质量不是 100% 的官方限制。
2. 纯文本/视频转写：将文本安全转义成结构清晰的有效 HTML，使用稳定构造 URL 或原视频 URL，并显式提交 `title`、`author`（如有）、`image_url`（如有）、`tags`、`category` 和 `location: "new"`。
3. 不在规格中写死“Reader 无大小限制”或“完整转写一定不会截断”。实现前需对目标账号做一次会创建并随后清理测试数据的集成验证，覆盖代表性最大转写、非 ASCII 文本、长段落、换行、链接与正文内图片；写入后用 LIST 的 `withHtmlContent=true` 读取并比较关键内容，再人工检查 Reader 渲染。
4. 对完整转写优先从 `should_clean_html: false` 开始验证；是否开启清理不能仅依据文档决定，因为清理规则和保真边界官方未说明。

## 仍待决定或验证

- 纯文本文档的 `category` 选 `note` 还是 `article`；视频转写是否始终用 `video`。
- 稳定构造 URL 的命名方案，以及是否直接复用原视频 URL；这会影响 Reader 对文档唯一性的识别。
- 目标账号是否启用 `new`，以及 location 被回退时是失败还是接受默认位置。
- 选择 `should_clean_html: false` 保真，还是 `true` 换取清理与元数据解析；需以实际渲染比较决定。
- 可接受的最大正文/元数据/标签规模，以及超限时产品行为；官方未给 API 上限，必须实测或向 `api@readwise.io` 索取书面限制。
- `<img>`、表格、代码块、连续长文本、Unicode、换行和链接的保存/渲染保真度。
- 构造 URL/重定向 URL 在 LIST 的 `source_url` 中是否原样保留。
- Sortify 固定采用已文档化的 REST + HTML，还是另行评估 MCP/CLI 的 Markdown 路径；后者不暴露 `location`/`should_clean_html`，且到 REST 的转换官方未说明。
