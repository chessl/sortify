import { get, put } from "@vercel/blob";
import { randomUUID } from "node:crypto";
import type { FoloEntry } from "@/lib/folo";

export type TextArtifact = Readonly<{
  kind: "text";
  text: string;
  title?: string;
  description?: string;
  author?: string;
}>;

export type TextArtifactReference = Readonly<{
  contentId: string;
  pageUrl: string;
}>;

const CONTENT_PATH_PREFIX = "content/";

export async function persistTextArtifact(
  entry: Extract<FoloEntry, { kind: "text" }>,
): Promise<TextArtifactReference> {
  const appUrl = process.env.SORTIFY_APP_URL;
  if (!appUrl) {
    throw new Error("SORTIFY_APP_URL is not configured.");
  }

  const contentId = randomUUID();
  const pageUrl = new URL(`/content/${contentId}`, appUrl).toString();
  const artifact: TextArtifact = {
    kind: "text",
    text: entry.text,
    ...(entry.title !== undefined ? { title: entry.title } : {}),
    ...(entry.description !== undefined
      ? { description: entry.description }
      : {}),
    ...(entry.author !== undefined ? { author: entry.author } : {}),
  };

  await put(`${CONTENT_PATH_PREFIX}${contentId}.json`, JSON.stringify(artifact), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: false,
    contentType: "application/json; charset=utf-8",
  });

  return {
    contentId,
    pageUrl,
  };
}

export async function readTextArtifact(
  contentId: string,
): Promise<TextArtifact | null> {
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
  if (
    typeof artifact !== "object" ||
    artifact === null ||
    !("kind" in artifact) ||
    artifact.kind !== "text" ||
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
