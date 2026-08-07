import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const requireFromBlob = createRequire(import.meta.resolve("@vercel/blob"));
const { MockAgent, setGlobalDispatcher } = requireFromBlob("undici");

const artifactFile = process.env.SORTIFY_SMOKE_BLOB_FILE;
if (artifactFile) {
  const agent = new MockAgent();
  agent.enableNetConnect();
  agent
    .get("https://mock-store.private.blob.vercel-storage.com")
    .intercept({ method: "GET", path: /^\/content\/[0-9a-f-]+\.json$/ })
    .reply(200, () => readFileSync(artifactFile), {
      headers: { "content-type": "application/json" },
    })
    .persist();
  setGlobalDispatcher(agent);
}
