import { MATTER_LABELS, type BookChapter, type BookMetadata, type ContentBlock, type TocEntry } from "@mybrandos/shared";
import { blockText } from "../creation/types";
import { renderBookText } from "./richtext";
import { AuthMedia } from "./AuthMedia";

export function BookPreview({
  projectId,
  title,
  metadata,
  chapters,
  toc,
  allBlocks,
  mobile,
}: {
  projectId: string;
  title: string;
  metadata: BookMetadata;
  chapters: BookChapter[];
  toc: TocEntry[];
  allBlocks: ContentBlock[];
  mobile: boolean;
}) {
  const blocksFor = (chapterId: string, sectionId?: string) =>
    allBlocks.filter((block) => {
      const cid = String(block.metadata.chapterId ?? "");
      const sid = String(block.metadata.sectionId ?? "");
      if (cid !== chapterId) return false;
      if (sectionId) return sid === sectionId;
      return true;
    });

  return (
    <div className={`book-preview${mobile ? " mobile" : ""}`}>
      <article className="book-page title-page">
        {metadata.coverFileId ? (
          <AuthMedia
            path={`/projects/${projectId}/files/${metadata.coverFileId}/content`}
            alt={`${title} cover`}
            className="book-cover"
          />
        ) : null}
        <h1>{title}</h1>
        {metadata.subtitle ? <h2>{metadata.subtitle}</h2> : null}
        <p>{metadata.authorName || "Author"}</p>
      </article>

      {chapters.map((chapter) => (
        <article key={chapter.id} id={`chapter-${chapter.id}`} className="book-page">
          <div className="eyebrow">
            {chapter.matterType ? MATTER_LABELS[chapter.matterType] ?? chapter.kind : chapter.kind}
          </div>
          <h2>{chapter.title}</h2>
          {chapter.matterType === "TABLE_OF_CONTENTS" ? (
            <nav className="book-toc">
              {toc.map((entry) => (
                <a key={entry.id} href={`#chapter-${entry.chapterId}`} className={entry.sectionId ? "indent" : ""}>
                  {entry.title}
                </a>
              ))}
            </nav>
          ) : null}
          {chapter.sections.length === 0
            ? blocksFor(chapter.id).map((block) => <PreviewBlock key={block.id} projectId={projectId} block={block} />)
            : chapter.sections.map((section) => (
                <section key={section.id} id={`section-${section.id}`}>
                  <h3>{section.title}</h3>
                  {blocksFor(chapter.id, section.id).map((block) => (
                    <PreviewBlock key={block.id} projectId={projectId} block={block} />
                  ))}
                </section>
              ))}
        </article>
      ))}
    </div>
  );
}

function PreviewBlock({ projectId, block }: { projectId: string; block: ContentBlock }) {
  if (block.type === "DIVIDER") return <hr />;
  if (block.type === "IMAGE") {
    const fileId = String(block.content.fileId ?? "");
    return (
      <figure>
        {fileId ? <AuthMedia path={`/projects/${projectId}/files/${fileId}/content`} alt={String(block.content.alt ?? "")} className="book-image" /> : null}
        {block.content.caption ? <figcaption>{String(block.content.caption)}</figcaption> : null}
      </figure>
    );
  }
  const html = renderBookText(blockText(block));
  if (block.type === "HEADING") return <h3 dangerouslySetInnerHTML={{ __html: html }} />;
  if (block.type === "QUOTE") return <blockquote dangerouslySetInnerHTML={{ __html: html }} />;
  return <p dangerouslySetInnerHTML={{ __html: html }} style={{ textAlign: String(block.metadata.align ?? "left") as "left" }} />;
}
