import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const tempDir = await mkdtemp(join(tmpdir(), "sortify-ticket-28-"));
const workflowDataDir = join(tempDir, "workflow");
const artifactFile = join(tempDir, "artifact.json");
const cuboxRequests = [];
const blobRequests = [];
let cuboxResponse = { status: 200, body: { code: 200, message: "", data: null } };

const cuboxServer = createServer((request, response) => {
  let body = "";
  request.setEncoding("utf8");
  request.on("data", (chunk) => {
    body += chunk;
  });
  request.on("end", () => {
    cuboxRequests.push({
      method: request.method,
      url: request.url,
      body: JSON.parse(body),
    });
    response.writeHead(cuboxResponse.status, {
      "content-type": "application/json",
    });
    response.end(JSON.stringify(cuboxResponse.body));
  });
});
cuboxServer.listen(0, "127.0.0.1");
await once(cuboxServer, "listening");
const cuboxAddress = cuboxServer.address();
assert(cuboxAddress && typeof cuboxAddress !== "string");

const blobServer = createServer((request, response) => {
  let body = "";
  request.setEncoding("utf8");
  request.on("data", (chunk) => {
    body += chunk;
  });
  request.on("end", async () => {
    const pathname = new URL(request.url ?? "/", "http://blob.local").searchParams.get(
      "pathname",
    );
    assert(pathname);
    blobRequests.push({
      method: request.method,
      pathname,
      headers: request.headers,
      body: JSON.parse(body),
    });
    await writeFile(artifactFile, body);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        url: `https://mock-store.private.blob.vercel-storage.com/${pathname}`,
        downloadUrl: `https://mock-store.private.blob.vercel-storage.com/${pathname}?download=1`,
        pathname,
        contentType: "application/json; charset=utf-8",
        contentDisposition: "inline",
        etag: "smoke-etag",
      }),
    );
  });
});
blobServer.listen(0, "127.0.0.1");
await once(blobServer, "listening");
const blobAddress = blobServer.address();
assert(blobAddress && typeof blobAddress !== "string");

const portProbe = createServer();
portProbe.listen(0, "127.0.0.1");
await once(portProbe, "listening");
const appAddress = portProbe.address();
assert(appAddress && typeof appAddress !== "string");
const appPort = appAddress.port;
await new Promise((resolveClose) => portProbe.close(resolveClose));

