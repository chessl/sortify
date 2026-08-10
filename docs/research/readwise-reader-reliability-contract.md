# Readwise Reader 创建文档可靠性契约

调查日期：2026-08-10

## 结论

Reader 的公开创建契约只承诺：`POST /api/v3/save/` 新建时返回 `201`，文档已存在时返回 `200`，响应含文档 `id` 和 Reader URL；它没有承诺处理是同步还是异步，也没有任务状态、幂等键或完整错误模型。相同 URL 会被去重，但重存会把文档移到 Library 顶部并显示绿点，因此不能把重复 POST 视为无副作用的幂等操作；相同正文只要 URL 不同仍可能生成第二份文档。[Reader API — Document CREATE](https://readwise.io/reader_api#document-create)；[Reader FAQ — How does Reader detect duplicate content?](https://docs.readwise.io/reader/docs/faqs/parsing#how-does-reader-detect-duplicate-content)

对后续 Workflow 的保守边界是：只对**明确未发出请求**的本地失败直接重试；对 `429` 严格等待 `Retry-After` 后再以完全相同 URL 与载荷重试；对超时、断连、lost-ack 和 `5xx`，官方契约不能证明前一次未生效，只能在接受“重复保存会置顶/显示绿点”的产品策略下做有界同 URL 重试，否则转人工或先对账；其他 `4xx` 不自动重试。[Reader API — Rate Limiting](https://readwise.io/reader_api#rate-limiting)；[Reader FAQ — duplicate content](https://docs.readwise.io/reader/docs/faqs/parsing#how-does-reader-detect-duplicate-content)

## 调查方法与证据等级

- **官方承诺**：Readwise 发布的 API 或产品文档明确写出的行为。
- **官方未说明**：在创建端点公开的参数、响应、限流说明及其链接的第一方资料中没有契约；这不是“该能力不存在”的证明，也不能反向推定任何行为。
- **实测观察**：无。为避免污染用户 Reader，本调查没有发送任何写请求。
- 只使用 Readwise 第一方资料：[Reader API](https://readwise.io/reader_api)、API 链接的 [Reader Webhooks](https://docs.readwise.io/readwise/docs/webhooks) 与 Reader 的 [Parsing FAQ](https://docs.readwise.io/reader/docs/faqs/parsing)。

## 契约逐项核对

### 1. 创建成功与同步/异步处理

| 问题 | 结论 | 证据与限制 |
| --- | --- | --- |
| 什么算创建成功？ | **官方承诺**：新建返回 `201`；“document already exist” 返回 `200`。两种响应都给出 `id` 和 Reader 内部 URL。 | [Document CREATE — Response](https://readwise.io/reader_api#document-create) |
| `200` 是否表示本次载荷覆盖旧文档？ | **官方未说明**。公开响应只把 `200` 定义为文档已存在；没有说明 HTML、标题、标签等字段发生合并、忽略还是覆盖。不得把 `200` 当作“更新成功”。 | [Document CREATE — Parameters and Response](https://readwise.io/reader_api#document-create)；Reader 另行说明已保存内容不会自动重新解析，要取得网页更新版本需删除后重存，但没有把这条产品行为细化为 API 字段合并规则：[Parsing FAQ — refresh](https://docs.readwise.io/reader/docs/faqs/parsing#what-if-i-want-to-manually-refresh-an-article-to-reflect-updates-to-the-original) |
| 返回 `2xx` 时正文抓取/清洗/索引是否完成？ | **官方未说明**。端点说明只说未传 `html` 时 Reader 会尝试抓取 URL；响应没有 processing/status 字段，也没有完成时限或可见性 SLA。因此 `2xx` 只能按文档明确内容解释为“创建或找到了文档并返回标识”，不能自行扩张成“所有下游处理完成”。 | [Document CREATE](https://readwise.io/reader_api#document-create) |
| 处理是同步还是异步？ | **官方未说明**。没有 job/task ID、阶段、完成/失败状态或轮询间隔。 | [Document CREATE — complete documented response](https://readwise.io/reader_api#document-create) |

### 2. 错误响应

- **官方承诺**：创建端点公开列出的状态只有 `201` 与“已存在”的 `200`；示例只有通用客户端 `error` 回调，没有非 `2xx` 状态表、业务错误码或错误 JSON schema。[Document CREATE — Response and examples](https://readwise.io/reader_api#document-create)
- **官方承诺**：超限时返回 `429 Too Many Requests`，`Retry-After` 给出应等待的秒数。[Rate Limiting](https://readwise.io/reader_api#rate-limiting)
- **官方未说明**：创建端点对无效 JSON、缺少/错误字段、认证失败、权限失败、载荷过大、抓取失败、清洗失败、服务端失败分别返回什么状态和 body；也没有说明错误是否发生在提交前或提交后。
- **官方未说明**：`5xx`、连接中断、客户端超时、网关超时或收到不完整响应时，服务端是否可能已持久化文档。

因此，除文档明确给出等待方式的 `429` 外，Workflow 不应按猜测的状态/body 字段分类重试。未知 `4xx` 应保留响应后转人工或配置修正；未知 `5xx` 与无响应属于结果不确定，而不是已知失败。

### 3. 限流

| 项目 | 公开契约 |
| --- | --- |
| 创建配额 | **官方承诺**：每个 access token 每分钟 `50` 次。[Document CREATE — Rate limit](https://readwise.io/reader_api#document-create) |
| 超限响应 | **官方承诺**：`429 Too Many Requests`。[Rate Limiting](https://readwise.io/reader_api#rate-limiting) |
| 等待信号 | **官方承诺**：读取 `Retry-After`，其值是等待秒数。[Rate Limiting](https://readwise.io/reader_api#rate-limiting) |
| 其他 headers | **官方未说明**：没有公开 `X-RateLimit-*`、剩余额度、reset 时间等契约。[Rate Limiting](https://readwise.io/reader_api#rate-limiting) |
| 窗口算法与并发 | **官方未说明**：固定/滑动窗口、突发容量、并发上限、跨 endpoint 是否共享预算均未知；只可依赖“创建 50/min/token”。[Document CREATE](https://readwise.io/reader_api#document-create) |
| 多次 `429` | **官方未说明**：没有最大重试次数或退避公式。每次只能遵守该响应的 `Retry-After`；是否继续自动重试需由 Workflow 自己设有界策略。 |

### 4. 重复 URL、重复正文与幂等

- **官方承诺（URL 去重）**：API 把 `url` 描述为文档的 unique URL，并明确“已存在”返回 `200`；Reader FAQ 更明确写道，同一 URL 保存多次会被当前去重逻辑捕获。[Document CREATE](https://readwise.io/reader_api#document-create)；[Parsing FAQ — duplicate content](https://docs.readwise.io/reader/docs/faqs/parsing#how-does-reader-detect-duplicate-content)
- **官方承诺（重存有副作用）**：重存同一 URL 会把文档移到 Library 顶部并显示绿点，表示保存过多次。因此相同 URL POST 最多提供“避免第二份文档”的去重证据，并非严格的无副作用幂等。[Parsing FAQ — duplicate content](https://docs.readwise.io/reader/docs/faqs/parsing#how-does-reader-detect-duplicate-content)
- **官方承诺（不按正文去重）**：相同正文若 URL 略有不同会产生第二个版本；官方举例说明 tracking query 参数可导致这种情况。[Parsing FAQ — duplicate content](https://docs.readwise.io/reader/docs/faqs/parsing#how-does-reader-detect-duplicate-content)
- **官方未说明（URL 等价规则）**：大小写、尾斜杠、fragment、redirect、参数顺序及 URL canonicalization 的比较规则均未公开。必须把“相同 URL”保守理解为调用方复用完全相同的字符串，不能自行假设规范化等价。
- **官方未说明（冲突载荷）**：同一 URL 携带不同正文或元数据重试时，旧值/新值谁胜出、是否部分合并、标签是否累加均无契约。
- **官方未说明（幂等键）**：公开参数表和示例没有 idempotency key/header、请求 ID、作用域或过期时间。不能假定任意自定义 header 会被采用。[Document CREATE — documented request](https://readwise.io/reader_api#document-create)

### 5. 状态查询、轮询与对账

- **官方承诺**：`GET /api/v3/list/?id=<document-id>` 可按已知 ID 返回一个文档（若找到），LIST 配额是每 token 每分钟 `20` 次。[Document LIST](https://readwise.io/reader_api#document-list)
- **官方未说明**：LIST 文档模型没有抓取/清洗/索引的 processing、failed、terminal status 或 error 字段；没有创建 job 的 status endpoint。因此按 ID GET 只能确认“当前可列出文档及其字段”，不能证明所有处理完成。[Document LIST — response](https://readwise.io/reader_api#document-list)
- **lost-ack 限制**：创建响应丢失时调用方没有返回的 ID；LIST 的公开筛选条件没有 source URL，只支持 `id`、`updatedAfter`、location、category、tag 等。可以下载候选结果后由调用方比对 `source_url`，但官方没有承诺创建后多久可见，也没有提供原子按 source URL 查询，故这不是确定性对账协议。[Document LIST — parameters and response](https://readwise.io/reader_api#document-list)
- **Webhook 可作辅助信号**：官方提供 `reader.any_document.created`、`reader.non_feed_document.created` 等“real-time notifications”，文档 payload 含 `id` 与 `source_url`。[Webhooks — Reader Events and Document payload](https://docs.readwise.io/readwise/docs/webhooks#reader-events) 但该页没有声明投递重试、至少/至多一次、顺序、最大延迟或去重语义，所以不能把 webhook 缺席解释为创建失败，也不能单独作为 exactly-once 证明。

## Workflow 重试边界

| 场景 | 自动动作 | 理由 |
| --- | --- | --- |
| 在打开连接/发送任何请求字节前，本地明确失败 | **可直接有界重试**，保持完全相同 URL 与载荷 | 服务端明确未收到请求；这是调用方可证明的本地事实，不依赖 Reader 幂等性。 |
| 收到 `201` 或 `200` 且响应完整 | **不重试；持久化返回的 `id`** | 已得到官方定义的成功结果。[Document CREATE](https://readwise.io/reader_api#document-create) |
| 收到 `429` | **等待该响应的 `Retry-After` 秒后有界重试**；不得提前 | Readwise 明确给出的恢复指令。[Rate Limiting](https://readwise.io/reader_api#rate-limiting) |
| 其他明确 `4xx` | **不自动重试，记录原始状态/body 后转配置修正或人工** | 创建端点未公开错误分类；重复同一无效请求没有官方成功条件。[Document CREATE](https://readwise.io/reader_api#document-create) |
| `5xx`、超时、断连、lost-ack、不完整响应 | **默认结果不确定，不做无条件重试**。若产品明确接受重存置顶/绿点，可用完全相同 URL 和载荷做少量有界重试；否则人工或先对账 | 官方没有提交原子性或幂等键；同 URL 去重降低“第二份文档”风险，但重存有用户可见副作用，且冲突载荷规则未知。[Parsing FAQ — duplicate content](https://docs.readwise.io/reader/docs/faqs/parsing#how-does-reader-detect-duplicate-content) |
| 重试时 URL 或正文来源标识发生变化 | **不得自动重试** | 不同 URL 的相同正文不会被去重。[Parsing FAQ — duplicate content](https://docs.readwise.io/reader/docs/faqs/parsing#how-does-reader-detect-duplicate-content) |
| 已知 ID 后检查文档 | **可按 ID 调 LIST，但遵守 20/min**；只用于存在性/当前字段检查 | LIST 没有处理状态，不能轮询出“处理完成”。[Document LIST](https://readwise.io/reader_api#document-list) |

这里的“有界”次数、总时限、人工队列 SLA 属于 Sortify 产品决策，Readwise 未给上限，本文不自行设定。

## 仍待决定或向 Readwise 验证

1. Sortify 是否接受相同 URL 重存造成“移到 Library 顶部 + 绿点”的用户可见副作用；若不接受，timeout/lost-ack 必须进入人工/对账而不能自动 POST。
2. 向 Readwise 确认创建端点是否存在未公开的幂等键、request ID、错误 body schema，以及 `5xx`/timeout 后的提交原子性。
3. 向 Readwise 确认 `200 already exists` 时各字段的合并/覆盖规则，尤其是 HTML、标题、tags 与 notes；在确认前不得用重复 POST 做更新。
4. 向 Readwise 确认 URL 去重的规范化规则与时效范围；在此之前重试必须复用完全相同 URL 字符串。
5. 向 Readwise 确认创建返回时抓取、清洗、索引是否完成，若异步则索取状态字段、终态、失败原因与可见性 SLA。
6. 确定 Workflow 自身对 `429` 和条件性结果不确定重试的最大次数、总时限、抖动/退避及人工升级策略；官方只给 `Retry-After`，没有给这些上限。
7. 若使用 webhook/LIST 对账，向 Readwise 确认 webhook 投递保证以及创建到 LIST 可见的延迟边界；当前文档不足以建立确定性对账。
