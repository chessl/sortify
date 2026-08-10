import { FatalError, RetryableError } from "workflow";

type ReaderDocument = {
  url: string;
  html?: string;
  title?: string;
  author?: string;
  summary?: string;
  image_url?: string;
  location?: "new" | "later" | "shortlist" | "archive" | "feed";
};

const READER_SAVE_URL = "https://readwise.io/api/v3/save/";
const READER_REQUEST_TIMEOUT_MS = 30_000;
const HTTP_DATE_PATTERN =
  /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/;

export async function saveToReader(document: ReaderDocument) {
  const accessToken = process.env.READWISE_ACCESS_TOKEN;
  if (!accessToken) {
    throw new FatalError("READWISE_ACCESS_TOKEN is not configured.");
  }

  const endpoint =
    process.env.WORKFLOW_TARGET_WORLD === "local"
      ? process.env.READWISE_API_URL || READER_SAVE_URL
      : READER_SAVE_URL;
  const configuredTimeout =
    process.env.WORKFLOW_TARGET_WORLD === "local"
      ? process.env.READWISE_REQUEST_TIMEOUT_MS
      : undefined;
  const requestTimeoutMs =
    configuredTimeout === undefined
      ? READER_REQUEST_TIMEOUT_MS
      : Number(configuredTimeout);
  if (
    !Number.isSafeInteger(requestTimeoutMs) ||
    requestTimeoutMs <= 0 ||
    requestTimeoutMs > READER_REQUEST_TIMEOUT_MS
  ) {
    throw new FatalError(
      `READWISE_REQUEST_TIMEOUT_MS must be an integer from 1 to ${READER_REQUEST_TIMEOUT_MS}.`,
    );
  }

  let response: Response;
  try {
    response = await fetch(endpoint, {
      signal: AbortSignal.timeout(requestTimeoutMs),
      method: "POST",
      redirect: "manual",
      headers: {
        Authorization: `Token ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(document),
    });
  } catch {
    throw new FatalError("Reader request failed before acknowledgement.");
  }

  if (response.status === 429) {
    const retryAfter = parseRetryAfter(response.headers.get("Retry-After"));
    if (retryAfter !== null) {
      throw new RetryableError("Reader rate limit exceeded.", { retryAfter });
    }
    throw new FatalError("Reader returned an invalid Retry-After header.");
  }

  if (response.status !== 200 && response.status !== 201) {
    throw new FatalError(`Reader request failed with HTTP ${response.status}.`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new FatalError("Reader returned an invalid success response.");
  }

  if (
    typeof body !== "object" ||
    body === null ||
    !("id" in body) ||
    typeof body.id !== "string" ||
    !("url" in body) ||
    typeof body.url !== "string"
  ) {
    throw new FatalError("Reader returned an invalid success response.");
  }

  return {
    outcome: "saved" as const,
    documentId: body.id,
    readerUrl: body.url,
  };
}

function parseRetryAfter(value: string | null): number | null {
  if (value === null) {
    return null;
  }

  if (/^\d+$/.test(value)) {
    const seconds = Number(value);
    return Number.isSafeInteger(seconds) && seconds <= Number.MAX_SAFE_INTEGER / 1000
      ? seconds * 1000
      : null;
  }

  if (!HTTP_DATE_PATTERN.test(value)) {
    return null;
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : Math.max(0, timestamp - Date.now());
}
