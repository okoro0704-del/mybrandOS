# PostgreSQL + versioned migrations

mybrandOS moved from SQLite on a Railway volume (schema applied with `prisma db push`, including at
container start) to PostgreSQL with committed Prisma migrations.

## Rules

- `apps/api/prisma/migrations/` is the only source of schema truth in a database. Never `db push`
  against a shared or production database; the `db:push` scripts were removed.
- Schema changes: edit `schema.prisma`, then `npm run db:migrate:dev -w @mybrandos/api -- --name <change>`,
  and commit the generated folder. Never edit a migration that has been applied anywhere.
- Migrations run **explicitly** (`npm run db:migrate:deploy`), never implicitly at app start.
- The API refuses to start unless the database matches the committed migrations exactly:
  no history, pending, unknown (DB newer than code), failed, or edited-after-apply migrations all
  stop startup with a precise message (`src/lib/migration-guard.ts`).
- CI fails if `schema.prisma` drifts from the migrations (`npm run db:migrate:check`).
- Migration SQL is pinned to LF (`.gitattributes`) because Prisma checksums the exact bytes.

## Migrations

| Migration | Contents |
|---|---|
| `20261005000000_postgres_baseline` | Every table that existed in SQLite, unchanged. |
| `20261005000100_relational_social` | `PostComment`, `PostReaction`, `AssetEngagement` (additive only). |

The old SQLite fragment `20260924000000_production_data_plane` was never applied by `migrate` and
is SQLite SQL; it is preserved under `prisma/legacy-sqlite/` for history only.

## Development and tests

```bash
docker compose -f docker-compose.dev.yml up -d     # Postgres 16 on 127.0.0.1:5433 (+ mybrandos_shadow)
# apps/api/.env
DATABASE_URL=postgresql://mybrandos:mybrandos@127.0.0.1:5433/mybrandos?schema=public
SHADOW_DATABASE_URL=postgresql://mybrandos:mybrandos@127.0.0.1:5433/mybrandos_shadow
npm run db:migrate:deploy
npm test
```

Tests share one database and isolate by owner id (each test file cleans its own owners).
Tests that need a pristine database create a throwaway Postgres schema and drop it afterwards.
The data-migration tests also need `npm run db:generate:legacy -w @mybrandos/api`.

## Production cutover (controlled; requires a maintenance window)

Production data currently lives in SQLite at `/app/apps/api/data/prod.db` on the Railway volume.

1. **Provision** a Railway PostgreSQL database. Set `DATABASE_URL` on the API service.
   Keep the volume attached (it is the rollback source).
2. **Pre-deploy command** on the API service: `npx prisma migrate deploy`
   (cwd `/app/apps/api`). Alternatively set `RUN_MIGRATIONS=1`.
3. **Freeze writes**: stop the old API (or put it in maintenance) so SQLite stops changing.
4. **Back up** the SQLite file: copy `prod.db` off the volume and record its SHA-256.
5. **Migrate the schema**: `npx prisma migrate deploy` against the new database.
6. **Dry run** the copy (reads SQLite only; reports row counts and any 32-bit `Int` overflow):
   ```bash
   npx prisma generate --schema prisma/legacy-sqlite/schema.prisma
   DATABASE_URL=<postgres> npx tsx scripts/migrate-sqlite-to-postgres.ts --source file:/path/prod.db
   ```
7. **Apply**: same command with `--apply`. It copies every table in foreign-key order inside one
   transaction, verifies per-table row counts before commit, then runs the idempotent social
   backfill (legacy comments / Loves / view counters → relational rows). It refuses a non-empty
   target, so it can never merge or duplicate.
8. **Verify**: row counts in the report; spot-check a published post's comments, Loves and views.
9. **Deploy** the new API image. Startup verifies migrations before serving.
10. **Unfreeze**.

Steps 4–8 were rehearsed locally against a copy of the development SQLite database:
6,797 rows across 53 tables copied with no mismatches, 14 assets' legacy counters backfilled,
re-runs refused/idempotent, and the source file's SHA-256 unchanged.

## Rollback and recovery

- **Before step 9**: nothing changed for users; drop the Postgres database and retry.
- **Copy failed** (step 7): the transaction rolls back; the target stays empty. Fix and re-run.
- **After step 9, roll back the app**: redeploy the previous image with the volume `DATABASE_URL`.
  Writes made on PostgreSQL after the cutover are not in SQLite — export them first if needed.
- **A later migration fails mid-deploy**: the startup guard keeps the API from serving a partial
  schema. Fix forward with a new migration, or `npx prisma migrate resolve --rolled-back <name>`
  after restoring from a Postgres backup. Enable Railway Postgres backups before cutover.
- **Older code against a newer schema** is refused (`unknown` migrations); deploy forward instead.
