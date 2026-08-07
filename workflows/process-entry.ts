import { getVideoTranscript, type VideoTranscript } from "@/lib/bibigpt";
import {
  persistTextArtifact,
  persistVideoTranscriptArtifact,
  type ContentArtifactReference,
} from "@/lib/content";
import { saveUrlToCubox } from "@/lib/cubox";
import type { FoloEntry } from "@/lib/folo";

export async function processEntryWorkflow(entry: FoloEntry) {
  "use workflow";

  if (entry.kind === "url") {
    return saveUrlEntry(entry);
  }

  if (entry.kind === "text") {
    const reference = await persistTextEntry(entry);
    return saveTextEntry(entry, reference);
  }

  const transcriptResult = await fetchVideoTranscript(entry);
  if (transcriptResult.outcome === "unavailable") {
    return saveDegradedVideoEntry(entry);
  }

  const { transcript } = transcriptResult;
  const reference = await persistVideoEntry(entry, transcript);
  return saveVideoEntry(entry, transcript.title, reference);
}

async function saveUrlEntry(entry: Extract<FoloEntry, { kind: "url" }>) {
  "use step";

  return saveUrlToCubox(entry);
}

async function persistTextEntry(
  entry: Extract<FoloEntry, { kind: "text" }>,
) {
  "use step";

  return persistTextArtifact(entry);
}

async function saveTextEntry(
  entry: Extract<FoloEntry, { kind: "text" }>,
  reference: ContentArtifactReference,
) {
  "use step";

  const result = await saveUrlToCubox({
    url: reference.pageUrl,
    ...(entry.title !== undefined ? { title: entry.title } : {}),
    ...(entry.description !== undefined
      ? { description: entry.description }
      : {}),
  });

  return { ...result, contentId: reference.contentId };
}

async function fetchVideoTranscript(
  entry: Extract<FoloEntry, { kind: "video" }>,
) {
  "use step";

  return getVideoTranscript(entry.url);
}

async function saveDegradedVideoEntry(
  entry: Extract<FoloEntry, { kind: "video" }>,
) {
  "use step";

  const result = await saveUrlToCubox({
    url: entry.url,
    title: `[字幕提取失败] ${entry.title ?? `${entry.platform} video`}`,
    description: "字幕提取失败，已保存原视频链接。",
  });

  return { ...result, outcome: "degraded" as const };
}

async function persistVideoEntry(
  entry: Extract<FoloEntry, { kind: "video" }>,
  transcript: VideoTranscript,
) {
  "use step";

  return persistVideoTranscriptArtifact(entry, transcript);
}

async function saveVideoEntry(
  entry: Extract<FoloEntry, { kind: "video" }>,
  title: string,
  reference: ContentArtifactReference,
) {
  "use step";

  const result = await saveUrlToCubox({
    url: reference.pageUrl,
    title: `[Full transcript · ${entry.platform}] ${title}`,
    description: `Full ordered transcript from ${entry.platform}. Original video: ${entry.url}`,
  });

  return { ...result, contentId: reference.contentId };
}
