# mybrandOS Course Studio

Course Studio is the second reference specialized creation product. It does not replace the Universal Creation Engine or Asset Intelligence. It extends both.

```
CreationEngine
 → CreationProject (projectType = COURSE)
    → CourseMetadata
    → CourseModule / CourseLesson
    → CourseQuizQuestion
    → ContentBlock (engine)
    → ProjectFile → DataZone
    → ProjectVersion (engine snapshot includes course structure)
    → AiAction (engine provider)
    → Asset (type = COURSE, sourceProjectId)
 → Asset Intelligence
```

## Course-specific models

- **CourseMetadata** — subtitle, description, instructor, language, level, category, estimated duration, thumbnail. Pricing is not stored here.
- **CourseModule** — title, description, position.
- **CourseLesson** — title, description, position, `lessonType` (`TEXT | VIDEO | AUDIO | FILE | QUIZ | MIXED`), status (`DRAFT | READY | PUBLISHED`).
- **CourseQuizQuestion** — prompt, `MULTIPLE_CHOICE | TRUE_FALSE`, answers, correct answer, explanation.

There is no CourseProject, CourseBlock, CourseVersion, CourseAsset, CourseAI, or CoursePublishing.

## Structure

```
COURSE
 ├── Course Overview (CourseMetadata)
 └── Module
      └── Lesson
           ├── ContentBlocks
           └── Quiz questions (optional)
```

Blocks store `metadata.moduleId` and `metadata.lessonId`. Deleting a module or lesson does not delete blocks.

## Book → Course

Asset Intelligence `transformAsset(BOOK → COURSE)` creates a COURSE project, a first-class draft COURSE Asset, and a `SOURCE_OF` relationship.

Course Studio then proposes modules from book chapters and lessons from sections. The user accepts or rejects. The original book is not rewritten.

Honest copy: “Course structure generated from your book.”

## Import

`POST /courses/import` preserves original files in DataZone, creates a COURSE Asset and COURSE CreationProject, and extracts structure only from Module/Lesson headings or obvious media types. Unclassified files are attached as resources and listed in the import report.

## AI

Course Studio calls the existing `IAiProvider` through `invokeAi`. Unbound AI returns `ai_unavailable`. Outline generation is a proposal. The user must accept it.

## Publishing

`POST /courses/:id/publish` validates, then calls `publishProject()`.

Required: title, description, instructor, at least one module and lesson, valid lesson content or resources, valid quizzes, owner publish permission.

The published Asset is `type = COURSE` with `sourceProjectId`. Personal Space, analytics identity, commerce, and distribution hooks are the engine hooks.

## Asset Intelligence

A published or imported course automatically participates in capabilities, search (including module and lesson titles), lineage, activity, health, AI context, Personal Space, and commerce/distribution hooks.

## How this differs from Book Studio

Both studios use the same engine. Book Studio adds chapters/sections/front matter. Course Studio adds modules/lessons/quizzes and a learner-oriented preview. Neither copies versioning, files, AI, publish, or intelligence.
