# 原型一：URL-only 抓取请求

普通 URL 条目不提供正文，只把原始链接交给 Reader，由 Reader 自己抓取并解析网页。这一份没有 HTML 文件，因为正文不是我们写的——**Reader 抓到什么就是什么**，这正是要比较的东西。

## 请求

`POST https://readwise.io/api/v3/save/`

```json
{
  "url": "https://overreacted.io/a-complete-guide-to-useeffect/",
  "title": "[原型 1/3 · URL 抓取] A Complete Guide to useEffect",
  "author": "Dan Abramov",
  "category": "article",
  "location": "new",
  "tags": ["sortify-prototype", "reader-layout"],
  "summary": "原型条目：普通 URL 条目，正文完全由 Reader 抓取。"
}
```

本次原型通过 Readwise MCP 的 `reader_create_document` 提交，字段与上面一致；`location` 和 `should_clean_html` 不在 MCP 的 schema 里，所以依赖 Reader 默认落到 `new`（创建后已核对实际 location）。

## 为什么不传 `html`

- 省略 `html` 时 Reader 会去公开网络抓取该 URL——这是官方承诺的行为。
- 传了 `html` 就等于放弃 Reader 的解析，改由 Sortify 负责正文；对一个本来就能公开抓取的网页，这既没必要，也会丢掉 Reader 的图片、代码块和排版处理。

依据见 `docs/research/readwise-reader-write-contract.md`（分支 `research/reader-write-contract`）。

## 这一份要看的东西

抓取质量不是 100% 可控的。打开文档时值得盯着：正文有没有缺段、代码块和图片有没有活下来、标题/作者是不是我们显式传的那个、原链接是否还能从文档里点回去。
