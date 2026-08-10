import { createHash } from "node:crypto";
import { FatalError } from "workflow";
import { getVideoTranscript, type VideoTranscript } from "@/lib/bibigpt";
import type { FoloEntry } from "@/lib/folo";
import { saveToReader } from "@/lib/readwise";

const READER_SAVE_MAX_RETRIES = 1;

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

export async function processEntryWorkflow(entry: FoloEntry) {
  "use workflow";

  if (entry.kind === "url") {
    return saveUrlEntry(entry);
  }

  if (entry.kind === "text") {
    return saveTextEntry(entry);
  }

  const transcript = await fetchVideoTranscript(entry);
  return saveVideoEntry(entry, transcript);
}

async function saveUrlEntry(entry: Extract<FoloEntry, { kind: "url" }>) {
  "use step";

  return saveToReader({
    url: entry.url,
    ...(entry.title !== undefined ? { title: entry.title } : {}),
    location: "new",
  });
}
saveUrlEntry.maxRetries = READER_SAVE_MAX_RETRIES;

async function saveTextEntry(entry: Extract<FoloEntry, { kind: "text" }>) {
  "use step";

  const stableEntry = JSON.stringify({
    title: entry.title ?? null,
    author: entry.author ?? null,
    description: entry.description ?? null,
    text: entry.text,
  });
  const hash = createHash("sha256").update(stableEntry).digest("hex");
  let html = "";
  let lineStart = 0;
  for (let index = 0; index <= entry.text.length; index += 1) {
    const character = entry.text[index];
    if (
      index < entry.text.length &&
      character !== "\r" &&
      character !== "\n"
    ) {
      continue;
    }

    html += `<p>${escapeHtml(entry.text.slice(lineStart, index))}</p>`;
    if (character === "\r" && entry.text[index + 1] === "\n") {
      index += 1;
    }
    lineStart = index + 1;
  }

  return saveToReader({
    url: `https://sortify.invalid/text/${hash}`,
    html,
    title: entry.title ?? "Text from Folo",
    ...(entry.author !== undefined ? { author: entry.author } : {}),
    ...(entry.description !== undefined
      ? { summary: entry.description }
      : {}),
    location: "new",
  });
}
saveTextEntry.maxRetries = READER_SAVE_MAX_RETRIES;

async function fetchVideoTranscript(
  entry: Extract<FoloEntry, { kind: "video" }>,
) {
  "use step";

  const result = await getVideoTranscript(entry.url);
  if (result.outcome === "unavailable") {
    throw new FatalError("Video subtitles are unavailable.");
  }

  return result.transcript;
}

async function saveVideoEntry(
  entry: Extract<FoloEntry, { kind: "video" }>,
  transcript: VideoTranscript,
) {
  "use step";

  const escapedUrl = escapeHtml(entry.url);
  let html = `<a href="${escapedUrl}">${escapedUrl}</a>`;
  for (const subtitle of transcript.subtitles) {
    let timestamps = "";
    if (subtitle.startTime !== undefined) {
      timestamps = formatTimestamp(subtitle.startTime);
    }
    if (subtitle.endTime !== undefined) {
      if (timestamps !== "") {
        timestamps += " – ";
      }
      timestamps += formatTimestamp(subtitle.endTime);
    }
    html += `<p>${timestamps !== "" ? `${timestamps} ` : ""}${escapeHtml(subtitle.text)}</p>`;
  }

  return saveToReader({
    url: entry.url,
    html,
    title: transcript.title,
    ...(transcript.author !== undefined ? { author: transcript.author } : {}),
    ...(transcript.description !== undefined
      ? { summary: transcript.description }
      : entry.description !== undefined
        ? { summary: entry.description }
        : {}),
    ...(transcript.coverUrl !== undefined
      ? { image_url: transcript.coverUrl }
      : {}),
    location: "new",
  });
}
saveVideoEntry.maxRetries = READER_SAVE_MAX_RETRIES;

function formatTimestamp(seconds: number) {
  const wholeSeconds = Math.round(seconds);
  const hours = Math.floor(wholeSeconds / 3_600);
  const minutes = Math.floor((wholeSeconds % 3_600) / 60);
  const remainder = wholeSeconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}
