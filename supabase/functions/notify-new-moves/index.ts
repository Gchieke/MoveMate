// ============================================================
// MoveMate — notify-new-moves Edge Function
// Runs on a schedule (every 15 min via pg_cron). Finds open moves
// posted in the last 24h that haven't been announced yet, emails
// every member of the neighborhood (except the organizer), then
// marks them notified so nobody gets spammed twice.
//
// Required secrets (supabase secrets set ...):
//   RESEND_API_KEY          — from resend.com (sending-only key is fine)
//   ALERT_FROM_EMAIL        — e.g. "MoveMate <noreply@movemateapp.co>"
//   APP_URL                 — e.g. https://movemate-dfqj.onrender.com
// SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are provided by default.
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_KEY = Deno.env.get("RESEND_API_KEY");
const FROM = Deno.env.get("ALERT_FROM_EMAIL") ?? "MoveMate <noreply@movemateapp.co>";
const APP_URL = Deno.env.get("APP_URL") ?? "https://movemate-dfqj.onrender.com";

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

const esc = (s: string) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as Record<string, string>
  )[c]);

async function sendEmail(to: string[], subject: string, html: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: FROM, to, subject, html }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend ${res.status}: ${body}`);
  }
}

Deno.serve(async () => {
  try {
    if (!RESEND_KEY) {
      return new Response(JSON.stringify({ error: "RESEND_API_KEY not set" }), { status: 500 });
    }

    // 1. Un-announced open moves from the last 24h
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { data: moves, error: mErr } = await sb
      .from("moves")
      .select("id, title, move_type, move_date, time_window, area_label, description, needed, created_by, neighborhood_id, neighborhoods(name)")
      .eq("status", "open")
      .is("notified_at", null)
      .gte("created_at", since);

    if (mErr) throw mErr;
    if (!moves?.length) {
      return new Response(JSON.stringify({ ok: true, notified: 0 }), { status: 200 });
    }

    let notified = 0;
    for (const m of moves) {
      // 2. Member user IDs in this neighborhood (excluding the organizer)
      const { data: profs } = await sb
        .from("profiles").select("id").eq("neighborhood_id", m.neighborhood_id);
      const memberIds = new Set((profs ?? []).map((p) => p.id));
      memberIds.delete(m.created_by);
      if (!memberIds.size) continue;

      // 3. Resolve emails via the Auth admin API (paginated)
      const emails: string[] = [];
      let page = 1;
      for (;;) {
        const { data: pageData, error: uErr } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
        if (uErr) throw uErr;
        for (const u of pageData.users) {
          if (memberIds.has(u.id) && u.email) emails.push(u.email);
        }
        if (pageData.users.length < 1000) break;
        page++;
      }
      if (!emails.length) continue;

      // 4. Send the alert
      const hoodName = (m as any).neighborhoods?.name ?? "your neighborhood";
      const when = new Date(m.move_date + "T12:00:00").toLocaleDateString(undefined,
        { weekday: "long", month: "long", day: "numeric" });
      const needs = (m.needed ?? []).map((n: any) => `${n.count}× ${n.role}`).join(", ");
      const subject = `📦 New move in ${hoodName}: ${m.title}`;
      const html = `
        <div style="font-family:system-ui,sans-serif;max-width:560px">
          <h2>📦 ${esc(m.title)}</h2>
          <p><b>${m.move_type === "in" ? "Moving in" : "Moving out"}</b> · ${esc(when)} · ${esc(m.time_window)}</p>
          <p>📍 ${esc(m.area_label)}</p>
          ${m.description ? `<p>${esc(m.description)}</p>` : ""}
          ${needs ? `<p><b>Help needed:</b> ${esc(needs)}</p>` : ""}
          <p><a href="${APP_URL}" style="background:#4f46e5;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none">Volunteer to help →</a></p>
          <p style="color:#666;font-size:12px">You're getting this because you're a member of ${esc(hoodName)} on MoveMate.</p>
        </div>`;

      await sendEmail(emails, subject, html);

      // 5. Mark notified so we never double-send
      await sb.from("moves").update({ notified_at: new Date().toISOString() }).eq("id", m.id);
      notified++;
    }

    return new Response(JSON.stringify({ ok: true, notified }), { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), { status: 500 });
  }
});
