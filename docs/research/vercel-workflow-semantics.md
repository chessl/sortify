# Vercel Workflow 幂等与重试边界（workflow@4.8.0）

Ticket: [查清 Vercel Workflow 的幂等与重试边界](https://github.com/chessl/sortify/issues/5)
Installed version: `workflow@4.8.0`（`package.json` 声明 `^4.8.0`，`node_modules/workflow/package.json` 与 `node_modules/@workflow/core/package.json` 均为 `4.8.0`）。本笔记仅覆盖该版本。

Sources: 官方 Vercel 平台文档（vercel.com/docs/workflows*）、随包分发的官方 SDK 文档（`node_modules/workflow/docs/**`，与 workflow-sdk.dev 同源）、`node_modules/@workflow/core/dist` 运行时源码。除特别标注 `[INFERENCE]` 外均为文档或源码直接可证的事实。

---

## 1. 启动幂等性（start idempotency）

**结论：`start()` 本身不是幂等的——没有去重键（dedup key）选项；重复调用必然创建新 run。跨投递去重必须由调用方状态或 hook 机制承担。**

- `start()` 每次调用在客户端生成新的 ULID runId（`wrun_` 前缀），写入 `run_created` 事件并入队；`StartOptions` 仅含 `world`、`specVersion`、`deploymentId`，**无 idempotency key 字段**（源码 `node_modules/@workflow/core/dist/runtime/start.d.ts`、`start.js`）。
- 4.x 的 resilient start：`run_created` 与 `world.queue` 并行提交；若 `run_created` 因 429/5xx 失败，run 仍被视为接受，运行时在处理队列消息时异步补建；409 `EntityConflictError`（run 已存在，冷启动竞态下可能发生）被吞掉并按既有 run 返回。这修复的是"启动路径自身可靠"，**不是**调用方幂等（`docs/changelog/resilient-start.mdx`）。
- 官方认可的去重手段是 **hook token 机制**：`createHook({ token })` 的确定性 token 在 run 存活期内全局唯一；重复 run 创建同一 token 时触发 `hook_conflict` 事件，`hook.getConflict()` 返回拥有该 token 的既有 runId，可据此去重/委托/取消（`docs/api-reference/workflow/create-hook.mdx`、`docs/errors/hook-conflict.mdx`；`getConflict()` 自 `workflow@4.5.0` 起可用，4.8.0 已包含）。
- "resume-or-start" 模式（先 `resumeHook`，抛 `HookNotFoundError` 再 `start`）被官方明确标注 **非原子**："there is a small window where a race condition is possible. A better native approach is being worked on"（`docs/api-reference/workflow-errors/hook-not-found-error.mdx`）。
- **对流水线的含义**：Folo webhook 重复投递时，若无调用方侧去重，会创建多个 run。依赖 hook token 去重仅覆盖 run 存活期间；run 完成（`completed`/`failed`/`cancelled`）后 token 立即释放，跨 run 的长期去重仍需自有持久状态（见 §8）。

## 2. Step 重放语义（step replay）

**结论：step 是重放的原子单元。重放/恢复语义：workflow 从挂起点恢复时从头重放代码，已完成 step 的结果从事件日志缓存返回、不重执行。但这是重放语义，与重试不同——失败的 step 在重试时其函数体会重新执行（最多 `maxRetries` 次），`stepId` 只保证"该 run 内该 step 实例"的幂等键稳定，并不保证外部副作用只发生一次。workflow 函数体重放必须确定性。**

- Workflow 从挂起点恢复时，从头重放代码，用事件日志中的 **cached step results** 续命：step 已执行 → 直接从日志返回缓存结果；未执行 → 挂起、入队后台执行、完成后再重放续行（`docs/how-it-works/understanding-directives.mdx`："Workflows resume from suspension by replaying their code using cached step results from the event log"）。
- Step 的输入/输出分别持久化于 `step_created`/`step_completed` 事件（序列化后），`stepId` 为 correlation ID，跨重试与跨重放稳定（`docs/how-it-works/event-sourcing.mdx`）。
- **重放 ≠ 重试**：`docs/foundations/idempotency.mdx` 明确指出，外部副作用可能"已成功但确认响应丢失"——此时 step 会重试并**再次执行函数体、再次调用外部 API**；官方给出的防护是把 `stepId` 作为第三方 API 的幂等键（跨该 step 的多次尝试稳定且唯一）。但 `stepId` 只在该 run 内对该 step 实例唯一，**不能**跨重复 run 去重（每个 run 有自己的 stepId）；且若外部 API 未按键去重或确认确实丢失，副作用仍可能重复。重放缓存只保证 workflow 重放不重跑已完成 step，不保证业务副作用恰好一次。
- 确定性由沙箱保证：workflow 函数体内 `Math.random`、`Date` 构造等在重放间固定；`setTimeout`/`setInterval` 被禁用（须用 `sleep`）（`docs/foundations/workflows-and-steps.mdx`、`docs/errors/timeout-in-workflow.mdx`）。
- 重放分歧（replay divergence）是运行时信号而非业务错误：单次分歧自动排队重放，不写 `run_failed`；重试预算耗尽后 run 以 `CORRUPTED_EVENT_LOG` 失败（`docs/errors/replay-divergence.mdx`）。
- 4.8.0 增加 step hydration cache，避免每次重放重复解密/反序列化已完成的 step 结果（`node_modules/@workflow/core/dist/runtime/step-hydration-cache.js`）——只影响性能，不影响语义。

## 3. 重试 / 退避 / 超时（retries / backoff / timeouts）

**结论：step 默认最多 3 次重试（共 4 次尝试），无默认退避；退避需用 `RetryableError.retryAfter` 自行实现；平台速率限制自动带退避重试。**

- 默认：step 内任意未捕获错误重试，最多 **3 次**（`maxRetries = 3`，即最多执行 4 次）；`fn.maxRetries = N` 可改；`maxRetries = 0` 表示只跑一次不重试（`docs/foundations/errors-and-retries.mdx`）。
- 错误分类：
  - 普通 `Error` → 重试，失败后 **立即重新入队**（"Steps get enqueued immediately after a failure"），无内置退避。
  - `FatalError` → 不重试，直接失败（`docs/api-reference/workflow/fatal-error`）。
  - `RetryableError` → 重试，且可带 `retryAfter`（时长字符串 / 毫秒 / `Date`）指定延迟（`docs/api-reference/workflow/retryable-error.mdx`）。
- 指数退避需自行实现，官方示例即用 `retryAfter: (metadata.attempt ** 2) * 1000`，其中 `getStepMetadata().attempt` 提供尝试次数（`docs/foundations/errors-and-retries.mdx`）。
- 平台速率限制：来自部署的请求超限时**自动重试并退避**，包括 `start()` 首次请求——只要 `start()` 未抛错，run 最终会启动并跑完或失败，不会因限流丢任务（https://vercel.com/docs/workflows/pricing → "Rate limits"；Hobby 100k/分、Pro 1M/分、Enterprise 5M/分）。
- 超时边界：
  - 单个 step 运行时上限 = Vercel Functions 限制：Hobby 最长 300s；Pro/Enterprise 默认 300s、最大 800s、Extended 最大 1800s（需 Fluid + 函数级配置）（https://vercel.com/docs/functions/limitations）。
  - Max workflow replay duration **240s**（一次重放不得超过，超长 run 会被拆分或降速，>2,000 事件或 >1GB 实体存储时重放更慢）（https://vercel.com/docs/workflows/pricing）。
  - 最大 run 总时长：**无限制**；最大 `sleep` 时长：**无限制**。
- 失败错误码：`USER_ERROR`（业务/step 抛错）与 `RUNTIME_ERROR`（事件日志损坏等运行时内部错误），可在 `run.returnValue` 的 `WorkflowRunFailedError.cause.code`、CLI `inspect` 的 `error.code`、OTEL span attribute `workflow.error.code` 读取（`docs/foundations/errors-and-retries.mdx`）。

## 4. 并发（concurrency）

**结论：Vercel 平台并发上限极高（30,000–100,000+），run 内可用 `Promise.all` 并行 step；4.x 单区域（iad1）。**

- 平台并发：Vercel Functions 自动扩到 Hobby/Pro 30,000、Enterprise 100,000+（https://vercel.com/docs/functions/limitations）；Workflows 平台限制表写 "Concurrency up to 100,000"（https://vercel.com/docs/workflows/pricing）。
- run 内并行：`Promise.all` 可同时执行多个 step（`sleep`、webhook promise 同样可并行）；`Promise.race` 可用于首个完成即停（`docs/foundations/common-patterns.mdx`）。
- 每 run 配额：事件 ≤25,000、step ≤10,000、事件创建 200/s、run 创建 1,000/s、hook 创建 200/s；排队中的 run 无上限（https://vercel.com/docs/workflows/pricing）。
- **区域（4.x 关键限制）**：Vercel Workflows 多区域要求 `workflow@5.0.0-beta.33+`；**4.x 创建的 run 固定落在 `iad1`**，应用部署在其他区域时工作流请求会路由到 `iad1`（https://vercel.com/docs/workflows → "Version and migration"；`docs/deploying/world/vercel-world.mdx` "Single-region deployment"）。当前版本 4.8.0 无多区域能力。
- 投递语义：Vercel 队列为 **at-least-once**，多个 lambda 可能并发处理同一 run 的事件（`docs/changelog/resilient-start.mdx`）；step 依赖队列 idempotency 避免过度入队（`runtime.js` 注释），wait 完成被保证**恰好一次**（`wait_completed` 原子转换，`docs/how-it-works/event-sourcing.mdx`）。恰好一次的**端到端**处理不在平台保证内——这正是 §8 持久状态的缺口。

## 5. 输入输出序列化与大小（serialization & size limits）

**结论：devalue 序列化，覆盖 JSON + 常见 Web API 类型；不支持函数/symbol/WeakMap；50MB 载荷上限与若干命名/流配额。**

- 序列化器基于 devalue（`docs/foundations/serialization.mdx`）。支持：`string/number/boolean/null/undefined/bigint`、普通对象/数组、`Date`、`RegExp`、`URL`、`URLSearchParams`、`Map`、`Set`、`Headers`、`ArrayBuffer`、typed arrays、`Request`、`Response`、`ReadableStream`、`WritableStream`。**不支持**：函数、Symbol、`WeakMap`/`WeakSet`（skill://workflow 同述）。
- 自定义类：实现 `@workflow/serde` 的 `WORKFLOW_SERIALIZE`/`WORKFLOW_DESERIALIZE` 静态方法后可通过边界（`docs/foundations/serialization.mdx` "Custom Class Serialization"）。
- 参数**按值传递**：step 内修改不会反映回 workflow，须显式 return（pass-by-value semantics，`docs/foundations/workflows-and-steps.mdx`）。
- 大小限制（https://vercel.com/docs/workflows/pricing "Workflow run limits"）：
  - Max payload size **50 MB**
  - 每 run 实体存储上限 **2 GB**（>2,000 事件或 >1GB 时重放变慢，官方建议拆 child workflows）
  - Max stream chunk 10 MB、每流每秒 ≤1,000 chunk、流存储无上限
  - Hook token ≤255 字节、workflow name ≤255 字节、step name ≤255 字节
- 另注意：Vercel Function HTTP 请求/响应体上限 **4.5 MB**（https://vercel.com/docs/functions/limitations "Request body size"）——webhook 入口（`createWebhook` 的 `/.well-known/workflow/v1/webhook/:token` 路由）收到的 HTTP body 受此限制，与 Workflow 的 50MB 载荷上限是两层不同限制。

## 6. 运行历史中的数据暴露（run-history data exposure）

**结论：Vercel 上事件日志端到端加密（AES-256-GCM，按 run 派生密钥）；明文仅元数据；解密权限与项目环境变量一致并记入审计日志；存储保留期 Hobby 1 天 / Pro 7 天 / Enterprise 30 天。**

- 事件日志记录所有状态迁移：`run_created`（输入参数）、`run_completed`（返回值）、`step_created`（输入）、`step_completed`（输出）、`step_failed`/`step_retrying`（错误）等（`docs/how-it-works/event-sourcing.mdx`）。即**每次 step 的输入/输出都会写入运行历史**，任何人若可读事件且可解密即可看到全部数据。
- 加密（`docs/how-it-works/encryption.mdx`，https://vercel.com/docs/workflows）：Vercel World 提供 `getEncryptionKeyForRun()`，按 run 与环境派生唯一密钥（HKDF）；存储层只见密文。**不加密**的是元数据：workflow/step 名称、实体 ID、时间戳、生命周期状态。
- 解密权限：与"查看项目环境变量值"同一权限模型；每次解密请求记录进 Vercel audit log；Web UI 的 Decrypt 在浏览器内用 Web Crypto 完成，观测服务器不接触明文；CLI 用 `--decrypt` 标志（`docs/observability/index.mdx`、`docs/how-it-works/encryption.mdx`）。
- 保留期（https://vercel.com/docs/workflows/pricing "Storage retention"）：run 完成后 Hobby 1 天、Pro 7 天、Enterprise 30 天；默认不可配置（可联系支持定制）。事件计费：Hobby 含 50,000 事件/月，超出 $0.02/1K；数据写入 $0.50/GB；保留 $0.50/GB-月。
- 程序化读取：`getWorld()` → `world.runs/steps/events/hooks.list`，`resolveData: 'all'|'none'` 控制是否带回 I/O；带 `'all'` 时数据仍是 devalue 序列化，需 `hydrateResourceIO()` 还原（`docs/api-reference/workflow-runtime/world/storage.mdx`）。
- **对流水线的含义**：Cubox 保存后的文章 URL、BibiGPT 字幕、webhook 原文都会出现在事件日志（密文）。若管道内传递敏感凭据（BibiGPT token 等），应只注入到 step 内环境变量并避免写入参数/返回值。

## 7. 部署监控（deployment monitoring）

**结论：Vercel 控制台内置 Workflows 观测页（无需额外代码），CLI 可深链到具体 run；run 默认钉在启动它的 deployment（skew protection）。**

- Vercel dashboard → **Observability → Workflows**：每个 step、输入、输出、sleep、错误自动记录，可实时跟踪 run、追踪失败、分析性能（https://vercel.com/docs/workflows → "Observability"；https://vercel.com/docs/workflows/concepts）。工作流函数入口经 `.vc-config.json` 的 `experimentalTriggers` 仅对 Vercel Queues 可达，无需自加鉴权（`docs/deploying/world/vercel-world.mdx` "Consumer function security"）。
- CLI 观测：`npx workflow inspect runs|run <id> --backend vercel --project <p> --team <t>`；`--web` 打开浏览器深链、`--url` 打印 `https://vercel.com/<team>/<project>/workflows/runs/<runId>?environment=production|preview`（`docs/observability/index.mdx`、skill://workflow）。通用函数观测（route 级错误率/延迟/日志，`/.well-known/workflow` 路由）走 https://vercel.com/docs/observability。
- OTEL：SDK 生成 span（如 `workflow.start <name>`），属性含 workflow name、runId、deploymentId、`workflow.error.code`（`node_modules/@workflow/core/dist/runtime/start.js`、`docs/foundations/errors-and-retries.mdx`）。
- 部署/版本：run 默认钉在启动它的 deployment；新部署不影响在途 run（重放/重试/挂起都续在旧 deployment）；`deploymentId: "latest"` 可显式在新 deployment 重跑（Vercel 专属特性）；长期任务建议"显式递归 start" 分段升级（`docs/foundations/versioning.mdx`、https://vercel.com/docs/workflows/concepts "Skew Protection"）。

## 8. 跨独立 webhook 去重仍需的持久状态（the persistent-state gap）

**结论：Workflow 平台不提供端到端恰好一次；跨独立 webhook（at-least-once 投递、并发 fan-in）的去重必须由调用方持有最小持久状态。现有可用的原生手段是 hook token 独占，但它只在 run 存活期内有效。**

已确认的能力与缺口：

1. `start()` 无去重键 → 重复 webhook 调用会创建重复 run（§1）。
2. 官方 "resume-or-start" 模式**非原子**，存在竞态窗口，官方明言原生方案仍在开发（`docs/api-reference/workflow-errors/hook-not-found-error.mdx`）。
3. hook token（确定性 token + `hook.getConflict()`/`HookConflictError`）可覆盖"并发重复投递时只让一个 run 干活"：重复 run 在 `run_created` 后、首次挂起时（`hook.getConflict()` 提交注册）收到 `hook_conflict`，可 `{ dedupedTo: conflict.runId }` 退出或委托给 active run（`docs/api-reference/workflow/create-hook.mdx`、`docs/errors/hook-conflict.mdx`）。**但** token 在 run 进入终态（completed/failed/cancelled）时立即释放——**跨 run 的长期去重（如"这个 URL 已在历史上处理过"）不在 hook 机制覆盖内**。
4. 队列 at-least-once + 并发处理（§4）意味着"一次投递只触发一次副作用"需要管道自身保证。

**因此：跨独立 webhook 去重仍需的最小持久状态是调用方数据库中以业务事件为键的原子幂等 claim**（如按规范化 URL / 事件 ID 的唯一键），与地图既有决策一致（"Sortify 只长期保留最小幂等状态"）。该 claim 必须同时解决以下几点（前三点为官方文档证实的能力边界，最后一点为据此的设计要求）：

- **原子性要求（claim 时机与未知结果）**：`start()` 无去重键、非幂等（§1），官方 "resume-or-start" 非原子（上文第 2 点）。若在 `start()` 之前插入唯一键行，调用方崩溃或 `start()` 响应丢失（结果未知）时该行可能永远停在 `claimed`；对结果未知的 `start()` 盲目重试会**创建第二个 run**（无 dedup key 拦截，除非 run 内的 hook token 竞态检测兜底捕获）。
- **状态/租约/对账（或首步 claim）**：claim 行需要状态机（claimed → processing → done/failed）、租约（owner + 超时）与对账/补偿来恢复停滞条目；或改为**工作流首个 step 内部 claim**（first-step claim：把唯一键写入放在 run 的第一个 step）。注意首步 claim 仍必须落到**调用方数据库中带唯一约束的原子写入**——重复 run 各有独立事件日志，Workflow 的持久化/step 缓存**不会**在 run 之间仲裁"谁拥有该事件"，只有 DB 唯一约束能裁决胜者；`hook.getConflict()` 仅作为"仍有 run 存活"时的附加并发护栏，不能替代 DB 约束。
- **外部副作用需要跨 run 的键**：`stepId` 仅在同一 run 内稳定且唯一（§2），跨重复 run 去重外部副作用（如调用 Cubox/BibiGPT）必须使用**业务级幂等键**（如规范化 URL），作为第三方 API 的 idempotency key 传入。
- **事件日志不是完整审计**：Workflow 事件日志有保留期（Hobby 1 天 / Pro 7 天 / Ent 30 天，§6），到期即不可查；"这个 URL 已处理过"这类长期事实必须落在调用方持久状态中，不能依赖事件日志。

建议形态 [INFERENCE，基于上述文档边界]：webhook 入口先做规范化 URL 唯一约束/条件插入（原子 claim，带状态/租约与对账，或由 run 首步 claim），命中则返回已处理、未命中才 `start()`；run 内以确定性 hook token（如 `url:<sha256>`）兜底并发竞态；所有外部副作用使用同一业务级幂等键；无需持久化整个运行状态。

---

## 摘要表（对当前流水线的直接结论）

| 问题 | 4.8.0 + Vercel 的保证 | 缺口 |
|---|---|---|
| 启动幂等 | 启动路径本身可靠（resilient start），但 `start()` 无 dedup key | 重复投递产生重复 run；须调用方去重或 hook token |
| Step 重放 | 重放/恢复时已完成 step 结果缓存于事件日志、不重执行；确定性沙箱 | 重试时 step 体会重执行，外部副作用须靠 `stepId`（仅 run 内）/业务幂等键；重放分歧超预算 → `CORRUPTED_EVENT_LOG` |
| 重试/退避 | 默认 3 次重试；`FatalError` 不重试；`RetryableError.retryAfter` 控制延迟；平台限流自动退避 | 无内置指数退避（自行实现）；step 时长受 Functions 限制（Hobby 300s / Pro 800–1800s）；单次重放 ≤240s |
| 并发 | 平台并发 30k–100k+；`Promise.all` 并行 step；每 run 25k 事件/10k step | **4.x 单区域 iad1**；at-least-once 无端到端恰好一次 |
| 序列化/大小 | devalue；载荷 ≤50MB；run 实体 ≤2GB；step/hook 名 ≤255B；流 chunk ≤10MB | 函数 HTTP body 另有 4.5MB 限制；不支持函数/Symbol |
| 历史数据暴露 | 端到端 AES-256-GCM 按 run 加密；元数据明文；解密权限=环境变量权限+审计 | 保留期短（Hobby 1 天 / Pro 7 天 / Ent 30 天）；所有 step I/O 都在密文日志中 |
| 部署监控 | 控制台 Workflows 页 + CLI 深链 + OTEL；run 钉 deployment（skew protection） | 多区域需 5.x |
| 跨 webhook 去重 | hook token 独占可兜底 run 存活期并发竞态 | "resume-or-start" 非原子；`start()` 无去重键，未知结果盲重试会建新 run；须原子 claim（按 URL 唯一键）+ 状态/租约/对账（或首步 claim）+ 业务级外部副作用键；事件日志有保留期、非长期审计 |
