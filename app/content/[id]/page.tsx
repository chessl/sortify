import { readTextArtifact } from "@/lib/content";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function ContentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const artifact = await readTextArtifact(id);
  if (!artifact) {
    notFound();
  }

  return (
    <main style={{ margin: "3rem auto", maxWidth: "48rem", padding: "0 1.5rem" }}>
      <article>
        <header>
          <h1>{artifact.title ?? "Text content"}</h1>
          {artifact.author ? <p>By {artifact.author}</p> : null}
          {artifact.description ? <p>{artifact.description}</p> : null}
        </header>
        <p style={{ lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
          {artifact.text}
        </p>
      </article>
    </main>
  );
}
