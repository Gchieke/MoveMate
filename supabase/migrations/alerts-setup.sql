-- ============================================================
-- MoveMate — email alert setup (run AFTER supabase-schema.sql)
-- Run this in the Supabase SQL editor (Dashboard → SQL Editor).
--
-- What it does:
--   1. Adds moves.notified_at so each move is announced exactly once.
--   2. Enables pg_cron + pg_net and schedules the
--      "notify-new-moves" Edge Function every 15 minutes.
--
-- BEFORE running: replace <PROJECT-REF> with your Supabase project
-- ref (the subdomain in https://<PROJECT-REF>.supabase.co) and
-- <ANON-KEY> with your project's anon public key
-- (Project Settings → API). The anon key is a valid JWT for calling
-- your own Edge Function; the function itself uses the service-role
-- key internally, which never leaves Supabase.
--
-- Deploy the function + secrets first (see README "Email alerts"):
--   supabase functions deploy notify-new-moves
--   supabase secrets set RESEND_API_KEY=... ALERT_FROM_EMAIL=... APP_URL=...
-- ============================================================

alter table moves add column if not exists notified_at timestamptz;

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- Drop any previous schedule with the same name (safe to re-run)
select cron.unschedule('notify-new-moves') where exists (
  select 1 from cron.job where jobname = 'notify-new-moves'
);

select cron.schedule(
  'notify-new-moves',
  '*/15 * * * *',   -- every 15 minutes
  $$
  select net.http_post(
    url := 'https://<PROJECT-REF>.supabase.co/functions/v1/notify-new-moves',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <ANON-KEY>'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Check it scheduled OK:
--   select jobname, schedule, active from cron.job;
-- Recent runs / errors:
--   select * from cron.job_run_details order by start_time desc limit 10;
-- To pause alerts:  select cron.unschedule('notify-new-moves');
