import { get, put } from "@vercel/blob";
import { randomUUID } from "node:crypto";
import type { VideoTranscript } from "@/lib/bibigpt";
import type { FoloEntry, VideoPlatform } from "@/lib/folo";

export type TextArtifact = Readonly<{
  kind: "text";
  text: string;
  title?: string;
  description?: string;
  author?: string;
}>;

export type VideoTranscriptArtifact = Readonly<{
  kind: "video-transcript";
  platform: VideoPlatform;
  sourceUrl: string;
  title: string;
  subtitles: VideoTranscript["subtitles"];
  author?: string;
  description?: string;
  coverUrl?: string;
  duration?: number;
  publishedDate?: string;
}>;

export type ContentArtifact = TextArtifact | VideoTranscriptArtifact;

export type ContentArtifactReference = Readonly<{
  contentId: string;
  pageUrl: string;
}>;

const CONTENT_PATH_PREFIX = "content/";

export async function persistTextArtifact(
  entry: Extract<FoloEntry, { kind: "text" }>,
): Promise<ContentArtifactReference> {
  return persistArtifact({
    kind: "text",
    text: entry.text,
    ...(entry.title !== undefined ? { title: entry.title } : {}),
    ...(entry.description !== undefined
      ? { description: entry.description }
      : {}),
    ...(entry.author !== undefined ? { author: entry.author } : {}),
  });
}

export async function persistVideoTranscriptArtifact(
  entry: Extract<FoloEntry, { kind: "video" }>,
  transcript: VideoTranscript,
): Promise<ContentArtifactReference> {
  return persistArtifact({
    kind: "video-transcript",
    platform: entry.platform,
    sourceUrl: entry.url,
    title: transcript.title,
    subtitles: transcript.subtitles,
    ...(transcript.author !== undefined ? { author: transcript.author } : {}),
    ...(transcript.description !== undefined
      ? { description: transcript.description }
      : entry.description !== undefined
        ? { description: entry.description }
        : {}),
    ...(transcript.coverUrl !== undefined
      ? { coverUrl: transcript.coverUrl }
      : {}),
    ...(transcript.duration !== undefined
      ? { duration: transcript.duration }
      : {}),
    ...(transcript.publishedDate !== undefined
      ? { publishedDate: transcript.publishedDate }
      : {}),
  });
}

async function persistArtifact(
  artifact: ContentArtifact,
): Promise<ContentArtifactReference> {
  const appUrl = process.env.SORTIFY_APP_URL;
  if (!appUrl) {
    throw new Error("SORTIFY_APP_URL is not configured.");
  }

  const contentId = randomUUID();
  const pageUrl = new URL(`/content/${contentId}`, appUrl).toString();
  await put(`${CONTENT_PATH_PREFIX}${contentId}.json`, JSON.stringify(artifact), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: false,
    contentType: "application/json; charset=utf-8",
  });

  return { contentId, pageUrl };
}

export async function readContentArtifact(
  contentId: string,
): Promise<ContentArtifact | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(contentId)) {
    return null;
  }

  const result = await get(`${CONTENT_PATH_PREFIX}${contentId}.json`, {
    access: "private",
  });
  if (!result) {
    return null;
  }

  const artifact: unknown = await new Response(result.stream).json().catch(() => null);
  if (typeof artifact !== "object" || artifact === null || !("kind" in artifact)) {
    return null;
  }

  if (artifact.kind === "text") {
    if (
      !("text" in artifact) ||
      typeof artifact.text !== "string" ||
      ("title" in artifact && typeof artifact.title !== "string") ||
      ("description" in artifact && typeof artifact.description !== "string") ||
      ("author" in artifact && typeof artifact.author !== "string")
    ) {
      return null;
    }
    return artifact as TextArtifact;
  }

  if (
    artifact.kind !== "video-transcript" ||
    !("platform" in artifact) ||
    (artifact.platform !== "YouTube" && artifact.platform !== "bilibili") ||
    !("sourceUrl" in artifact) ||
    typeof artifact.sourceUrl !== "string" ||
    !("title" in artifact) ||
    typeof artifact.title !== "string" ||
    !("subtitles" in artifact) ||
    !Array.isArray(artifact.subtitles) ||
    artifact.subtitles.length === 0 ||
    ("author" in artifact && typeof artifact.author !== "string") ||
    ("description" in artifact && typeof artifact.description !== "string") ||
    ("coverUrl" in artifact && typeof artifact.coverUrl !== "string") ||
    ("duration" in artifact &&
      (typeof artifact.duration !== "number" || !Number.isFinite(artifact.duration))) ||
    ("publishedDate" in artifact && typeof artifact.publishedDate !== "string")
  ) {
    return null;
  }

  for (const subtitle of artifact.subtitles) {
    if (
      typeof subtitle !== "object" ||
      subtitle === null ||
      !("text" in subtitle) ||
      typeof subtitle.text !== "string" ||
      ("startTime" in subtitle &&
        (typeof subtitle.startTime !== "number" ||
          !Number.isFinite(subtitle.startTime))) ||
      ("endTime" in subtitle &&
        (typeof subtitle.endTime !== "number" || !Number.isFinite(subtitle.endTime)))
    ) {
      return null;
    }
  }

  return artifact as VideoTranscriptArtifact;
}
