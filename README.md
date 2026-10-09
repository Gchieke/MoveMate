# 📦 MoveMate — neighbors helping neighbors move

A simple web app where neighbors post move-in / move-out requests,
everyone in the neighborhood gets alerted (live feed), and people tap
to volunteer. Static frontend (like Decode) + Supabase backend
(auth, Postgres, realtime). Free to run.

**Live demo concept:** post a move → it appears instantly for all
neighbors → volunteers sign up per role (extra hands, truck, dolly).

## Quick setup (15–20 min)

### 1. Create the database
1. Go to [supabase.com](https://supabase.com) → sign in → **New project**
   (free tier is plenty). Pick a name, password, region near you.
2. Open **SQL Editor** → **New query** → paste the entire contents of
   `supabase-schema.sql` → **Run**. You should see "Success".
3. (Optional, for easy testing) Go to **Authentication → Sign In / Providers
   → Email** and turn **off** "Confirm email" — otherwise new accounts must
   click a confirmation link before signing in.

### 2. Connect the app
1. In Supabase: **Project Settings → API** — copy the **Project URL**
   and the **anon public** key.
2. Open `app.js` and paste them at the top:
   ```js
   const SUPABASE_URL = "https://YOUR-PROJECT-REF.supabase.co";
   const SUPABASE_ANON_KEY = "PASTE-YOUR-ANON-KEY-HERE";
   ```

### 3. Deploy (same as Decode)
- **Render:** New → **Static Site** → point at this folder
  (push it to GitHub first), Build Command empty, Publish Directory
  set to the folder. Or just open `index.html` locally to test —
  everything runs in the browser.

## How it works

1. **Sign up / sign in** with email + password.
2. **Create a neighborhood** (you get a 6-letter invite code to share)
   or **join** with a code from a neighbor.
3. **Post a move**: title, in/out, date, time window, exact address,
   public area label, and what help you need (hands / truck / dolly +
   headcounts). Everyone in the neighborhood sees it **live**.
4. **Volunteer** for a role on any move. The organizer sees who's coming.
5. **Privacy**: the exact address is stored in a separate table and is
   only visible to the organizer + confirmed helpers. Everyone else
   sees just the area label.

## Files

| File | What it is |
|---|---|
| `index.html` | The whole UI (auth, onboarding, feed, post form, detail) |
| `styles.css` | Mobile-first styling |
| `app.js` | All logic — auth, feed, signups, realtime, alert prefs (paste keys at top) |
| `manifest.json` + `sw.js` + `icons/` | PWA: installable on phones, works offline-ish |
| `supabase-schema.sql` | Tables + Row Level Security policies — run once in Supabase |
| `supabase/migrations/alerts-setup.sql` | Email alert scheduler (pg_cron, every 15 min) |
| `supabase/migrations/sms-alerts.sql` | SMS alert scheduler (pg_cron, every 30 min) |
| `supabase/functions/notify-new-moves/` | Edge Function: email alerts for new moves (Resend) |
| `supabase/functions/notify-sms-urgent/` | Edge Function: SMS alerts for moves happening today/tomorrow (Twilio) |
| `README.md` | This file |

## Install as a phone app (PWA) 📲

MoveMate is installable — no app store needed:
- **Included**: `manifest.json`, `sw.js` (caches the app shell so it opens
  fast and survives spotty connections), and app icons.
- **Try it**: deploy the site, open it on your phone → browser menu →
  **"Add to Home Screen"** (iOS: Share → Add to Home Screen). It launches
  fullscreen with its own icon.
- **Note**: the service worker only registers on `https://` or `localhost`
  (opening the file directly won't install it — deploy first).
- After changing static assets, bump the `CACHE` name in `sw.js` so
  phones pick up the new version.

## SMS alerts 📱 (new!)

For urgent same-day moves, opted-in neighbors get a text. Included:

- **App side**: phone number + "Text me about urgent same-day moves"
  checkbox on signup, editable anytime under **My activity → Alert settings**.
  Numbers are stored E.164-normalized in a private `contact_prefs` table
  (only the owner can read their own row; the function uses the
  service-role key).
- **Edge Function** `supabase/functions/notify-sms-urgent/`: every 30 min,
  finds open moves happening today/tomorrow with no SMS blast yet, texts
  opted-in members via Twilio, marks them so each move blasts exactly once.

### Setup
1. **Twilio**: sign up at [twilio.com](https://twilio.com), buy a phone
   number (paid, ~$1/month + per-message). Trial accounts can only text
   numbers you verify in the Twilio console — fine for testing.
2. **Deploy**:
   ```bash
   supabase functions deploy notify-sms-urgent
   supabase secrets set TWILIO_ACCOUNT_SID=ACxxx TWILIO_AUTH_TOKEN=xxx \
     TWILIO_FROM_NUMBER=+15550102030 APP_URL="https://your-app.onrender.com"
   ```
3. **Schedule**: in the SQL editor, replace `<PROJECT-REF>` and `<ANON-KEY>`
   in `supabase/migrations/sms-alerts.sql`, then run it.
4. **Test**: opt in with your number under My activity → Alert settings,
   post a move dated today/tomorrow → text arrives within ~30 minutes.

## Email alerts 📣 (new!)

The in-app feed updates live, but email alerts reach neighbors who
aren't looking at the app. Included:

| File | What it is |
|---|---|
| `supabase/functions/notify-new-moves/index.ts` | Edge Function: finds open moves posted in the last 24h that haven't been announced, emails every neighborhood member (except the organizer) via Resend, marks them notified so nobody gets double-emailed |
| `supabase/migrations/alerts-setup.sql` | Adds `moves.notified_at` + schedules the function every 15 min with pg_cron |

### Setup
1. **Resend** (free: 100 emails/day): sign up at [resend.com](https://resend.com),
   create an API key. Note: until you verify your own domain, Resend only
   delivers to your own account email — fine for testing.
2. **Deploy the function** (needs the [Supabase CLI](https://supabase.com/docs/guides/cli)
   linked to your project):
   ```bash
   supabase functions deploy notify-new-moves
   supabase secrets set RESEND_API_KEY=re_xxx \
     ALERT_FROM_EMAIL="MoveMate <alerts@yourdomain.com>" \
     APP_URL="https://your-app.onrender.com"
   ```
3. **Schedule it**: in the SQL editor, replace `<PROJECT-REF>` and
   `<ANON-KEY>` in `supabase/migrations/alerts-setup.sql`, then run it.
4. **Test**: post a move in the app → within ~15 minutes members get the
   email. Check runs with:
   ```sql
   select * from cron.job_run_details order by start_time desc limit 10;
   ```

## Ideas for v2 (what's left)

- **Ratings/thank-yous**: let organizers thank helpers, build reputation.
- **Calendar export**: "Add to calendar" button per move.
