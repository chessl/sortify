export type FoloEntry = {
  url: string;
  title?: string;
  description?: string;
};

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
  };
  if (typeof entry.url !== "string") {
    return null;
  }

  try {
    const url = new URL(entry.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
  } catch {
    return null;
  }

  if (entry.title != null && typeof entry.title !== "string") {
    return null;
  }

  if (entry.description != null && typeof entry.description !== "string") {
    return null;
  }

  return {
    url: entry.url,
    ...(typeof entry.title === "string" ? { title: entry.title } : {}),
    ...(typeof entry.description === "string"
      ? { description: entry.description }
      : {}),
  };
}

