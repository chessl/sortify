type FoloMetadata = {
  title?: string;
  description?: string;
};

export type FoloEntry =
  | (FoloMetadata & {
      kind: "url";
      url: string;
    })
  | (FoloMetadata & {
      kind: "text";
      text: string;
      author?: string;
    });

export function parseFoloPayload(payload: unknown): FoloEntry | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return null;
  }

  const envelope = payload as { entry?: unknown };
  if (
    typeof envelope.entry !== "object" ||
    envelope.entry === null ||
    Array.isArray(envelope.entry)
  ) {
    return null;
  }

  const entry = envelope.entry as {
    url?: unknown;
    title?: unknown;
    description?: unknown;
    content?: unknown;
    author?: unknown;
  };

  if (entry.title != null && typeof entry.title !== "string") {
    return null;
  }

  if (entry.description != null && typeof entry.description !== "string") {
    return null;
  }


  const metadata: FoloMetadata = {
    ...(typeof entry.title === "string" ? { title: entry.title } : {}),
    ...(typeof entry.description === "string"
      ? { description: entry.description }
      : {}),
  };

  if (typeof entry.url === "string") {
    try {
      const url = new URL(entry.url);
      if (url.protocol === "http:" || url.protocol === "https:") {
        return { kind: "url", url: entry.url, ...metadata };
      }
    } catch {}
  }

  if (typeof entry.content !== "string" || entry.content.length === 0) {
    return null;
  }

  return {
    kind: "text",
    text: entry.content,
    ...metadata,
    ...(typeof entry.author === "string" ? { author: entry.author } : {}),
  };
}

