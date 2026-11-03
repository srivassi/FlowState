# Backend database migrations

## Gauntlet module exam configuration (20261103)

Apply `20261103_gauntlet_exam_config.sql` to the Supabase/Postgres database before deploying the backend or the games-picker UI that reads or writes `courses.gauntlet_exam_config`. The migration is idempotent and adds a nullable `jsonb` column; existing modules therefore retain default Gauntlet behavior.

Rollback, if needed:

```sql
ALTER TABLE public.courses DROP COLUMN IF EXISTS gauntlet_exam_config;
```

Dropping the column permanently removes saved module exam preferences. Back up the column before rollback if those preferences need to be retained.
