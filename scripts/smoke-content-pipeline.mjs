import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const tempDir = await mkdtemp(join(tmpdir(), "sortify-content-pipeline-"));
const workflowDataDir = join(tempDir, "workflow");
const readerRequests = [];
const readerRequestBodies = [];
const bibigptRequests = [];
const bibigptToken = "smoke-bibigpt-token";
const webhookSecret = "smoke-webhook-secret";
const readwiseToken = "smoke-readwise-token";
const youtubeUrl =
  "https://www.youtube.com/watch?v=sortify29&feature=share";
const bilibiliUrl =
  "https://www.bilibili.com/video/BV1Sortify29?p=7&vd_source=folo";
const networkFailureUrl =
  "https://www.youtube.com/watch?v=sortify30-network-failure";
const emptySubtitlesUrl =
  "https://www.youtube.com/watch?v=sortify30-empty-subtitles";
const missingSubtitlesUrl =
  "https://www.youtube.com/watch?v=sortify30-missing-subtitles";
const bibigptFixtures = new Map([
  [
    youtubeUrl,
    {
      success: true,
      id: "sortify29",
      service: "youtube",
      sourceUrl: youtubeUrl,
      htmlUrl: "https://bibigpt.co/youtube-sortify29",
      costDuration: 125.5,
      remainingTime: 1_000,
      detail: {
        id: "sortify29",
        url: youtubeUrl,
        type: "youtube",
        title: "YouTube complete transcript",
        author: "YouTube creator",
        descriptionText: "YouTube source description",
        cover: "https://example.com/youtube-cover.jpg",
        duration: 125.5,
        publishedDate: "2026-08-01",
        subtitlesArray: [
          { index: 0, startTime: 0, end: 1.9996, text: "YT FIRST SEGMENT 29" },
          { index: 1, startTime: 1.9996, end: 120, text: '<YT MIDDLE & "SEGMENT"> 29' },
          { index: 2, startTime: 120, end: 125.5, text: "YT FINAL SEGMENT 29" },
        ],
      },
    },
  ],
  [
    bilibiliUrl,
    {
      success: true,
      id: "BV1Sortify29",
      service: "bilibili",
      sourceUrl: bilibiliUrl,
      htmlUrl: "https://bibigpt.co/bilibili-sortify29",
      costDuration: 63,
      remainingTime: 900,
      detail: {
        id: "BV1Sortify29",
        url: bilibiliUrl,
        type: "bilibili",
        title: "bilibili multi-part complete transcript",
        author: "bilibili creator",
        cover: "https://example.com/bilibili-cover.jpg",
        duration: 63,
        publishedDate: "2026-08-02",
        subtitlesArray: [
          { index: 0, startTime: 0, end: 20, text: "BILI P7 FIRST SEGMENT 29" },
          { index: 1, startTime: 20, end: 40, text: "BILI P7 MIDDLE SEGMENT 29" },
          { index: 2, startTime: 40, end: 63, text: "BILI P7 FINAL SEGMENT 29" },
        ],
      },
    },
  ],
  [
    emptySubtitlesUrl,
    {
      success: true,
      detail: {
        title: "Empty subtitles",
        subtitlesArray: [],
      },
    },
  ],
  [
    missingSubtitlesUrl,
    {
      success: true,
      detail: {
        title: "Missing subtitles",
      },
    },
  ],
]);
const defaultReaderResponse = {
  status: 201,
  body: {
    id: "reader-document-41",
    url: "https://read.readwise.io/read/reader-document-41",
  },
};
let readerResponses = [defaultReaderResponse];


const readerServer = createServer((request, response) => {
  let body = "";
  request.setEncoding("utf8");
  request.on("data", (chunk) => {
    body += chunk;
  });
  request.on("end", () => {
    readerRequestBodies.push(body);
    readerRequests.push({
      method: request.method,
      url: request.url,
      authorization: request.headers.authorization,
      contentType: request.headers["content-type"],
      body: JSON.parse(body),
    });
    const readerResponse = readerResponses.shift() ?? defaultReaderResponse;
    if (readerResponse.destroy === true) {
      response.destroy();
      return;
    }
    response.writeHead(readerResponse.status, {
      "content-type": "application/json",
      ...readerResponse.headers,
    });
    response.end(
      "rawBody" in readerResponse
        ? readerResponse.rawBody
        : JSON.stringify(readerResponse.body),
    );
  });
});
readerServer.listen(0, "127.0.0.1");
await once(readerServer, "listening");
const readerAddress = readerServer.address();
assert(readerAddress && typeof readerAddress !== "string");

