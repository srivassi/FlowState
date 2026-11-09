# Backend database migrations

## Automatic room progress (20261109)

The database/release owner must apply `20261109_gauntlet_progress.sql` before deploying the autosave backend and frontend. It adds nullable `gauntlet_rooms.progress` JSONB; existing rooms start with no checkpoint and acquire one on their next visit. Previously unsaved conversations cannot be reconstructed.

Autosave checkpoints preserve topic conversations after completed AI turns, stars, current topic and pending transitions. Unsent drafts and in-flight AI responses are not checkpointed. They do not create completed-session records or inflate session counts. Browser-local backups are scoped by user and room and are retried on the next visit or when connectivity returns. They contain study conversations; avoid shared browser profiles. Simultaneous tabs/devices use last-write-wins; this is not collaborative editing. The server checkpoint contains conversation content but no API keys or complete PDF copy.

Rollback: first revert frontend and backend autosave code. Leave the nullable column in place, or back up its data before dropping it with `ALTER TABLE public.gauntlet_rooms DROP COLUMN IF EXISTS progress;`. Dropping it deletes resumable checkpoints, not completed-session history.
