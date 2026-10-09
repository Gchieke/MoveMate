// ============================================================
// MoveMate — notify-sms-urgent Edge Function
// Runs on a schedule (every 30 min via pg_cron). Finds OPEN moves
// happening TODAY or TOMORROW that haven't had an SMS blast yet,
// texts every neighborhood member who opted in with a phone number,
// then marks the move sms_notified_at so it only ever texts once.
//
// Required secrets (supabase secrets set ...):
//   TWILIO_ACCOUNT_SID
//   TWILIO_AUTH_TOKEN
//   TWILIO_FROM_NUMBER   — your Twilio number, E.164 e.g. +15550102030
//   APP_URL              — e.g. https://movemate.onrender.com
// SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are provided by default.
//
// NOTE: Twilio trial accounts can only text verified numbers —
// verify your test phones in the Twilio console first.
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TWILIO_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
const TWILIO_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
const TWILIO_FROM = Deno.env.get("TWILIO_FROM_NUMBER");
const APP_URL = Deno.env.get("APP_URL") ?? "https://movemate.onrender.com";

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

async function sendSms(to: string, body: string) {
  const creds = btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`);
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`,
    {
      method: "POST",
      headers: {
        "Authorization": `Basic ${creds}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: TWILIO_FROM!, Body: body }).toString(),
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Twilio ${res.status}: ${text}`);
  }
}

Deno.serve(async () => {
  try {
    if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_FROM) {
      return new Response(JSON.stringify({ error: "Twilio secrets not set" }), { status: 500 });
    }

    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    const todayStr = `${yyyy}-${mm}-${dd}`;
    const tmr = new Date(today.getTime() + 24 * 3600 * 1000);
    const tmrStr = `${tmr.getFullYear()}-${String(tmr.getMonth() + 1).padStart(2, "0")}-${String(tmr.getDate()).padStart(2, "0")}`;

    // 1. Open moves happening today/tomorrow with no SMS blast yet
    const { data: moves, error: mErr } = await sb
      .from("moves")
      .select("id, title, move_type, move_date, time_window, area_label, needed, neighborhood_id, neighborhoods(name)")
      .eq("status", "open")
      .is("sms_notified_at", null)
      .gte("move_date", todayStr)
      .lte("move_date", tmrStr);

    if (mErr) throw mErr;
    if (!moves?.length) {
      return new Response(JSON.stringify({ ok: true, notified: 0 }), { status: 200 });
    }

    let notified = 0, texts = 0;
    for (const m of moves) {
      // 2. Members of this neighborhood who opted into SMS with a phone number
      const { data: profs } = await sb
        .from("profiles").select("id").eq("neighborhood_id", m.neighborhood_id);
      const memberIds = (profs ?? []).map((p) => p.id);
      if (!memberIds.length) continue;

      const { data: prefs } = await sb
        .from("contact_prefs").select("phone").in("user_id", memberIds)
        .eq("sms_opt_in", true).not("phone", "is", null);
      const phones = [...new Set((prefs ?? []).map((p) => p.phone as string).filter(Boolean))];
      if (!phones.length) continue;

      // 3. Text them
      const when = m.move_date === todayStr ? "TODAY" : "tomorrow";
      const needs = (m.needed ?? []).map((n: any) => `${n.count}x ${n.role}`).join(", ");
      const hood = (m as any).neighborhoods?.name ?? "your neighborhood";
      const body =
        `📦 MoveMate [${hood}]: "${m.title}" is ${when} (${m.move_date} ${m.time_window}, ${m.area_label}). ` +
        (needs ? `Needs: ${needs}. ` : "") +
        `Can you help? ${APP_URL} — reply STOP to opt out`;

      for (const to of phones) {
        try { await sendSms(to, body); texts++; }
        catch (e) { console.error("SMS failed for", to, e); }
      }

      // 4. Mark so we never blast twice (even if one number failed)
      await sb.from("moves").update({ sms_notified_at: new Date().toISOString() }).eq("id", m.id);
      notified++;
    }

    return new Response(JSON.stringify({ ok: true, notified, texts }), { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error)?.message ?? e) }), { status: 500 });
  }
});
