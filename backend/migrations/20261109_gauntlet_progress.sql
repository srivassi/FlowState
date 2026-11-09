ALTER TABLE public.gauntlet_rooms
    ADD COLUMN IF NOT EXISTS progress jsonb;
