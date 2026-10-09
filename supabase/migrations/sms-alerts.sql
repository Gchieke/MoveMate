-- ============================================================
-- MoveMate — SMS alert scheduler (run AFTER supabase-schema.sql)
-- Run this in the Supabase SQL editor (Dashboard → SQL Editor).
--
-- Schedules the "notify-sms-urgent" Edge Function every 30 minutes.
-- It texts opted-in members about open moves happening TODAY or
-- TOMORROW (each move gets exactly one SMS blast).
--
-- BEFORE running: replace <PROJECT-REF> and <ANON-KEY> (same values
-- as in alerts-setup.sql).
--
-- Deploy the function + secrets first (see README "SMS alerts"):
--   supabase functions deploy notify-sms-urgent
--   supabase secrets set TWILIO_ACCOUNT_SID=... TWILIO_AUTH_TOKEN=... \
--     TWILIO_FROM_NUMBER=+15550102030 APP_URL=https://your-app.onrender.com
-- ============================================================

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

select cron.unschedule('notify-sms-urgent') where exists (
  select 1 from cron.job where jobname = 'notify-sms-urgent'
);

select cron.schedule(
  'notify-sms-urgent',
  '*/30 * * * *',   -- every 30 minutes
  $$
  select net.http_post(
    url := 'https://<PROJECT-REF>.supabase.co/functions/v1/notify-sms-urgent',
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
-- To pause SMS alerts:  select cron.unschedule('notify-sms-urgent');
