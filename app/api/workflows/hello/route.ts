import { helloWorkflow } from "@/workflows/hello";
import { start } from "workflow/api";

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);

  if (
    !body ||
    typeof body !== "object" ||
    !("name" in body) ||
    typeof body.name !== "string"
  ) {
    return Response.json({ error: "Name is required." }, { status: 400 });
  }

  const name = body.name.trim();
  if (!name || name.length > 80) {
    return Response.json(
      { error: "Name must contain 1–80 characters." },
      { status: 400 },
    );
  }

  const run = await start(helloWorkflow, [name]);

  return Response.json({ runId: run.runId }, { status: 202 });
}
