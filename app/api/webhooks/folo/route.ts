import { parseFoloPayload } from "@/lib/folo";
import { processEntryWorkflow } from "@/workflows/process-entry";
import { start } from "workflow/api";

export async function POST(request: Request) {
  const expectedSecret = process.env.FOLO_WEBHOOK_SECRET;
  if (!expectedSecret) {
    return Response.json(
      { error: "Webhook authentication is not configured." },
      { status: 503 },
    );
  }

  const providedSecret = new URL(request.url).searchParams.get("secret");
  if (providedSecret !== expectedSecret) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const payload: unknown = await request.json().catch(() => null);
  const entry = parseFoloPayload(payload);

  if (!entry) {
    return Response.json(
      { error: "A valid Folo entry URL or text content is required." },
      { status: 400 },
    );
  }

  try {
    const run = await start(processEntryWorkflow, [entry], { region: "hkg1" });
    return Response.json({ runId: run.runId }, { status: 202 });
  } catch {
    return Response.json(
      { error: "Workflow handoff failed." },
      { status: 503 },
    );
  }
}