const appUrl = `http://127.0.0.1:${appPort}`;
const blobLoader = pathToFileURL(
  resolve("scripts/smoke-content-pipeline-blob.mjs"),
).href;
const app = spawn(
  process.execPath,
  [resolve("node_modules/next/dist/bin/next"), "dev", "-p", String(appPort)],
  {
    env: {
      ...process.env,
      BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_mock-store_secret",
      CUBOX_API_URL: `http://127.0.0.1:${cuboxAddress.port}/save`,
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${blobLoader}`.trim(),
      SORTIFY_APP_URL: appUrl,
      SORTIFY_SMOKE_BLOB_FILE: artifactFile,
      VERCEL_BLOB_API_URL: `http://127.0.0.1:${blobAddress.port}`,
      VERCEL_BLOB_RETRIES: "0",
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

  const invalidResponse = await fetch(`${appUrl}/api/webhooks/folo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entry: { title: "Missing URL and content" } }),
  });
  assert.equal(invalidResponse.status, 400);
  assert.equal(cuboxRequests.length, 0);
  const runsAfterInvalidRequest = await getWorld().runs.list({
    resolveData: "none",
  });
  assert.deepEqual(runsAfterInvalidRequest.data, []);

  const escapedSentinel = `<script>alert("text-only & escaped")</script>`;
  const longText = `${escapedSentinel}\n${Array.from(
    { length: 420 },
    (_, index) => `Line ${String(index).padStart(3, "0")}: complete private text artifact.`,
  ).join("\n")}\nEND-OF-TEXT-28`;
  assert(longText.length > 3_000);

  const textResponse = await fetch(`${appUrl}/api/webhooks/folo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      entry: {
        id: "entry-28",
        title: "Ticket 28 text smoke",
        description: "Text-only entry description",
        content: longText,
        author: "Folo author",
        url: "not a valid URL",
        ignored: "not persisted",
      },
      feed: { id: "feed-28", secretEnvelopeField: "not persisted" },
      view: 0,
    }),
  });
  assert.equal(textResponse.status, 202);
  const textHandoff = await textResponse.json();
  assert.match(textHandoff.runId, /^wrun_/);
  const textResult = await getRun(textHandoff.runId).returnValue;
  assert.equal(textResult.outcome, "saved");
  assert.match(textResult.contentId, /^[0-9a-f-]{36}$/);
  assert.equal(textResult.url, `${appUrl}/content/${textResult.contentId}`);

  assert.equal(blobRequests.length, 1);
  const [blobRequest] = blobRequests;
  assert.equal(blobRequest.method, "PUT");
  assert.equal(blobRequest.pathname, `content/${textResult.contentId}.json`);
  assert.equal(blobRequest.headers["x-vercel-blob-access"], "private");
  assert.equal(blobRequest.headers["x-add-random-suffix"], "0");
  assert.equal(blobRequest.headers["x-allow-overwrite"], "0");
  assert.deepEqual(blobRequest.body, {
    kind: "text",
    text: longText,
    title: "Ticket 28 text smoke",
    description: "Text-only entry description",
    author: "Folo author",
  });

  assert.deepEqual(cuboxRequests, [
    {
      method: "POST",
      url: "/save",
      body: {
        type: "url",
        content: textResult.url,
        title: "Ticket 28 text smoke",
        description: "Text-only entry description",
      },
    },
  ]);

  const pageResponse = await fetch(textResult.url);
  assert.equal(pageResponse.status, 200);
  assert.match(pageResponse.headers.get("content-type") ?? "", /^text\/html/);
  const pageHtml = await pageResponse.text();
  assert(pageHtml.includes("Ticket 28 text smoke"));
  assert(pageHtml.includes("Folo author"));
  assert(pageHtml.includes("Line 000: complete private text artifact."));
  assert(pageHtml.includes("Line 419: complete private text artifact."));
  assert(pageHtml.includes("END-OF-TEXT-28"));
  assert(pageHtml.includes("&lt;script&gt;alert(&quot;text-only &amp; escaped&quot;)&lt;/script&gt;"));
  assert(!pageHtml.includes(escapedSentinel));

  const ordinaryUrl = "https://example.com/articles/27?source=folo";
  const urlResponse = await fetch(`${appUrl}/api/webhooks/folo`, {
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
    url: ordinaryUrl,
  });
  assert.equal(blobRequests.length, 1);
  assert.deepEqual(cuboxRequests[1], {
    method: "POST",
    url: "/save",
    body: {
      type: "url",
      content: ordinaryUrl,
      title: "Ordinary URL remains direct",
      description: "Ticket 27 behavior",
    },
  });

  cuboxResponse = { status: 200, body: { code: -1100, message: "rejected" } };
  const rejectedResponse = await fetch(`${appUrl}/api/webhooks/folo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      entry: { url: "https://example.com/business-rejection" },
    }),
  });
  assert.equal(rejectedResponse.status, 202);
  const rejectedHandoff = await rejectedResponse.json();
  await assert.rejects(
    getRun(rejectedHandoff.runId).returnValue,
    /Cubox rejected the save request/,
  );

  cuboxResponse = { status: 500, body: { code: 200 } };
  const httpFailureResponse = await fetch(`${appUrl}/api/webhooks/folo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      entry: { url: "https://example.com/http-failure" },
    }),
  });
  assert.equal(httpFailureResponse.status, 202);
  const httpFailureHandoff = await httpFailureResponse.json();
  await assert.rejects(
    getRun(httpFailureHandoff.runId).returnValue,
    /Cubox request failed with HTTP 500/,
  );
  assert.equal(blobRequests.length, 1);

  console.log(
    JSON.stringify({
      textStatus: textResponse.status,
      textRunId: textHandoff.runId,
      contentId: textResult.contentId,
      blobCount: blobRequests.length,
      persistedTextLength: blobRequest.body.text.length,
      pageStatus: pageResponse.status,
      pageHasFinalLine: pageHtml.includes("END-OF-TEXT-28"),
      pageEscapedReactText: !pageHtml.includes(escapedSentinel),
      cuboxPageUrl: cuboxRequests[0].body.content,
      urlStatus: urlResponse.status,
      ordinaryUrlOutcome: "saved",
      invalidStatus: invalidResponse.status,
      businessRejection: "failed",
      httpFailure: "failed",
    }),
  );
} finally {
  if (app.exitCode === null) {
    app.kill("SIGTERM");
    await once(app, "exit");
  }
  await Promise.all([
    new Promise((resolveClose) => cuboxServer.close(resolveClose)),
    new Promise((resolveClose) => blobServer.close(resolveClose)),
  ]);
  await rm(tempDir, { recursive: true, force: true });
}
