# 查清 BibiGPT 完整字幕 API 契约

Ticket: [查清 BibiGPT 完整字幕 API 契约](https://github.com/chessl/sortify/issues/3)

Sources（均为官方主源）: `https://docs.bibigpt.co/api-reference/introduction`（intro）、`https://api.bibigpt.co/api/openapi.json`（OpenAPI，单一事实源）、各端点文档页（getSubtitle / summarize / summarizeWithConfig / createSummaryTask / getSummaryTaskStatus / expandUrl / /v1/me / Whisper 兼容转写）、产品/技术支持文档（B站字幕提取、自定义转录引擎、错误处理指南、FAQ、支持的平台、定价）。除标注 `[INFERENCE]` 或「未实测/未知」外，均为文档可直接证实的契约事实。账户/UI 观测见 §9（人工确认记录：[issue #13](https://github.com/chessl/sortify/issues/13)）。

---

## 0. 一句话结论

**「完整字幕」可以直接取得，不是摘要替代。** 官方提供专用字幕端点 `GET /api/v1/getSubtitle`：一次（同步）调用即返回按时间轴对齐的完整字幕数组（每条含起止秒、文本、序号，可含逐词时间戳与说话人 id），且不经过 LLM、比总结快；`summarize` / `summarizeWithConfig` 端点带 `includeDetail=true` 时也返回同一份 `detail.subtitlesArray`。对无官方字幕的内容，产品文档声称有自动 AI 转录兜底（API 侧契约未证实，见 §6），另有 Whisper 兼容的音频转写端点（其 200 响应 schema 未定义，见 §6）。摘要与字幕是两个独立的产出，字幕可直接取。

## 1. 认证（authentication）

- 所有 `/v1/*` 端点以 `Authorization: Bearer <api_token>` 头认证；OpenAPI `securitySchemes.Authorization` 为 `http` + `bearer`（[OpenAPI](https://api.bibigpt.co/api/openapi.json)）。
- intro 原文：「All API endpoints are authenticated using `api_token` token in the HTTP header or picked up from the endpoint directly」（[intro](https://docs.bibigpt.co/api-reference/introduction)）。`/v1/*` 端点统一走 header。「from the endpoint directly」的准确含义官方未进一步说明；[INFERENCE] 文档中唯一「token 在路径里」风格端点是旧式 `/api/open/[apiToken]/chat`（标注「即将下线」，[intro](https://docs.bibigpt.co/api-reference/introduction)），两者可能对应，未证实。
- 专属 token 的获取位置由官方文档指定：登录后访问 `https://bibigpt.co/user/integration`；购买时长额度在 `https://bibigpt.co/shop`（[intro](https://docs.bibigpt.co/api-reference/introduction)）。该页面 UI（Open API / Copy API Token / 重置 API / API Balance 展示）已经账号本人人工确认，见 §9 与 [issue #13](https://github.com/chessl/sortify/issues/13)。
- `getSubtitle` 额外接受 query 参数 `apiKey`（string，OpenAPI 有定义但未说明用途）。[INFERENCE] 结合「自定义转录引擎」文档（用户可带自己的 ElevenLabs key 调用转录），`apiKey` 疑似第三方转录引擎的 key，而非账户 token；未实测确认。
- Whisper 兼容端点 `POST /api/v1/audio/transcriptions` 另声明两种安全方案：`ApiKeyAuth`（header `Authorization: Bearer`）与 `OAuth2`（authorization code，authorize/token 端点），[端点文档](https://docs.bibigpt.co/api-reference/transcribes-an-audio-file-into-text)。

## 2. 提交与取回流程（submit / retrieve）

- **字幕专用（同步）**：`GET /api/v1/getSubtitle?url=<video-url>`，必填 query 仅 `url`；可选 `audioLanguage`、`transcribeProvider`、`whisperPrompt`、`apiKey`、`enabledSpeaker`（[端点 OpenAPI](https://docs.bibigpt.co/api-reference/open/only-returns-the-video-subtitles-array-in-detail)）。intro：「相比于总结接口，由于少了请求 LLM 的时间，所以会快很多」（[intro](https://docs.bibigpt.co/api-reference/introduction)）。
- **总结（同步）**：`GET /api/v1/summarize?url=&includeDetail=`（[端点 OpenAPI](https://docs.bibigpt.co/api-reference/open/generate-video-or-audio-summary-from-url)）；`POST /api/v1/summarizeWithConfig`，body 支持 `url`、`includeDetail`、`promptConfig{...}`（含 `customPrompt`、`outputLanguage`、`isRefresh`、`skipSave` 等）、`videoDetail`（复用已有详情）、`providedSubtitle`（自带字幕数组）等（[端点 OpenAPI](https://docs.bibigpt.co/api-reference/open/generate-configurable-summary-from-url-based-on-prompt-config)）。
- **异步任务**：`GET /api/v1/createSummaryTask?url=` → `{success, taskId, status, message, summary}`；随后轮询 `GET /api/v1/getSummaryTaskStatus?taskId=&includeDetail=`，完成时返回与 `summarize` 相同的响应结构（含 `detail.subtitlesArray`，若 `includeDetail=true`）（[createSummaryTask](https://docs.bibigpt.co/api-reference/open/submit-video-summary-processing-task)、[getSummaryTaskStatus](https://docs.bibigpt.co/api-reference/open/check-task-status-and-get-result-if-completed)）。
- **缓存**：`promptConfig.isRefresh=true` 时忽略缓存重新生成；默认命中缓存（[intro](https://docs.bibigpt.co/api-reference/introduction)）。
- **文件直链**：`/v1/summarize` 也接受「可直接访问」的音视频文件下载 URL（如 `.mp3` 结尾），支持 `mp3|mp4|m4a|m4s|wav|webm|mpga|aac|ogg|oga|flac|alac|wma|avi|mkv|mov|flv|3gp|mpeg|mpg|ts|ogv|vob`（[intro](https://docs.bibigpt.co/api-reference/introduction)）。本地文件需先上传 OSS 再给下载链接。

## 3. 同步 / 异步语义（sync vs async）

- `getSubtitle` 是同步、短平快请求（无 LLM），官方未公布具体超时上限 → 超时数值未知。
- 总结类端点两条路都提供：同步 GET/POST，或 `createSummaryTask` + `getSummaryTaskStatus` 轮询（异步）。
- `getSummaryTaskStatus` 完成分支的响应与 `summarize` 顶层同构（`success/id/service/sourceUrl/htmlUrl/summary/costDuration/remainingTime` + `detail`）；未完成分支为 `{success, taskId, status, message, summary}`。
- `status` 字段的合法枚举值（如 pending/processing/completed/failed）OpenAPI 未列出，本会话未实测 → 未知。

## 4. 响应结构（response shape，含完整字幕字段）

顶层（`required`：`success, id, service, sourceUrl, htmlUrl, costDuration, remainingTime`；可选 `summary, billingNote, detail`）：
`{ success: bool, id: string, service: string, sourceUrl: string, htmlUrl: string, summary?: string, costDuration: number, remainingTime: number, billingNote?: string, detail?: … }`（[getSubtitle OpenAPI](https://docs.bibigpt.co/api-reference/open/only-returns-the-video-subtitles-array-in-detail)）。

`detail` 为二选一：

- **A. 平台视频详情对象**（`required: id, url, type, title, duration`）：含 `type`（枚举 `bilibili | youtube | podcast | douyin | tiktok | wechat-channels | online-media | url-media | import-file | local-video | local-audio | record-audio | local-subtitle | webpage | meeting`）、`rawLang`、`translationUrls[{code,url}]`、`audioUrl`、`playUrl`、`cover`、`author`、`authorId`、`publishedDate`、**`subtitlesArray`**、`descriptionText`/`contentText`、`aiImages[{startTime,endTime,image,prompt}]`、`chapters[{from,to,content,type,imgUrl}]`、`status`、`isPaid`、`isPreviewOnly`、`sourceLevel`（枚举 `guest | authenticated | transcribed`）。
- **B. 原始媒体对象**（`required: audioUrl, title, cover, duration, description, format, content, rawUrl, rawHtml`）：含 `playUrl`、`videoUrl`、**`subtitleUrl`**、**`subtitlesArray`**、`chapters` 等。

**`subtitlesArray` 条目字段**（`required: startTime, end, text, index`；可为 `null`）：
```
{ startTime: number(秒, 如 53.58), end: number(秒, 如 65.08), text: string,
  index: number, words?: [{start, end, text, punctuation}],
  speaker_id?: number|null, _isGrouped?: boolean, _originalSubtitles?: [] }
```
即：**完整字幕逐条可取，含起止时间与逐词时间戳（words），可选说话人分离（speaker_id / enabledSpeaker）**。全部字段定义见 [getSubtitle OpenAPI](https://docs.bibigpt.co/api-reference/open/only-returns-the-video-subtitles-array-in-detail)。

## 5. 支持的域名与短链（platforms & short links）

- `type` 枚举共 **15** 个值：bilibili、youtube、podcast、douyin、tiktok、wechat-channels、online-media、url-media、import-file、local-video、local-audio、record-audio、local-subtitle、webpage、meeting（[getSubtitle OpenAPI](https://docs.bibigpt.co/api-reference/open/only-returns-the-video-subtitles-array-in-detail)）；官方平台文档另列出 B站、YouTube、抖音、快手、小红书、西瓜、头条、可灵、优酷、TikTok、Instagram、Lemon8、喜马拉雅、小宇宙、Apple Podcasts、Spotify、Coursera、TED、Twitter 视频、Substack 等（[支持的平台](https://docs.bibigpt.co/getting-started/bibigpt-supported-platforms)）。API 文档示例均为标准域名：`https://www.youtube.com/watch?v=...`、`https://www.bilibili.com/video/BV...`（[intro](https://docs.bibigpt.co/api-reference/introduction)）。
- **短链展开**：专用端点 `GET /api/v1/expandUrl?url=` → `{url, costDuration, remainingTime}`（[expandUrl OpenAPI](https://docs.bibigpt.co/api-reference/open/expand-shortened-video-or-audio-urls)）。
- B站多P：需在 URL 中带 `?p=` 参数，否则默认取第一 P（[B站字幕工具文档](https://docs.bibigpt.co/function-usage/platform-function/bilibili-subtitle-downloader)，产品文档）；BV/AV/手机端链接均支持（同上）。

## 6. 字幕可用性（transcript availability）

- `subtitlesArray` 的 schema 为 `array | null`（[getSubtitle OpenAPI](https://docs.bibigpt.co/api-reference/open/only-returns-the-video-subtitles-array-in-detail)）→ 对抓不到字幕的内容可返回 `null`；具体触发条件官方未说明。[INFERENCE] 结合 `sourceLevel`（`guest|authenticated|transcribed`）推测：`guest`=平台公开字幕直接抓取、`authenticated`=需登录态抓取、`transcribed`=AI 转录生成；逐字段语义官方未给出，未实测。
- **语言**：默认自动检测音频语言产出中/英字幕；自动检测可能失效（或命中缓存），此时手动指定 `audioLanguage`（`auto|zh|en|ja|yue|ko|de|fr|ru`；`pt/ar/it/es/hi/id/th/tr/uk/vi` 需联系商务）（[intro](https://docs.bibigpt.co/api-reference/introduction)）。
- **无字幕兜底（产品文档，非 API 契约）**：官网工具页明确「对于没有官方字幕的视频，系统会自动调用 AI 语音转文字引擎生成字幕，覆盖率极高」（[B站字幕提取](https://docs.bibigpt.co/function-usage/platform-function/bilibili-subtitle-downloader)）——这是产品能力说明，**不能据此证明 `getSubtitle` 内部会自动触发转录** [INFERENCE 边界]。API 侧仅暴露参数：`transcribeProvider`、`whisperPrompt`、`enabledSpeaker`（[getSubtitle OpenAPI](https://docs.bibigpt.co/api-reference/open/only-returns-the-video-subtitles-array-in-detail)），但 `transcribeProvider` 的取值映射官方未文档化；「自定义转录引擎」产品文档提到引擎可在 OpenAI Whisper 与 ElevenLabs Scribe 间选择、可带用户自己的 key（[自定义转录引擎](https://docs.bibigpt.co/function-usage/integration-extension/custom-transcription-engine)），同样未给出 API 参数值 → 均属未实测未知。
- **Whisper 兼容兜底**：`POST /api/v1/audio/transcriptions`（multipart 上传音频文件），请求侧定义 `response_format: text|json|verbose_json|srt|vtt` 与 `timestamp_granularities`（[端点文档](https://docs.bibigpt.co/api-reference/transcribes-an-audio-file-into-text)）；**但该端点 200 响应未定义 schema**，契约上无法保证 SRT/VTT 输出内容，「兼容 OpenAI Whisper API 格式」为文档自述 → 可作参考路径，落地前需实测。
- 说明：以上「自动 AI 转录/字幕提取工具」为官网产品能力文档；与 API 端点的映射（如 getSubtitle 内部是否自动触发转录）未公开、未实测 → 标注为产品文档佐证而非 API 契约。

## 7. 长度 / 时限 / 配额 / 限流（limits, quotas, rate limits）

- **计费配额**：`summarize` / `summarizeWithConfig` / `getSubtitle` / `getSummaryTaskStatus`（完成分支）/ `expandUrl` 的 200 响应带 `costDuration`（本次消耗）与 `remainingTime`（剩余），且均为 `required` 顶层字段（[各端点 OpenAPI](https://api.bibigpt.co/api/openapi.json)）；**`createSummaryTask` 的立即响应不含这对字段**（仅 `success/taskId/status/message/summary`，[端点 OpenAPI](https://docs.bibigpt.co/api-reference/open/submit-video-summary-processing-task)）。单位官方未明确（[intro](https://docs.bibigpt.co/api-reference/introduction) 的 express 示例为 `costDuration: 600, remainingTime: 3000`，秒/分钟均可能）→ 单位未知；[INFERENCE] `/v1/me` 返回 `remainingMinutes`（分钟），两者单位可能一致（未实测确认）。账户级：`GET /api/v1/me` → `{userId, email, plan{tier: free|plus|pro|lifetime, isPaidMember, expiresAt}, remainingMinutes}`（[端点 OpenAPI](https://docs.bibigpt.co/api-reference/agent/get-current-account-plan-and-remaining-minutes)）。
- **时长上限**：`limitation.maxDuration` 设置后，若 URL 对应音视频超过该时长则返回 **422** 错误——该说明仅见于 [intro](https://docs.bibigpt.co/api-reference/introduction) 文字（示例为 `summarizeWithConfig` 的 POST body）；OpenAPI 各端点错误响应仅列 400/401/403/404/500，**无 422 响应体 schema**。
- **免费额度**：注册送 120 分钟免费体验时长（[定价文档](https://docs.bibigpt.co/subscription/bibigpt-subscription-options-and-pricing)）。
- **本地文件**：单文件 2GB 上限（[支持的平台](https://docs.bibigpt.co/getting-started/bibigpt-supported-platforms)）；API 文件直链格式列表见 §2。
- **限流**：官方 FAQ——短时间内请求过多会触发保护机制（提示「网站暂不支持服务端处理」），建议稍后重试、优先使用完整原始链接、分批处理（[FAQ](https://docs.bibigpt.co/technical-support/faq)）。**无公开数值**（QPS/每分钟上限）→ 数值未知。
- **超时**：长视频转录可能被服务器自动取消（超时/资源），官方建议把长文件分段处理（[错误处理指南](https://docs.bibigpt.co/technical-support/bibigpt-technical-issues-error-handling-guide)）；API 侧无明确超时数值 → 未知。

## 8. 错误类别与重试建议（errors & retry）

- OpenAPI 错误体：`{message: string, code: string, issues?: [{message}]}`；各端点列出 `400 BAD_REQUEST`（参数错）、`401 UNAUTHORIZED`（未提供认证）、`403 FORBIDDEN`（权限不足）、`404 NOT_FOUND`、`500 INTERNAL_SERVER_ERROR`（[getSubtitle OpenAPI](https://docs.bibigpt.co/api-reference/open/only-returns-the-video-subtitles-array-in-detail)）。另有 `422`：仅 [intro](https://docs.bibigpt.co/api-reference/introduction) 文字提及（`limitation.maxDuration` 超限场景，示例为 summarizeWithConfig），OpenAPI 无 422 响应体 schema。
- 官方重试建议（[错误处理指南](https://docs.bibigpt.co/technical-support/bibigpt-technical-issues-error-handling-guide)）：400 → 检查参数/路径是否符合文档；500 → 服务器瞬时过载，**稍后重试**；持续问题 → 联系 `hi@bibigpt.co` 并提供错误日志。限流触发（FAQ）→ 稍后重试、用完整链接、分批（[FAQ](https://docs.bibigpt.co/technical-support/faq)）。**无官方退避策略 / Retry-After 头规范** → 未知，建议保守指数退避 [INFERENCE，基于无规范]。

## 9. 集成页 UI 观测（经账号本人人工确认，[issue #13](https://github.com/chessl/sortify/issues/13)）

- 背景：本代理会话首次访问 `https://bibigpt.co/user/integration` 时页面渲染空白（`#__next` 恒空、无控制台错误/网络请求）；随后由账号本人在同一个 ego-browser 任务空间完成登录，页面正常渲染。渲染失败的根因未深究（登录态缺失为充分且已被后续登录修复的事实，见 [issue #13](https://github.com/chessl/sortify/issues/13)）。
- 已确认的页面事实（账号本人登录态下，Agent 仅读取非敏感 UI 状态核验，[issue #13](https://github.com/chessl/sortify/issues/13)）：
  - 页面正常渲染并显示 **Open API**；
  - 提供 **Copy API Token** 与 **重置 API** 操作；现有 Token 输入框为非空——**Token 内容未读取、未复制、未记录**；
  - 页面显示 **API Balance: 6851 minutes**（账号专属配额数值，仅作观测记录，非敏感）。
- 凭据处置：按 [issue #13](https://github.com/chessl/sortify/issues/13) 决议，Token 内容不进入聊天、议题、研究笔记或代码，后续仅写入 Vercel 环境变量。
- 影响：token 获取位置（[intro](https://docs.bibigpt.co/api-reference/introduction)）与页面 UI 均获确认；本笔记的 API 契约结论全部来自官方文档 + OpenAPI，不依赖页面渲染。剩余未知项见 §3/§6/§7 与摘要表。

## 摘要表（对流水线的直接结论）

| 问题 | 结论 | 依据 |
|---|---|---|
| 完整字幕可直接取得？ | **是**：`GET /v1/getSubtitle` 同步返回完整 `subtitlesArray`（含逐词时间戳、可选说话人），非摘要替代 | [getSubtitle OpenAPI](https://docs.bibigpt.co/api-reference/open/only-returns-the-video-subtitles-array-in-detail)、[intro](https://docs.bibigpt.co/api-reference/introduction) |
| 认证 | `Authorization: Bearer <api_token>`；token 取自 `/user/integration`（登录后） | [intro](https://docs.bibigpt.co/api-reference/introduction)、[OpenAPI](https://api.bibigpt.co/api/openapi.json) |
| 同步/异步 | getSubtitle 同步；总结类同步（GET/POST）或异步（createSummaryTask → 轮询 getSummaryTaskStatus）均可 | [各端点 OpenAPI](https://docs.bibigpt.co/api-reference/open/submit-video-summary-processing-task) |
| 响应结构 | 顶层 `success/id/service/sourceUrl/htmlUrl/summary/costDuration/remainingTime` + `detail.subtitlesArray[]`（`startTime/end/text/index/words/speaker_id`） | [getSubtitle OpenAPI](https://docs.bibigpt.co/api-reference/open/only-returns-the-video-subtitles-array-in-detail) |
| 平台与短链 | `type` 枚举 15 个值（bilibili/youtube/…/meeting）；短链用 `GET /v1/expandUrl` 展开 | [getSubtitle OpenAPI](https://docs.bibigpt.co/api-reference/open/only-returns-the-video-subtitles-array-in-detail)、[expandUrl](https://docs.bibigpt.co/api-reference/open/expand-shortened-video-or-audio-urls) |
| 字幕可用性 | `subtitlesArray` 可 null；`sourceLevel` guest/authenticated/transcribed；无字幕自动 AI 转录为产品文档（API 参数 `transcribeProvider`/`whisperPrompt` 取值未文档化）；`audioLanguage` 手动指定兜底 | [getSubtitle OpenAPI](https://docs.bibigpt.co/api-reference/open/only-returns-the-video-subtitles-array-in-detail)、[B站字幕工具](https://docs.bibigpt.co/function-usage/platform-function/bilibili-subtitle-downloader)、[intro](https://docs.bibigpt.co/api-reference/introduction) |
| 配额/限流 | `summarize/summarizeWithConfig/getSubtitle/getSummaryTaskStatus(完成)/expandUrl` 响应带 `costDuration/remainingTime`（`createSummaryTask` 立即响应除外）；`/v1/me` 给 `remainingMinutes`；`limitation.maxDuration` 超限 422（仅 intro 文字、无 schema）；有限流保护但无数值文档 | [intro](https://docs.bibigpt.co/api-reference/introduction)、[FAQ](https://docs.bibigpt.co/technical-support/faq)、[各端点 OpenAPI](https://api.bibigpt.co/api/openapi.json) |
| 错误与重试 | 400/401/403/404/500（+422）统一 `{message,code,issues}`；官方建议：400 查参数、500/限流稍后重试；无 Retry-After/退避规范 | [getSubtitle OpenAPI](https://docs.bibigpt.co/api-reference/open/only-returns-the-video-subtitles-array-in-detail)、[错误处理指南](https://docs.bibigpt.co/technical-support/bibigpt-technical-issues-error-handling-guide) |
| 未验证项 | `costDuration/remainingTime` 单位；`status` 枚举值；`sourceLevel` 语义；`apiKey`/`transcribeProvider` 参数取值映射；Whisper 端点 200 响应 schema（token 页面 UI 已经人工确认，见 §9） | 见 §3 / §6 / §7 / §9 |

---

**对 Sortify 流水线的含义（非实现，仅契约结论）**：字幕获取应优先走 `GET /v1/getSubtitle`（同步、快、不耗 LLM）；若需要摘要以外的完整逐字稿，`includeDetail=true` 的 summarize 响应与 getSubtitle 返回同一 `subtitlesArray` 结构，二者可互换；对无字幕内容依赖自动转录时需容忍 `null`/空结果并可用 `audioLanguage`/`transcribeProvider` 参数控制；限流与 500 按「稍后重试 + 保守退避」处理。
