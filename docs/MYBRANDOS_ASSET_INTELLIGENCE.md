# mybrandOS Asset Intelligence

Asset Intelligence is the Digital Life layer. It does not replace Trust ID, DataZone, the Creation Engine, Personal Space, FundzMan, or Distribution. It understands Assets and exposes what a person can do with them.

```
User
 → Assets
    → Relationships / Lineage
    → Personal Space
    → Audience (boundary)
    → Commerce (hooks)
    → Distribution (intents)
    → Analytics identity
    → Actions / AI context
```

Course Studio now publishes COURSE Assets into this same layer. Search also matches module and lesson titles. Book → Course uses `transformAsset` plus a structure proposal; the book is not rewritten.

## Asset model

The existing `Asset` remains the only first-class object. Origin is metadata. Imported work is first-class.

Intelligence is assembled at read time from:

- Asset + source `CreationProject`
- `ProjectFile` / DataZone ids
- `AssetRelationship`
- `Activity`
- Personal Space, commerce items, distribution intents
- Integration adapter health

No per-studio relationship tables.

## Capabilities

`EDIT VIEW PUBLISH DISTRIBUTE MONETIZE DOWNLOAD TRANSFORM SHARE ANALYZE`

The UI asks the capability layer. Origin never removes a capability. A missing studio or unbound integration explains why an action is unavailable.

## Relationships and lineage

Reuse `AssetRelationship`.

Directed types (`SOURCE_OF`, `DERIVED_FROM`, `VERSION_OF`, `PART_OF`) cannot form cycles. Duplicates are rejected.

```
getParents / getChildren / getRelated / getLineage
```

Book → Create Course uses `SOURCE_OF` from the book asset to a new COURSE draft asset.

## Actions

Actions are capability + catalog. Unavailable actions state the reason, for example “Audio Studio coming soon.” They do not open fake tools.

## Health

`HEALTHY | NEEDS_ATTENTION | INCOMPLETE | UNPUBLISHED | PUBLISHING_BLOCKED | INTEGRATION_PENDING`

Issues come from real state (missing book cover, unpublished draft, unbound commerce). Course lesson counts are not invented.

## Activity

`Activity` records created, imported, published, derived, archived, AI used. Details never include private manuscript text.

## Search and filters

`GET /search?q=` looks across existing asset, project, commerce, audience, and activity metadata. Results are typed (`BOOK`, `PROJECT`, `PRODUCT`, …).

`GET /assets` filters by type, origin, status, visibility, published, imported, created internally, project, Personal Space, revenue, audience, and created/updated dates. `hasAudience=true` currently returns an empty set because audience analytics are not connected. Summaries use count/groupBy queries so a large library does not load every row.

## AI context

`POST /assets/:id/ai` sends metadata, health, capabilities, and relationship counts. Content is included only when the caller has AI permission and `includeContent=true`. Another user’s private assets cannot be sent. Unbound AI returns `ai_unavailable`.

## Integration states

Each asset reports Personal Space, distribution, commerce, audience, analytics, DataZone, and AI honestly. FundzMan and analytics numbers are not fabricated.

## Security

Every intelligence endpoint uses asset authorization (owner, or project role when a source project exists). DataZone bytes are not deleted on asset delete. Analytics identity is `{ assetId, projectId, ownerId }`.

## Extension model

A future studio should:

1. Publish or draft an Asset through the Creation Engine.
2. Set `sourceProjectId`.
3. Optionally add studio metadata for health.
4. Call `transformAsset` / `createSafeRelationship` for lineage.

It should not build a second search, activity, permission, or analytics system.
