ALTER TABLE public.courses
    ADD COLUMN IF NOT EXISTS gauntlet_exam_config jsonb;
