"use client";

import { FormEvent, useState } from "react";

type StartResult = { runId: string } | { error: string };

export default function Home() {
  const [result, setResult] = useState<StartResult | null>(null);
  const [pending, setPending] = useState(false);

  async function startWorkflow(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setResult(null);

    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/workflows/hello", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: form.get("name") }),
    });
    const data = (await response.json()) as StartResult;

    setResult(data);
    setPending(false);
  }

  return (
    <main>
      <section>
        <p className="eyebrow">Next.js + Vercel Workflow</p>
        <h1>Start a durable hello workflow.</h1>
        <p className="intro">
          Each request starts a persisted workflow and runs its greeting as a
          retryable step.
        </p>

        <form onSubmit={startWorkflow}>
          <label htmlFor="name">Name</label>
          <div className="controls">
            <input id="name" name="name" maxLength={80} required defaultValue="World" />
            <button disabled={pending} type="submit">
              {pending ? "Starting…" : "Start workflow"}
            </button>
          </div>
        </form>

        {result && (
          <output>
            {"runId" in result ? `Started run ${result.runId}` : result.error}
          </output>
        )}
      </section>
    </main>
  );
}
