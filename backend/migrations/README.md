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
