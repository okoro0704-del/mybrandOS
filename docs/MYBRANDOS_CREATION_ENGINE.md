# mybrandOS Creation Engine

The Creation Engine is the reusable infrastructure for every future studio. It is not a book editor, course builder, or DAW. Those studios will inherit this engine.

## Architecture

```
User
 → CreationProject
    → Workspace (overview, editor, content, files, versions, AI, publish, settings)
    → ContentBlock[]
    → ProjectFile[]   → DataZone object ids
    → ProjectVersion[]
    → AiAction[]
    → Asset (on publish)
```

One engine. Project type is metadata. Adding `PODCAST_SHOW` later does not require a new editor stack.

## Data model

- **CreationProject** — `id, ownerId, title, description, projectType, status, origin, assetId`
- **ContentBlock** — ordered generic blocks (`TEXT`, `HEADING`, `IMAGE`, `VIDEO`, `AUDIO`, `FILE`, `EMBED`, `AI_GENERATED`, `CUSTOM`, plus future types)
- **ProjectVersion** — explicit snapshots. Autosave never writes these.
- **ProjectFile** — DataZone references only
- **AiAction** — provider-agnostic action log (no raw logging of private content)
- **AssetRelationship** — `DERIVED_FROM`, `SOURCE_OF`, `VERSION_OF`, `RELATED_TO`, `PART_OF`
- **ProjectMember** — `OWNER | EDITOR | VIEWER`

Project types and block types are stored as strings and checked against registries. Unknown values are allowed so studios can extend without a schema rewrite.

## State transitions

Project: `DRAFT → IN_PROGRESS → READY_TO_PUBLISH → PUBLISHED → IN_PROGRESS|ARCHIVED`

Invalid jumps (for example `DRAFT → PUBLISHED`) are rejected.

Publish status is separate: `DRAFT | READY | PUBLISHED | UNPUBLISHED | ARCHIVED`.

## AI abstraction

`IAiProvider` in `@mybrandos/integrations`.

- `unbound` — honest unavailable state
- `openai` — only when `AI_PROVIDER=openai` and `OPENAI_API_KEY` are set
- `test` — tests only

AI is a capability inside the workspace. Manual creation never requires it. AI output is always editable.

## Import flow

Import creates a first-class Asset **and** a CreationProject with origin `IMPORTED_*`, attaches the DataZone file, and opens a working copy. Imported work is not read-only.

## Publishing flow

`Publish` creates or updates the Asset, stores `sourceProjectId`, sets Personal Space up if needed, and exposes analytics / distribution / commerce hooks. The engine does not rebuild Personal Space.

## Integration boundaries

| System | Role |
|---|---|
| Trust ID | Identity / session |
| DataZone | File bytes |
| ElfCom | Messaging (unrelated to draft content) |
| FundzMan | Future commerce settlement |
| Distribution | Publish/syndicate hook |
| AI provider | Optional generation |

Local adapters remain labeled as local. They do not pretend to be production services.

## How to build a new Creation Studio

1. Register the project type in `PROJECT_TYPES` (or pass a new string — the engine accepts it).
2. Map it to an Asset type in `PROJECT_TYPE_TO_ASSET_TYPE` if the default `OTHER` is wrong.
3. Add a launcher tile.
4. Optionally replace the generic Editor/Content panes with studio-specific views that still read/write `ContentBlock` and call the same APIs.
5. Do **not** copy versioning, AI, files, or publishing. Call the engine.

Example: Book Studio later customizes block semantics (chapter, footnote) as `CUSTOM` or new registered types. Versions, AI, DataZone, and publish stay shared.

## Reference Implementation: Book Studio

Book Studio (BUILD PROMPT 003) is the proof that a specialized studio can sit on this engine without forking it.

What Book Studio reused unchanged:

- `CreationProject` with `projectType = BOOK`
- `ContentBlock` for all manuscript text and media
- `ProjectVersion` / `restoreVersion` (the snapshot may include a `book` extra)
- `ProjectFile` + DataZone for manuscripts, images, and covers
- `AiAction` + `IAiProvider`
- `publishProject()`, Personal Space upsert, analytics/commerce/distribution hooks
- `requireAction()` OWNER / EDITOR / VIEWER

What Book Studio added, and only this:

- `BookMetadata`, `BookChapter`, `BookSection`
- Derived TOC, word counts, book validation
- A specialized editor/preview at `/create/:id` when the project type is BOOK
- Manuscript import that still creates an Asset + CreationProject

How a future studio should extend the engine:

1. Register or pass a `projectType` (`COURSE`, `VIDEO`, …).
2. Attach studio metadata to `CreationProject.id`. Do not create a parallel project table.
3. Express hierarchy (modules, scenes, tracks) as studio structure rows that point at engine `ContentBlock`s.
4. Call existing save, version, file, AI, and publish APIs.
5. Validate in the studio, then publish through the engine.
6. Represent the published work as an `Asset` with `sourceProjectId`.

If a studio needs its own projects, blocks, versions, or publish pipeline, the architecture has already failed. Copy Book Studio’s shape instead.

## Reference Implementation: Course Studio

Course Studio (BUILD PROMPT 005) is the second proof that a specialized studio can sit on this engine.

What Course Studio reused unchanged:

- `CreationProject` with `projectType = COURSE`
- `ContentBlock` for lesson text and media
- `ProjectVersion` / `restoreVersion` (the snapshot may include a `course` extra)
- `ProjectFile` + DataZone
- `AiAction` + `IAiProvider`
- `publishProject()`, Personal Space, analytics/commerce/distribution hooks
- `requireAction()` OWNER / EDITOR / VIEWER
- Asset Intelligence (search, lineage, health, actions)

What Course Studio added, and only this:

- `CourseMetadata`, `CourseModule`, `CourseLesson`, `CourseQuizQuestion`
- Course validation, duration estimates, and a learner-oriented preview
- Book → Course structure proposal (does not rewrite the book)
- Course material import that still creates an Asset + CreationProject

How Course Studio differs from Book Studio:

- Hierarchy is module → lesson, not chapter → section
- Lessons have types and readiness status
- Quizzes belong to lessons
- Preview is learner-oriented, not a print-style book

Both studios publish through the same engine and inherit Asset Intelligence without a second stack.

## Asset Intelligence

Published and draft assets created by this engine automatically participate in Asset Intelligence:

- capabilities and actions
- lineage (`SOURCE_OF` / `DERIVED_FROM`)
- search
- activity
- Personal Space / commerce / distribution hooks
- analytics identity
- AI context (metadata only unless authorized)

A Course Studio that creates `CreationProject` + `Asset(type=COURSE)` inherits that layer. It does not rebuild it.
