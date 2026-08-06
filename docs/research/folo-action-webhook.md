# Folo Action Webhook 契约调研

关联问题:["查清 Folo Action 的 Webhook 契约"](https://github.com/chessl/sortify/issues/2)
调研日期:2026-08-07。目标:给"Sortify 本地图入站契约"决策提供已验证的 Folo Action Webhook 能力与限制。

> 阅读说明:事实分三级——**(文档)** 官方文档写明;**(源码)** 官方开源仓库/npm 包代码可见;**(UI 实测)** 在登录后的 `https://app.folo.is/action` 实际观察/网络抓包验证。**未知项**单独列节,均为官方未公开、无法验证的部分。全部来源 URL 见文末。

## 一句话结论

Folo Action 的 Webhook 是**固定契约的 outbound POST**:触发条件 = 用户规则(可配 feed/entry 字段过滤,如"标题含某词"或"收藏时"),方法固定 `POST`,`Content-Type: application/json` 固定,请求体为**固定 JSON 模板**(`{entry, feed, view}`,无任何用户自定义模板/变量),配置表面**只有 URL 列表**(无可配置请求头/鉴权字段、无超时/重试选项)。投递推测由 Folo 服务端执行(开源客户端中无投递代码,属推断)。超时、重试、去重、响应判定**官方均未文档化**。

## 已验证能力(Verified)

### 1. 触发条件(Trigger)

- Action 规则 = "WHEN FEEDS MATCH…" 条件 + "THEN DO…" 动作列表;Webhooks 是动作之一。**(UI 实测/源码)**
- 条件("when")两种模式:
  - **All**:无条件(condition 为空数组),UI 语义为"不做任何过滤"。**(UI 实测/源码** [when-section.tsx](https://github.com/RSSNext/Folo/blob/main/apps/desktop/layer/renderer/src/modules/action/when-section.tsx)**)** 服务端何时按新条目评估规则、是否逐条触发,官方未文档化(见未知项 7)。
  - **Custom Filters**:条件组(组内 AND,组间 OR;UI 提供 "And"/"Or" 按钮)。**(UI 实测/源码** [when-section.tsx](https://github.com/RSSNext/Folo/blob/main/apps/desktop/layer/renderer/src/modules/action/when-section.tsx)、[constant.ts](https://github.com/RSSNext/Folo/blob/main/packages/internal/store/src/modules/action/constant.ts)**;changelog 0.2.2 "And Or conditions for actions")**
- 可过滤字段(服务端校验枚举,见 [@folo-services/drizzle](https://www.npmjs.com/package/@folo-services/drizzle) 的 `actionsItemOpenAPISchema`,已核对发布版 0.1.47):`view`、`title`、`site_url`、`feed_url`、`category`、`entry_title`、`entry_content`、`entry_url`、`entry_author`、`entry_media_length`、`entry_attachments_duration`(视频时长,changelog 0.6.1 "Use video duration as an Action condition")、`status`。**(源码/changelog)**
- 运算符:`contains`、`not_contains`、`eq`、`not_eq`、`gt`、`lt`、`regex`。**(源码)**
- `status` 字段(changelog 0.4.4/0.1.7 "status action that allows you to send notifications or trigger webhooks for starred entries"):值为 `collected`(收藏/starred),即**收藏条目时也可触发 webhook**,不限于新条目。**(文档/changelog** [0.4.4](https://github.com/RSSNext/Folo/blob/main/apps/desktop/changelog/0.4.4.md)、[0.1.7](https://github.com/RSSNext/Folo/blob/main/apps/mobile/changelog/0.1.7.md)**)**
- 规则持久化在服务端:客户端通过 `GET/PUT https://api.folo.is/actions` 同步规则(实测 PUT 请求体 `{"rules":[{name, condition, result, index}]}`,成功返回 204;见 [@follow-app/client-sdk](https://www.npmjs.com/package/@follow-app/client-sdk) actions module)。**(UI 实测/源码)** 投递因此发生在 Folo 服务端(客户端源码中不存在任何 webhook 投递逻辑;payload 含服务端抓取状态字段 `lastModifiedHeader`/`etagHeader`/`checkedAt`,也佐证服务端构造)。**(源码/推断)**

### 2. HTTP 方法与请求头

- 方法:**`POST`**。**(文档** [wiki/Actions](https://github.com/RSSNext/Folo/wiki/Actions)**)**
- 固定请求头:**`Content-Type: application/json`**。**(文档 wiki)**
- **无可配置请求头;Authorization/签名机制官方未文档化且 UI 不可配置**:Webhook 配置面只有 URL 输入框(`placeholder="https://"`),桌面端与移动端一致。**(UI 实测/源码** [then-section.tsx](https://github.com/RSSNext/Folo/blob/main/apps/desktop/layer/renderer/src/modules/action/then-section.tsx)、[EditWebhooks.tsx](https://github.com/RSSNext/Folo/blob/main/apps/mobile/src/modules/settings/routes/EditWebhooks.tsx)**)**
- 对接收端(Sortify)的含义:入站鉴权只能依赖 URL 本身携带的秘密(如路径/query 中的 token);Folo 侧无法配置 header 型密钥,请求头是否会携带额外内容官方未文档化。**(推断,基于配置面只有 URL)**

### 3. 请求体模板与字段(Payload)

- 请求体为**固定结构,无用户可定制模板/变量**(配置里只有 URL)。**(UI 实测/源码)** 官方类型(文档 wiki):

```ts
type WebhookPayload = {
  entry: {
    id: string;            // Folo 内部条目 ID
    publishedAt: Date;     // 线上编码格式未文档化,见下方说明
    insertedAt: Date;
    feedId: string;
    title: string | null;
    description: string | null;
    content: string | null;
    author: string | null;
    url: string | null;
    guid: string;          // 源 feed 的条目 GUID
    media: { url: string; type: "photo" | "video"; preview_image_url?: string; width?: number; height?: number; blurhash?: string }[] | null;
  }
  feed: {
    url: string;
    siteUrl: string;
    lastModifiedHeader: string | null;
    etagHeader: string | null;
    errorMessage: null;
    errorAt: null;
    id?: string;
    image?: string | null;
    description?: string | null;
    title?: string | null;
    checkedAt: Date;
    ttl?: number | null;
    ownerUserId?: string | null;
    language?: string | null;
  }
  view: number;            // FeedViewType 枚举,见下
}
```

- `Date` 字段(`publishedAt`/`insertedAt`/`checkedAt`)为 wiki 的 TS 类型;JSON 线上编码格式(如是否为 ISO-8601 字符串)官方未文档化,推断为 ISO-8601 字符串。**(推断,待实测确认)**
- `view` 数值映射(官方 npm 包 [@folo-services/constants](https://www.npmjs.com/package/@folo-services/constants) `FeedViewType`):`-1`=All、`0`=Articles、`1`=SocialMedia、`2`=Pictures、`3`=Videos、`4`=Audios、`5`=Notifications。**(源码)**
- 真实投递佐证:issue [#4389](https://github.com/RSSNext/Folo/issues/4389) 用户把 payload 投到自建 n8n,报告 feed 标题字段未尊重自定义标题——证明生产中确实按此结构 POST,且 payload 字段为服务端固定生成。**(文档/issue)**
- 注意:issue [#4603](https://github.com/RSSNext/Folo/issues/4603) 讨论的是**另一条独立路径**(向 Folo 的 inbox 推送:POST `https://api.folo.is/` + `X-Follow-Handle`/`X-Follow-Secret`),与本 Action Webhook(由 Folo 向外 POST)无关,勿混淆。

### 4. 配置表面与规则存储格式

- Webhook 动作配置 = 一个或多个 URL(字符串数组),存于规则 `result.webhooks`。**(UI 实测/源码** [store.ts](https://github.com/RSSNext/Folo/blob/main/packages/internal/store/src/modules/action/store.ts)**)**
- 服务端校验 schema(`actionsItemOpenAPISchema`):`{ name: string, condition: ConditionItem[] | ConditionItem[][], result: { …, webhooks?: string[] } }`,`ConditionItem = { field, operator, value: string }`。**(源码** [@folo-services/drizzle](https://www.npmjs.com/package/@folo-services/drizzle)**)**
- 实测:PUT 空条件项 `condition: [[{}]]` 被服务端拒绝(`422 {"code":3,"message":"Unprocessable content"}`);合法条件 `[[{field:"entry_title", operator:"contains", value:"test"}]]` 保存成功(204)。**(UI 实测)**
- 规则可导入/导出(JSON `{version:"1.0", exportDate, rules:[…]}`;changelog 0.6.1 "Import and export your Actions")。**(源码/changelog)**

## 未知项(官方未文档化,无法验证)

以下项目前**没有任何官方来源**(wiki、changelog、开源客户端、公开 npm 包、issue/讨论)给出承诺;投递实现在闭源服务端,本次无法实测(账号无订阅、无新条目可触发)。决策时**不得假设**以下任何一项:

1. **超时(Timeout)**:无文档值。接收端应尽快响应(建议秒级处理),但不能确认 Folo 的等待上限。
2. **重试(Retry)**:无文档。失败是否重试、重试次数/退避策略未知。
3. **重复投递(At-least-once / Exactly-once)**:无文档。payload 中**没有事件/规则/投递/尝试 ID**,只有内容标识 `entry.id`/`entry.guid`——它们可做内容级去重(同一条目多次出现),但**无法区分"同一次投递的重试"与"多条规则命中同一条目"**,也无法确认是否恰一次投递。接收端应把 `entry.id` 当内容标识用,并接受重复/重试语义不可判定的现实。
4. **响应判定(Response success rules)**:无文档。哪些 HTTP 状态码视为成功/失败未知;发送端失败后如何记录/告警未知。
5. **投递顺序/并发/最大 body 大小**:无文档。
6. **payload 与 wiki 类型的精确一致性**:wiki 是唯一官方类型文档;生产中字段可能漂移(如 #4389 反映的字段细节问题)。接收端应对未知字段宽容。
7. **"新条目"触发是否含条目更新**:wiki 表述为 new entry;常规条件是否在条目更新(内容修订)时再次触发未知。status 条件(收藏)会触发,已确认。
8. **webhook URL 的服务端校验规则**:除 URL 字段必填外,是否有域名/格式白名单等校验未知(本次仅验证了条件项校验)。

## 对入站契约决策的要点

- **可用**:固定 `POST` + JSON `{entry, feed, view}`,可过滤到具体条目(标题/内容/作者/URL 等字段 + regex),可仅收藏触发。规则由用户在 Folo UI 配置,一个规则可配多个 URL。
- **限制**:请求头/签名无可配置项、官方未文档化 → 入站鉴权只能走 URL 秘密;无超时/重试/去重/响应判定承诺,payload 无投递级 ID → Sortify 端需幂等处理重复内容(以 `entry.id`/`guid` 做内容级去重)、快速响应,并自行承担丢单/重复风险。
- **建议验证路径**:配置一个指向自建接收端的规则后,等真实新条目触发,用抓包确认实际 payload(含 Date 编码)、超时/重试/响应判定行为(本次账号无订阅,无法完成)。

## 来源(Source)

- 官方 wiki(请求方法/头/body 类型):https://github.com/RSSNext/Folo/wiki/Actions
- 官方 App 页面(UI 实测):https://app.folo.is/action
- 桌面端 Webhook 配置 UI(仅 URL):https://github.com/RSSNext/Folo/blob/main/apps/desktop/layer/renderer/src/modules/action/then-section.tsx
- 条件 UI(All/Custom Filters、And/Or):https://github.com/RSSNext/Folo/blob/main/apps/desktop/layer/renderer/src/modules/action/when-section.tsx
- 条件字段/运算符枚举:https://github.com/RSSNext/Folo/blob/main/packages/internal/store/src/modules/action/constant.ts
- 规则存储(`result.webhooks`)、导入导出:https://github.com/RSSNext/Folo/blob/main/packages/internal/store/src/modules/action/store.ts
- 保存按钮/未保存拦截:https://github.com/RSSNext/Folo/blob/main/apps/desktop/layer/renderer/src/modules/action/action-setting.tsx
- 移动端 Webhook 编辑器(仅 URL):https://github.com/RSSNext/Folo/blob/main/apps/mobile/src/modules/settings/routes/EditWebhooks.tsx
- 客户端 API 模块(GET/PUT /actions):https://www.npmjs.com/package/@follow-app/client-sdk
- 服务端规则 schema(condition/result/webhooks 校验):https://www.npmjs.com/package/@folo-services/drizzle
- FeedViewType 枚举:https://www.npmjs.com/package/@folo-services/constants
- 真实 payload 投递佐证:https://github.com/RSSNext/Folo/issues/4389
- 独立于本契约的 inbox 推送 API(勿混淆):https://github.com/RSSNext/Folo/issues/4603
- 功能引入记录:https://github.com/RSSNext/Folo/blob/main/apps/desktop/changelog/0.2.1.md 、0.2.2.md 、0.4.4.md 、0.6.1.md(及移动端 0.1.7.md)
