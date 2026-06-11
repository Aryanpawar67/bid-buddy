-- Store admin-set plaintext password so it can be shown in the Team Members panel.
-- Cleared when the user changes their own password.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS temp_password text;
