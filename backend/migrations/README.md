# Backend database migrations

## Gauntlet module exam configuration (20261103)

`20261103_gauntlet_exam_config.sql` is owned and maintained with the backend API. The release operator with authorized Supabase/Postgres migration access applies it; coordinate the backend and games-picker releases against the same database.

### Deployment order

1. Apply `20261103_gauntlet_exam_config.sql` to the target database.
2. Deploy the backend, then the games-picker UI that reads or writes `courses.gauntlet_exam_config`.

The migration is idempotent and adds a nullable `jsonb` column. Existing modules therefore retain default Gauntlet behavior. The column must exist before deploying either application version that uses it.

### Rollback order

1. Revert the backend and games-picker UI to versions that do not read or write `courses.gauntlet_exam_config`.
2. If saved preferences must be retained, export or back up the column.
3. Only after the application rollback has completed, drop the column:

```sql
ALTER TABLE public.courses DROP COLUMN IF EXISTS gauntlet_exam_config;
```

Dropping the column permanently removes saved module exam preferences. Do not drop it while an active backend or UI version still expects the column.

## Automatic room progress (20261109)

The database/release owner must apply `20261109_gauntlet_progress.sql` before deploying the autosave backend and frontend. It adds nullable `gauntlet_rooms.progress` JSONB; existing rooms start with no checkpoint and acquire one on their next visit. Previously unsaved conversations cannot be reconstructed.

Autosave checkpoints preserve topic conversations after completed AI turns, stars, current topic and pending transitions. Unsent drafts and in-flight AI responses are not checkpointed. They do not create completed-session records or inflate session counts. Browser-local backups are scoped by user and room and are retried on the next visit or when connectivity returns. They contain study conversations; avoid shared browser profiles. Simultaneous tabs/devices use last-write-wins; this is not collaborative editing. The server checkpoint contains conversation content but no API keys or complete PDF copy.

Rollback: first revert frontend and backend autosave code. Leave the nullable column in place, or back up its data before dropping it with `ALTER TABLE public.gauntlet_rooms DROP COLUMN IF EXISTS progress;`. Dropping it deletes resumable checkpoints, not completed-session history.
