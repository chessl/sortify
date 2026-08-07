import {
  persistTextArtifact,
  type TextArtifactReference,
} from "@/lib/content";
import { saveUrlToCubox } from "@/lib/cubox";
import type { FoloEntry } from "@/lib/folo";

export async function processEntryWorkflow(entry: FoloEntry) {
  "use workflow";

  if (entry.kind === "url") {
    return saveUrlEntry(entry);
  }

  const reference = await persistTextEntry(entry);
  return saveTextEntry(entry, reference);
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
  reference: TextArtifactReference,
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
