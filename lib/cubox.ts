type CuboxUrlCard = {
  url: string;
  title?: string;
  description?: string;
};

const CUBOX_TITLE_LIMIT = 256;
const CUBOX_DESCRIPTION_LIMIT = 300;

export async function saveUrlToCubox(entry: CuboxUrlCard) {
  const apiUrl = process.env.CUBOX_API_URL;
  if (!apiUrl) {
    throw new Error("CUBOX_API_URL is not configured.");
  }

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "url",
      content: entry.url,
      ...(entry.title !== undefined
        ? { title: entry.title.slice(0, CUBOX_TITLE_LIMIT) }
        : {}),
      ...(entry.description !== undefined
        ? {
            description: entry.description.slice(0, CUBOX_DESCRIPTION_LIMIT),
          }
        : {}),
    }),
  });
  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(`Cubox request failed with HTTP ${response.status}.`);
  }

  if (
    typeof body !== "object" ||
    body === null ||
    !("code" in body) ||
    body.code !== 200
  ) {
    throw new Error("Cubox rejected the save request.");
  }

  return { outcome: "saved" as const, url: entry.url };
}
