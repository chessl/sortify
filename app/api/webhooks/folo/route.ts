import { parseFoloPayload } from "@/lib/folo";
import { processEntryWorkflow } from "@/workflows/process-entry";
import { start } from "workflow/api";

export async function POST(request: Request) {
  const payload: unknown = await request.json().catch(() => null);
  const entry = parseFoloPayload(payload);

  if (!entry) {
    return Response.json(
      { error: "A valid Folo entry URL or text content is required." },
      { status: 400 },
    );
  }

  try {
    const run = await start(processEntryWorkflow, [entry]);
    return Response.json({ runId: run.runId }, { status: 202 });
  } catch {
    return Response.json(
      { error: "Workflow handoff failed." },
      { status: 503 },
    );
  }
}
