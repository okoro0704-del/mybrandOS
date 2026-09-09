# mybrandOS Book Studio

Book Studio is the reference specialized creation product. It does not replace the Universal Creation Engine. It extends it.

```
CreationEngine
 → CreationProject (projectType = BOOK)
    → BookMetadata
    → BookChapter / BookSection
    → ContentBlock (engine)
    → ProjectFile → DataZone
    → ProjectVersion (engine snapshot includes book structure)
    → AiAction (engine provider)
    → Asset (type = BOOK, sourceProjectId)
```

## Book-specific models

- **BookMetadata** — subtitle, author, language, genre, description, ISBN, edition, publisher, copyright, cover file. ISBN and publisher are optional on drafts.
- **BookChapter** — title, slug, position, status, `kind` (`FRONT_MATTER | CHAPTER | BACK_MATTER`), optional `matterType`.
- **BookSection** — title and position inside a chapter.

There is no second block, file, version, AI, or publish system.

## Structure model

```
BOOK
 ├── Front Matter (optional Title Page, Copyright, Dedication, Preface, Foreword, TOC)
 ├── Chapter
 │    ├── Section
 │    └── ContentBlocks
 └── Back Matter (optional Afterword, Appendix, Acknowledgements, References, About the Author)
```

The table of contents is derived from chapter → section → position. It is never a separately maintained list.

Content blocks store `metadata.chapterId` and `metadata.sectionId`. Deleting a chapter or section does not delete blocks.

## Editor architecture

`/create/:id` opens Book Studio when `projectType === BOOK`.

Desktop: structure | editor | context.
Mobile: structure drawer, editor, context sheet, sticky save/preview.

Writing uses engine block types: Text, Heading, Image, Video, Audio, File, Quote, List, Divider. Rich text is lightweight (bold, italic, underline, headings, lists, links, quotes, alignment).

Word counts and estimated reading time (~200 wpm) are calculated from actual block text.

## Import behavior

`POST /books/import` stores the original file in DataZone, creates a BOOK Asset and BOOK CreationProject, attaches the source file, and extracts structure only where headings are reliable.

TXT/Markdown can produce chapters. PDF/DOC/DOCX/EPUB keep the original file and report what could not be classified. The importer does not invent structure.

## AI behavior

Book Studio calls the existing `IAiProvider` through `invokeAi`. If no provider is configured, the API returns `ai_unavailable` and the UI shows **AI unavailable**.

Book context (selection, section, chapter, or book excerpt) is added to the instruction. Outline generation is a proposal. The user must accept it.

## Publishing

`POST /books/:id/publish` validates, then calls `publishProject()`.

Validation requires a title, author, at least one chapter/content body, valid structure, and owner publish permission. Cover is recommended, not required.

The published Asset is `type = BOOK` with `sourceProjectId`. Personal Space, analytics identity, commerce, and distribution hooks are the engine hooks.

## Asset relationship

The book remains editable in its CreationProject after publish. The Asset is a published surface, not a copy of the manuscript.

## Asset Intelligence

A published or imported book is a first-class Asset. Opening it in the library loads Asset Intelligence, not a second book database.

Book Studio participates by:

- setting `sourceProjectId` on the BOOK Asset
- writing book metadata into Asset metadata for search
- using engine publish, which records activity and Personal Space
- offering **Create Course** as a real `transformAsset` action
- showing honest “Audio Studio coming soon” for audiobook

Health can surface real Book Studio validation (cover, author) without inventing unrelated requirements.

## Extension points

Course Studio copied this pattern: `CourseMetadata` + modules/lessons/quizzes, engine blocks, engine publish, Asset Intelligence.

Future studios should copy this pattern:

1. Keep `CreationProject`.
2. Add a typed metadata + structure table.
3. Scope `ContentBlock.metadata` instead of creating a new editor store.
4. Let `ProjectVersion` snapshot studio extras.
5. Publish through the engine after studio validation.
