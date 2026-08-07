import { readContentArtifact } from "@/lib/content";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function ContentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const artifact = await readContentArtifact(id);
  if (!artifact) {
    notFound();
  }

  if (artifact.kind === "text") {
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

  return (
    <main style={{ margin: "3rem auto", maxWidth: "48rem", padding: "0 1.5rem" }}>
      <article>
        <header>
          <h1>{artifact.title}</h1>
          <p>Platform: {artifact.platform}</p>
          {artifact.author ? <p>By {artifact.author}</p> : null}
          {artifact.description ? <p>{artifact.description}</p> : null}
          {artifact.duration !== undefined ? (
            <p>Duration: {formatTimestamp(artifact.duration)}</p>
          ) : null}
          {artifact.publishedDate ? (
            <p>Published: {artifact.publishedDate}</p>
          ) : null}
          {artifact.coverUrl ? <p>Cover: {artifact.coverUrl}</p> : null}
          <p>
            <a href={artifact.sourceUrl}>Open original video</a>
          </p>
        </header>
        <h2>Full transcript</h2>
        <ol>
          {artifact.subtitles.map((subtitle, index) => (
            <li key={index}>
              {subtitle.startTime !== undefined || subtitle.endTime !== undefined ? (
                <p>
                  {subtitle.startTime !== undefined
                    ? formatTimestamp(subtitle.startTime)
                    : "?"}
                  {" – "}
                  {subtitle.endTime !== undefined
                    ? formatTimestamp(subtitle.endTime)
                    : "?"}
                </p>
              ) : null}
              <p style={{ lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
                {subtitle.text}
              </p>
            </li>
          ))}
        </ol>
      </article>
    </main>
  );
}

function formatTimestamp(seconds: number) {
  const totalMilliseconds = Math.round(seconds * 1_000);
  const wholeSeconds = Math.floor(totalMilliseconds / 1_000);
  const hours = Math.floor(wholeSeconds / 3_600);
  const minutes = Math.floor((wholeSeconds % 3_600) / 60);
  const remainder = wholeSeconds % 60;
  const milliseconds = totalMilliseconds % 1_000;
  const clock = [hours, minutes, remainder]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
  return milliseconds === 0
    ? clock
    : `${clock}.${String(milliseconds).padStart(3, "0")}`;
}
