import type { ContentBlock, CourseMetadata, CourseModule } from "@mybrandos/shared";
import { blockText } from "../creation/types";
import { renderBookText } from "../book/richtext";
import { AuthMedia } from "../book/AuthMedia";

export function CoursePreview({
  projectId,
  title,
  metadata,
  modules,
  allBlocks,
  mobile,
}: {
  projectId: string;
  title: string;
  metadata: CourseMetadata;
  modules: CourseModule[];
  allBlocks: ContentBlock[];
  mobile: boolean;
}) {
  const blocksFor = (lessonId: string) =>
    allBlocks.filter((block) => String(block.metadata.lessonId ?? "") === lessonId);

  return (
    <div className={`book-preview${mobile ? " mobile" : ""}`}>
      <article className="book-page title-page">
        {metadata.thumbnailFileId ? (
          <AuthMedia
            path={`/projects/${projectId}/files/${metadata.thumbnailFileId}/content`}
            alt={`${title} thumbnail`}
            className="book-cover"
          />
        ) : null}
        <div className="eyebrow">Course preview</div>
        <h1>{title}</h1>
        {metadata.subtitle ? <h2>{metadata.subtitle}</h2> : null}
        <p>{metadata.instructorName || "Instructor"}</p>
        <p>{metadata.description}</p>
        <p className="small muted">{metadata.level || "All levels"}{metadata.category ? ` · ${metadata.category}` : ""}</p>
      </article>

      <article className="book-page">
        <h2>Modules</h2>
        <nav className="book-toc">
          {modules.map((module) => (
            <div key={module.id}>
              <a href={`#module-${module.id}`}>{module.title}</a>
              {module.lessons.map((lesson) => (
                <a key={lesson.id} href={`#lesson-${lesson.id}`} className="indent">{lesson.title}</a>
              ))}
            </div>
          ))}
        </nav>
      </article>

      {modules.map((module) => (
        <article key={module.id} id={`module-${module.id}`} className="book-page">
          <div className="eyebrow">Module</div>
          <h2>{module.title}</h2>
          {module.description ? <p>{module.description}</p> : null}
          {module.lessons.map((lesson) => (
            <section key={lesson.id} id={`lesson-${lesson.id}`}>
              <h3>{lesson.title}</h3>
              <p className="small muted">{lesson.lessonType} · {lesson.status}</p>
              {lesson.description ? <p>{lesson.description}</p> : null}
              {blocksFor(lesson.id).map((block) => (
                <PreviewBlock key={block.id} projectId={projectId} block={block} />
              ))}
              {lesson.questions.length ? (
                <div className="panel" style={{ marginTop: 12 }}>
                  <div className="eyebrow">Quiz</div>
                  {lesson.questions.map((question) => (
                    <div key={question.id} style={{ marginBottom: 10 }}>
                      <strong>{question.prompt}</strong>
                      <ul>
                        {question.answers.map((answer) => (
                          <li key={answer.id}>{answer.text}</li>
                        ))}
                      </ul>
                      {question.explanation ? <p className="small muted">{question.explanation}</p> : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </section>
          ))}
        </article>
      ))}
    </div>
  );
}

function PreviewBlock({ projectId, block }: { projectId: string; block: ContentBlock }) {
  if (block.type === "DIVIDER") return <hr />;
  if (block.type === "IMAGE" || block.type === "VIDEO" || block.type === "AUDIO" || block.type === "FILE") {
    const fileId = String(block.content.fileId ?? block.content.projectFileId ?? "");
    if (!fileId) return <p className="muted">Missing file.</p>;
    if (block.type === "IMAGE") {
      return <AuthMedia path={`/projects/${projectId}/files/${fileId}/content`} alt={String(block.content.alt ?? "")} className="book-image" />;
    }
    return (
      <p>
        <a href={`/api/projects/${projectId}/files/${fileId}/content`} target="_blank" rel="noreferrer">
          {String(block.content.filename ?? block.type)}
        </a>
      </p>
    );
  }
  return <div dangerouslySetInnerHTML={{ __html: renderBookText(blockText(block)) }} />;
}
