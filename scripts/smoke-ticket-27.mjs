import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const workflowDataDir = await mkdtemp(join(tmpdir(), "sortify-ticket-27-"));
const cuboxRequests = [];
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

const portProbe = createServer();
portProbe.listen(0, "127.0.0.1");
await once(portProbe, "listening");
const appAddress = portProbe.address();
assert(appAddress && typeof appAddress !== "string");
const appPort = appAddress.port;
await new Promise((resolveClose) => portProbe.close(resolveClose));

const appUrl = `http://127.0.0.1:${appPort}`;
const app = spawn(
  process.execPath,
  [resolve("node_modules/next/dist/bin/next"), "dev", "-p", String(appPort)],
  {
    env: {
      ...process.env,
      CUBOX_API_URL: `http://127.0.0.1:${cuboxAddress.port}/save`,
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

  const invalidResponse = await fetch(`${appUrl}/api/webhooks/folo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entry: { title: "Missing URL" } }),
  });
  assert.equal(invalidResponse.status, 400);
  assert.equal(cuboxRequests.length, 0);
  const [{ getRun }, { getWorld }] = await Promise.all([
    import("workflow/api"),
    import("@workflow/core/runtime"),
  ]);
  const runsAfterInvalidRequest = await getWorld().runs.list({
    resolveData: "none",
  });
  assert.deepEqual(runsAfterInvalidRequest.data, []);

  const ordinaryUrl = "https://example.com/articles/27?source=folo";
  const validResponse = await fetch(`${appUrl}/api/webhooks/folo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      entry: {
        id: "entry-27",
        title: "Ticket 27 smoke",
        description: "Ordinary URL description",
        url: ordinaryUrl,
        extra: "tolerated",
      },
      feed: { id: "feed-27", extra: true },
      view: 0,
      extra: "tolerated",
    }),
  });
  assert.equal(validResponse.status, 202);
  const validHandoff = await validResponse.json();
  assert.match(validHandoff.runId, /^wrun_/);

  assert.deepEqual(await getRun(validHandoff.runId).returnValue, {
    outcome: "saved",
    url: ordinaryUrl,
  });
  const expectedCuboxRequest = {
    method: "POST",
    url: "/save",
    body: {
      type: "url",
      content: ordinaryUrl,
      title: "Ticket 27 smoke",
      description: "Ordinary URL description",
    },
  };
  assert.deepEqual(cuboxRequests, [expectedCuboxRequest]);

  cuboxRequests.length = 0;
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

  console.log(
    JSON.stringify({
      invalidStatus: invalidResponse.status,
      validStatus: validResponse.status,
      runId: validHandoff.runId,
      workflowResult: { outcome: "saved", url: ordinaryUrl },
      cuboxRequest: expectedCuboxRequest,
      businessRejection: "failed",
      httpFailure: "failed",
    }),
  );
} finally {
  if (app.exitCode === null) {
    app.kill("SIGTERM");
    await once(app, "exit");
  }
  await new Promise((resolveClose) => cuboxServer.close(resolveClose));
  await rm(workflowDataDir, { recursive: true, force: true });
}
