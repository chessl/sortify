export type TranscriptSegment = Readonly<{
  text: string;
  startTime?: number;
  endTime?: number;
}>;

export type VideoTranscript = Readonly<{
  title: string;
  subtitles: readonly TranscriptSegment[];
  author?: string;
  description?: string;
  coverUrl?: string;
  duration?: number;
  publishedDate?: string;
}>;

type VideoTranscriptResult =
  | Readonly<{ outcome: "ready"; transcript: VideoTranscript }>
  | Readonly<{ outcome: "unavailable" }>;

const DEFAULT_BIBIGPT_API_URL =
  "https://api.bibigpt.co/api/v1/getSubtitle";

export async function getVideoTranscript(
  sourceUrl: string,
): Promise<VideoTranscriptResult> {
  const token = process.env.BIBIGPT_API_TOKEN;
  if (!token) {
    throw new Error("BIBIGPT_API_TOKEN is not configured.");
  }

  const endpoint = new URL(
    process.env.BIBIGPT_API_URL ?? DEFAULT_BIBIGPT_API_URL,
  );
  endpoint.searchParams.set("url", sourceUrl);

  let response: Response;
  try {
    response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    return { outcome: "unavailable" };
  }

  const body: unknown = await response.json().catch(() => null);
  if (
    !response.ok ||
    typeof body !== "object" ||
    body === null ||
    !("success" in body) ||
    body.success !== true ||
    !("detail" in body) ||
    typeof body.detail !== "object" ||
    body.detail === null
  ) {
    return { outcome: "unavailable" };
  }

  const detail = body.detail as Record<string, unknown>;
  if (
    typeof detail.title !== "string" ||
    detail.title.length === 0 ||
    !Array.isArray(detail.subtitlesArray) ||
    detail.subtitlesArray.length === 0 ||
    !detail.subtitlesArray.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        "text" in item &&
        typeof item.text === "string",
    )
  ) {
    return { outcome: "unavailable" };
  }

  const subtitles = detail.subtitlesArray.map((item) => {
    const segment = item as Record<string, unknown>;
    return {
      text: segment.text as string,
      ...(isFiniteNumber(segment.startTime)
        ? { startTime: segment.startTime }
        : {}),
      ...(isFiniteNumber(segment.end) ? { endTime: segment.end } : {}),
    };
  });

  return {
    outcome: "ready",
    transcript: {
      title: detail.title,
      subtitles,
      ...(typeof detail.author === "string" ? { author: detail.author } : {}),
      ...(typeof detail.description === "string"
        ? { description: detail.description }
        : typeof detail.descriptionText === "string"
          ? { description: detail.descriptionText }
          : {}),
      ...(typeof detail.cover === "string" ? { coverUrl: detail.cover } : {}),
      ...(isFiniteNumber(detail.duration) ? { duration: detail.duration } : {}),
      ...(typeof detail.publishedDate === "string"
        ? { publishedDate: detail.publishedDate }
        : {}),
    },
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
