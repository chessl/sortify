# 原型：三类条目的 Reader 文档呈现（THROWAWAY）

**这是一次性原型，不要合并进 main，不要基于它写生产代码。** 它只活在分支 `prototype/reader-document-layouts` 上，唯一作用是让人打开三份真实的 Reader 文档，回答 [#35](https://github.com/chessl/sortify/issues/35)：

> 哪种正文结构与元数据布局，能让一个 Folo entry 形成一个可读、可追溯原来源的 Reader document？

放在 `lib/` 下面，是因为真做的时候写 Reader 的代码会落在 `lib/`（`lib/cubox.ts` 旁边）。没有依赖、没有构建、没有测试。

## 三份文档

| # | 条目类型 | 写入方式 | 本地资产 | Reader 文档 |
| --- | --- | --- | --- | --- |
| 1 | URL | 只交 URL，Reader 自己抓 | [`url-only.request.md`](url-only.request.md) | https://read.readwise.io/read/01kzp3g3m83p6bez9bqphc475p |
| 2 | 纯文本 | 提交 HTML 正文 | [`text.html`](text.html) | https://read.readwise.io/read/01kzp3gcxat8vpsgt9f05n3whp |
| 3 | 视频转写 | 提交 HTML 正文 | [`video-transcript.html`](video-transcript.html) | https://read.readwise.io/read/01kzp3h5ykmmcma9syf6d75ete |

三份都带 tag `sortify-prototype` + `reader-layout`，标题带 `[原型 N/3]`，创建后确认都在 `new`。

## 怎么看

- **要判断阅读体验**：直接点上表的三个 Reader 链接，在 Reader 里横着比。这是原型的重点。
- **要看我们提交了什么**：双击 `text.html` / `video-transcript.html` 用浏览器打开。它们是裸正文片段，没有 `<html>` 外壳也没有样式——浏览器里长什么样不重要，重要的是标签结构。
- 两份 HTML 只用了 `p` / `a` / `strong` / `em` / `br` / `hr`，没有 script、style、内联事件、外部资源。

## 内容是假的，这一点要知道

- 原型 2 的文本和原型 3 的转写都是编的。原型 3 的时间戳链接指向真实视频的真实位置，但**那些字幕文字不是该视频的真实字幕**，文档里也写明了这一点。
- 原型 1 是真实公开文章，正文完全是 Reader 抓的。

## 写入时观察到的（供 #35 讨论，不是结论）

- 三份都落在 `location: "new"`，没有被账号默认位置改掉。
- 提交的 HTML 存进去后读回来是 **Markdown**：`<strong>` → `**`，`<hr>` → `---`，`<br>` → 行尾双空格。段落顺序、时间戳、链接都没丢。
- 原型 3 显式传了 `category: "video"`，读回来是 `article`。
- 原型 3 显式传了 `published_date`，读回来是 `null`。
- 原型 1 显式传的 `summary` 被 Reader 自己生成的英文摘要覆盖了；原型 2、3 提交的 `summary` 保留了。
- 本次通过 Readwise MCP 的 `reader_create_document` 写入，它的 schema 没有 REST 的 `location` 和 `should_clean_html`。REST 契约见 `docs/research/readwise-reader-write-contract.md`（分支 `research/reader-write-contract`）。

## 用完怎么清

在 Reader 里按 tag `sortify-prototype` 搜出这三份删掉（id：`01kzp3g3m83p6bez9bqphc475p`、`01kzp3gcxat8vpsgt9f05n3whp`、`01kzp3h5ykmmcma9syf6d75ete`），然后删掉本分支。结论写回 #35 或规格里，代码不要从这里搬。