const bibigptServer = createServer((request, response) => {
  const requestUrl = new URL(request.url ?? "/", "http://bibigpt.local");
  const sourceUrl = requestUrl.searchParams.get("url");
  bibigptRequests.push({
    method: request.method,
    pathname: requestUrl.pathname,
    sourceUrl,
    authorization: request.headers.authorization,
  });
  if (sourceUrl === networkFailureUrl) {
    response.destroy();
    return;
  }
  const fixture = sourceUrl === null ? undefined : bibigptFixtures.get(sourceUrl);
  if (
    request.method !== "GET" ||
    requestUrl.pathname !== "/api/v1/getSubtitle" ||
    fixture === undefined
  ) {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ message: "Unknown smoke URL" }));
    return;
  }
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(fixture));
});
bibigptServer.listen(0, "127.0.0.1");
await once(bibigptServer, "listening");
const bibigptAddress = bibigptServer.address();
assert(bibigptAddress && typeof bibigptAddress !== "string");


const portProbe = createServer();
portProbe.listen(0, "127.0.0.1");
await once(portProbe, "listening");
const appAddress = portProbe.address();
assert(appAddress && typeof appAddress !== "string");
const appPort = appAddress.port;
await new Promise((resolveClose) => portProbe.close(resolveClose));

const appUrl = `http://127.0.0.1:${appPort}`;
const webhookUrl = `${appUrl}/api/webhooks/folo?secret=${encodeURIComponent(webhookSecret)}`;
const app = spawn(
  process.execPath,
  [resolve("node_modules/next/dist/bin/next"), "dev", "-p", String(appPort)],
  {
    env: {
      ...process.env,
      BIBIGPT_API_TOKEN: bibigptToken,
      BIBIGPT_API_URL: `http://127.0.0.1:${bibigptAddress.port}/api/v1/getSubtitle`,
      READWISE_ACCESS_TOKEN: readwiseToken,
      READWISE_API_URL: `http://127.0.0.1:${readerAddress.port}/api/v3/save/`,
      FOLO_WEBHOOK_SECRET: webhookSecret,
      WORKFLOW_LOCAL_BASE_URL: appUrl,
      WORKFLOW_LOCAL_DATA_DIR: workflowDataDir,
      WORKFLOW_TARGET_WORLD: "local",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let appOutput = "";
app.stdout.on("data", (chunk) => {
  appOutput += chunk;
});
app.stderr.on("data", (chunk) => {
  appOutput += chunk;
});

process.env.WORKFLOW_LOCAL_BASE_URL = appUrl;
process.env.WORKFLOW_LOCAL_DATA_DIR = workflowDataDir;
process.env.WORKFLOW_TARGET_WORLD = "local";

try {
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (app.exitCode !== null) {
      throw new Error(`Next.js exited before smoke start:\n${appOutput}`);
    }
    try {
      const response = await fetch(appUrl);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  assert(ready, `Next.js did not become ready:\n${appOutput}`);

  const [{ getRun }, { getWorld }] = await Promise.all([
    import("workflow/api"),
    import("@workflow/core/runtime"),
  ]);

  const unauthorizedResponse = await fetch(`${appUrl}/api/webhooks/folo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      entry: { url: "https://example.com/unauthorized" },
    }),
  });
  assert.equal(unauthorizedResponse.status, 401);

  const invalidResponse = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entry: { title: "Missing URL and content" } }),
  });
  assert.equal(invalidResponse.status, 400);
  assert.equal(readerRequests.length, 0);
  const runsAfterInvalidRequest = await (await getWorld()).runs.list({
    resolveData: "none",
  });
  assert.deepEqual(runsAfterInvalidRequest.data, []);

  const text =
    "First & <unsafe> \"quoted\" 'apostrophe'\r\n\rFinal line > done";
  const textPayload = {
    entry: {
      description: "Text summary & details",
      content: text,
      author: "Folo <Author> & Co.",
      url: "not a valid URL",
    },
  };
  const expectedTextUrl =
    "https://sortify.invalid/text/3d0684e1e9b3cab56c157bc9d4bb1509b3fbb0a5b0483935256e196557e97b06";
  const expectedTextBody = {
    url: expectedTextUrl,
    html: "<p>First &amp; &lt;unsafe&gt; &quot;quoted&quot; &#39;apostrophe&#39;</p><p></p><p>Final line &gt; done</p>",
    title: "Text from Folo",
    author: "Folo <Author> & Co.",
    summary: "Text summary & details",
    location: "new",
  };

  const textResults = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const textResponse = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(textPayload),
    });
    assert.equal(textResponse.status, 202);
    const textHandoff = await textResponse.json();
    assert.match(textHandoff.runId, /^wrun_/);
    textResults.push(await getRun(textHandoff.runId).returnValue);
  }

  assert.deepEqual(textResults, [
    {
      outcome: "saved",
      documentId: "reader-document-41",
      readerUrl: "https://read.readwise.io/read/reader-document-41",
    },
    {
      outcome: "saved",
      documentId: "reader-document-41",
      readerUrl: "https://read.readwise.io/read/reader-document-41",
    },
  ]);
  assert.equal(readerRequests.length, 2);
  assert.deepEqual(readerRequests[0].body, expectedTextBody);
  assert.deepEqual(readerRequests[1].body, expectedTextBody);
  assert.equal(readerRequests[0].body.url, expectedTextUrl);
  assert.equal(readerRequests[1].body.url, expectedTextUrl);
  assert.equal(readerRequestBodies[0], readerRequestBodies[1]);

  const ordinaryUrl = "https://example.com/articles/27?source=folo";
  const urlResponse = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      entry: {
        title: "Ordinary URL remains direct",
        description: "Ticket 27 behavior",
        url: ordinaryUrl,
      },
      feed: { id: "feed-27" },
      view: 0,
    }),
  });
  assert.equal(urlResponse.status, 202);
  const urlHandoff = await urlResponse.json();
  assert.deepEqual(await getRun(urlHandoff.runId).returnValue, {
    outcome: "saved",
    documentId: "reader-document-41",
    readerUrl: "https://read.readwise.io/read/reader-document-41",
  });
  assert.equal(readerRequests.length, 3);
  assert.deepEqual(readerRequests[2], {
    method: "POST",
    url: "/api/v3/save/",
    authorization: `Token ${readwiseToken}`,
    contentType: "application/json",
    body: {
      url: ordinaryUrl,
      title: "Ordinary URL remains direct",
      location: "new",
    },
  });

  async function runVideoSmoke({
    sourceUrl,
    title,
    author,
    summary,
    imageUrl,
    foloDescription,
    expectedHtml,
    firstSubtitle,
    finalSubtitle,
  }) {
    const bibigptCount = bibigptRequests.length;
    const readerCount = readerRequests.length;
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entry: {
          title: "Folo video title",
          description: foloDescription,
          url: sourceUrl,
        },
      }),
    });
    assert.equal(response.status, 202);
    const handoff = await response.json();
    const result = await getRun(handoff.runId).returnValue;
    assert.deepEqual(result, {
      outcome: "saved",
      documentId: "reader-document-41",
      readerUrl: "https://read.readwise.io/read/reader-document-41",
    });

    assert.equal(bibigptRequests.length, bibigptCount + 1);
    assert.deepEqual(bibigptRequests[bibigptCount], {
      method: "GET",
      pathname: "/api/v1/getSubtitle",
      sourceUrl,
      authorization: `Bearer ${bibigptToken}`,
    });

    assert.equal(readerRequests.length, readerCount + 1);
    assert.deepEqual(readerRequests[readerCount], {
      method: "POST",
      url: "/api/v3/save/",
      authorization: `Token ${readwiseToken}`,
      contentType: "application/json",
      body: {
        url: sourceUrl,
        html: expectedHtml,
        title,
        author,
        summary,
        image_url: imageUrl,
        location: "new",
      },
    });
    const savedHtml = readerRequests[readerCount].body.html;
    assert(savedHtml.indexOf(firstSubtitle) < savedHtml.indexOf(finalSubtitle));
    assert.equal(savedHtml.match(/<p>/g)?.length, 3);
    assert.equal(savedHtml.match(/<a /g)?.length, 1);

    return result;
  }

  async function runUnavailableVideoSmoke({ sourceUrl, title }) {
    const bibigptCount = bibigptRequests.length;
    const readerCount = readerRequests.length;
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entry: {
          title,
          description: "Unavailable video description",
          url: sourceUrl,
        },
      }),
    });
    assert.equal(response.status, 202);
    const handoff = await response.json();
    await assert.rejects(
      getRun(handoff.runId).returnValue,
      /Video subtitles are unavailable/,
    );

    assert.equal(bibigptRequests.length, bibigptCount + 1);
    assert.deepEqual(bibigptRequests[bibigptCount], {
      method: "GET",
      pathname: "/api/v1/getSubtitle",
      sourceUrl,
      authorization: `Bearer ${bibigptToken}`,
    });
    assert.equal(readerRequests.length, readerCount);

    return "failed";
  }

  const youtubeSmoke = await runVideoSmoke({
    sourceUrl: youtubeUrl,
    title: "YouTube complete transcript",
    author: "YouTube creator",
    summary: "YouTube source description",
    imageUrl: "https://example.com/youtube-cover.jpg",
    foloDescription: "Folo description must lose to transcript description",
    expectedHtml:
      '<a href="https://www.youtube.com/watch?v=sortify29&amp;feature=share">https://www.youtube.com/watch?v=sortify29&amp;feature=share</a><p>00:00:00 – 00:00:02 YT FIRST SEGMENT 29</p><p>00:00:02 – 00:02:00 &lt;YT MIDDLE &amp; &quot;SEGMENT&quot;&gt; 29</p><p>00:02:00 – 00:02:06 YT FINAL SEGMENT 29</p>',
    firstSubtitle: "YT FIRST SEGMENT 29",
    finalSubtitle: "YT FINAL SEGMENT 29",
  });
  const bilibiliSmoke = await runVideoSmoke({
    sourceUrl: bilibiliUrl,
    title: "bilibili multi-part complete transcript",
    author: "bilibili creator",
    summary: "Folo description fallback for bilibili",
    imageUrl: "https://example.com/bilibili-cover.jpg",
    foloDescription: "Folo description fallback for bilibili",
    expectedHtml:
      '<a href="https://www.bilibili.com/video/BV1Sortify29?p=7&amp;vd_source=folo">https://www.bilibili.com/video/BV1Sortify29?p=7&amp;vd_source=folo</a><p>00:00:00 – 00:00:20 BILI P7 FIRST SEGMENT 29</p><p>00:00:20 – 00:00:40 BILI P7 MIDDLE SEGMENT 29</p><p>00:00:40 – 00:01:03 BILI P7 FINAL SEGMENT 29</p>',
    firstSubtitle: "BILI P7 FIRST SEGMENT 29",
    finalSubtitle: "BILI P7 FINAL SEGMENT 29",
  });
  const networkFailureSmoke = await runUnavailableVideoSmoke({
    sourceUrl: networkFailureUrl,
    title: "Network failure source",
  });
  const emptySubtitlesSmoke = await runUnavailableVideoSmoke({
    sourceUrl: emptySubtitlesUrl,
    title: "Empty subtitles source",
  });
  const missingSubtitlesSmoke = await runUnavailableVideoSmoke({
    sourceUrl: missingSubtitlesUrl,
    title: "Missing subtitles source",
  });
  assert.equal(bibigptRequests.length, 5);

  const reader200Url = "https://example.com/reader-existing";
  readerResponses = [
    {
      status: 200,
      body: {
        id: "reader-existing-41",
        url: "https://read.readwise.io/read/reader-existing-41",
      },
    },
  ];
  const reader200RequestCount = readerRequests.length;
  const reader200Response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entry: { url: reader200Url } }),
  });
  assert.equal(reader200Response.status, 202);
  const reader200Handoff = await reader200Response.json();
  assert.deepEqual(await getRun(reader200Handoff.runId).returnValue, {
    outcome: "saved",
    documentId: "reader-existing-41",
    readerUrl: "https://read.readwise.io/read/reader-existing-41",
  });
  assert.deepEqual(readerRequests.slice(reader200RequestCount), [
    {
      method: "POST",
      url: "/api/v3/save/",
      authorization: `Token ${readwiseToken}`,
      contentType: "application/json",
      body: { url: reader200Url, location: "new" },
    },
  ]);

  const rateLimitedUrl = "https://example.com/rate-limited-once";
  readerResponses = [
    {
      status: 429,
      headers: { "Retry-After": "0" },
      body: { detail: "rate limited" },
    },
    {
      status: 201,
      body: {
        id: "reader-after-retry-41",
        url: "https://read.readwise.io/read/reader-after-retry-41",
      },
    },
  ];
  const rateLimitedRequestCount = readerRequests.length;
  const rateLimitedResponse = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entry: { url: rateLimitedUrl } }),
  });
  assert.equal(rateLimitedResponse.status, 202);
  const rateLimitedHandoff = await rateLimitedResponse.json();
  assert.deepEqual(await getRun(rateLimitedHandoff.runId).returnValue, {
    outcome: "saved",
    documentId: "reader-after-retry-41",
    readerUrl: "https://read.readwise.io/read/reader-after-retry-41",
  });
  assert.deepEqual(readerRequests.slice(rateLimitedRequestCount), [
    {
      method: "POST",
      url: "/api/v3/save/",
      authorization: `Token ${readwiseToken}`,
      contentType: "application/json",
      body: { url: rateLimitedUrl, location: "new" },
    },
    {
      method: "POST",
      url: "/api/v3/save/",
      authorization: `Token ${readwiseToken}`,
      contentType: "application/json",
      body: { url: rateLimitedUrl, location: "new" },
    },
  ]);

  async function expectReaderFailure({
    sourceUrl,
    responses,
    error,
    attempts = 1,
  }) {
    readerResponses = responses;
    const requestCount = readerRequests.length;
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entry: { url: sourceUrl } }),
    });
    assert.equal(response.status, 202);
    const handoff = await response.json();
    await assert.rejects(getRun(handoff.runId).returnValue, error);
    assert.equal(readerRequests.length, requestCount + attempts);
    for (const request of readerRequests.slice(requestCount)) {
      assert.deepEqual(request, {
        method: "POST",
        url: "/api/v3/save/",
        authorization: `Token ${readwiseToken}`,
        contentType: "application/json",
        body: { url: sourceUrl, location: "new" },
      });
    }
  }

  await expectReaderFailure({
    sourceUrl: "https://example.com/rate-limited-twice",
    responses: [
      {
        status: 429,
        headers: { "Retry-After": "0" },
        body: { detail: "rate limited" },
      },
      {
        status: 429,
        headers: { "Retry-After": "0" },
        body: { detail: "still rate limited" },
      },
    ],
    error: /Reader rate limit exceeded/,
    attempts: 2,
  });
  await expectReaderFailure({
    sourceUrl: "https://example.com/invalid-retry-after",
    responses: [
      {
        status: 429,
        headers: { "Retry-After": "2026-08-10" },
        body: { detail: "rate limited" },
      },
    ],
    error: /Reader returned an invalid Retry-After header/,
  });
  await expectReaderFailure({
    sourceUrl: "https://example.com/reader-redirect",
    responses: [
      {
        status: 302,
        headers: { Location: "/api/v3/save/" },
        body: null,
      },
    ],
    error: /Reader request failed with HTTP 302/,
  });
  await expectReaderFailure({
    sourceUrl: "https://example.com/reader-client-failure",
    responses: [{ status: 401, body: { detail: "unauthorized" } }],
    error: /Reader request failed with HTTP 401/,
  });
  await expectReaderFailure({
    sourceUrl: "https://example.com/reader-server-failure",
    responses: [{ status: 503, body: { detail: "unavailable" } }],
    error: /Reader request failed with HTTP 503/,
  });
  await expectReaderFailure({
    sourceUrl: "https://example.com/malformed-reader-success",
    responses: [
      {
        status: 201,
        body: {
          id: 41,
          url: "https://read.readwise.io/read/malformed-41",
        },
      },
    ],
    error: /Reader returned an invalid success response/,
  });
  await expectReaderFailure({
    sourceUrl: "https://example.com/reader-disconnect",
    responses: [{ destroy: true }],
    error: /Reader request failed before acknowledgement/,
  });

  console.log(
    JSON.stringify({
      textOutcome: textResults[0].outcome,
      textUrl: readerRequests[0].body.url,
      textStableRepeat: readerRequestBodies[0] === readerRequestBodies[1],
      textEscapedHtml: readerRequests[0].body.html,
      urlStatus: urlResponse.status,
      ordinaryUrlOutcome: "saved",
      youtube: {
        originalUrl: youtubeUrl,
        documentId: youtubeSmoke.documentId,
        readerUrl: youtubeSmoke.readerUrl,
      },
      bilibili: {
        originalUrl: bilibiliUrl,
        documentId: bilibiliSmoke.documentId,
        readerUrl: bilibiliSmoke.readerUrl,
      },
      unavailable: {
        networkFailure: networkFailureSmoke,
        emptySubtitles: emptySubtitlesSmoke,
        missingSubtitles: missingSubtitlesSmoke,
        readerWrites: 0,
      },
      bibigptBearerRequests: bibigptRequests.length,
      invalidStatus: invalidResponse.status,
      reader200Outcome: "saved",
      reader429RetryOutcome: "saved",
      readerFatalFailures: 5,
    }),
  );
} finally {
  if (app.exitCode === null) {
    app.kill("SIGTERM");
    await once(app, "exit");
  }
  await Promise.all([
    new Promise((resolveClose) => readerServer.close(resolveClose)),
    new Promise((resolveClose) => bibigptServer.close(resolveClose)),
  ]);
  await rm(tempDir, { recursive: true, force: true });
}
