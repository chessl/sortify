import { createHash } from "node:crypto";
import { FatalError } from "workflow";
import { getVideoTranscript, type VideoTranscript } from "@/lib/bibigpt";
import type { FoloEntry } from "@/lib/folo";
import { saveToReader } from "@/lib/readwise";

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
saveUrlEntry.maxRetries = 1;

async function saveTextEntry(entry: Extract<FoloEntry, { kind: "text" }>) {
  "use step";

  const stableEntry = JSON.stringify({
    title: entry.title ?? null,
    author: entry.author ?? null,
    description: entry.description ?? null,
    text: entry.text,
  });
  const hash = createHash("sha256").update(stableEntry).digest("hex");

  return saveToReader({
    url: `https://sortify.invalid/text/${hash}`,
    html: entry.text
      .split(/\r\n|\r|\n/)
      .map((line) => `<p>${escapeHtml(line)}</p>`)
      .join(""),
    title: entry.title ?? "Text from Folo",
    ...(entry.author !== undefined ? { author: entry.author } : {}),
    ...(entry.description !== undefined
      ? { summary: entry.description }
      : {}),
    location: "new",
  });
}
saveTextEntry.maxRetries = 1;

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

  const html = [
    `<a href="${escapeHtml(entry.url)}">${escapeHtml(entry.url)}</a>`,
    ...transcript.subtitles.map((subtitle) => {
      const timestamps = [subtitle.startTime, subtitle.endTime]
        .filter((seconds): seconds is number => seconds !== undefined)
        .map(formatTimestamp)
        .join(" – ");
      return `<p>${timestamps ? `${timestamps} ` : ""}${escapeHtml(subtitle.text)}</p>`;
    }),
  ].join("");

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
saveVideoEntry.maxRetries = 1;

function formatTimestamp(seconds: number) {
  const wholeSeconds = Math.round(seconds);
  const hours = Math.floor(wholeSeconds / 3_600);
  const minutes = Math.floor((wholeSeconds % 3_600) / 60);
  const remainder = wholeSeconds % 60;
  return [hours, minutes, remainder]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}
