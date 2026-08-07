import { saveUrlToCubox } from "@/lib/cubox";
import type { FoloEntry } from "@/lib/folo";

export async function processEntryWorkflow(entry: FoloEntry) {
  "use workflow";

  return saveEntry(entry);
}

async function saveEntry(entry: FoloEntry) {
  "use step";

  return saveUrlToCubox(entry);
}
