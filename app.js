/* ============================================================
   MoveMate — neighbors helping neighbors move
   Static frontend + Supabase (auth, Postgres, realtime).

   SETUP: create a free Supabase project, run supabase-schema.sql
   in its SQL editor, then paste your Project URL + anon key below.
   ============================================================ */
const SUPABASE_URL = "https://ekatofqglhbvacdxbisk.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVrYXRvZnFnbGhidmFjZHhiaXNrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE1NTIzMjksImV4cCI6MjEwNzEyODMyOX0.5MPK9XMuv9LiuDTnPNtI69a23y1UXwQUXVd3puYzRBo";

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ---------- helpers ---------- */
const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
const ROLES = [
  { key: "hands", label: "Extra hands" },
  { key: "truck", label: "Truck / van" },
  { key: "dolly", label: "Dolly / hand truck" },
];
const roleLabel = (k) => (ROLES.find((r) => r.key === k) || { label: k }).label;
const fmtDate = (d) => {
  try {
    return new Date(d + "T12:00:00").toLocaleDateString(undefined, {
      weekday: "short", month: "short", day: "numeric",
    });
  } catch { return d; }
};
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const genCode = () =>
  Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");

function showOnly(id) {
  document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
  $(id).classList.remove("hidden");
}
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.add("hidden"), 2800);
}
function setMsg(id, msg, ok) {
  const e = $(id);
  e.textContent = msg;
  e.className = "msg " + (ok ? "ok" : "err");
}

/* ---------- state ---------- */
let session = null, profile = null, neighborhood = null;
let channel = null, feedCache = [];

/* ---------- boot ---------- */
init();
async function init() {
  buildRoleInputs();
  wireEvents();
  // PWA: register the service worker (silent if unsupported)
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }
  const { data } = await sb.auth.getSession();
  session = data.session;
  sb.auth.onAuthStateChange((_evt, s) => { session = s; route(); });
  await route();
}

function wireEvents() {
  $("btn-signin").onclick = () => handleAuth("signin");
  $("btn-signup").onclick = () => handleAuth("signup");
  $("btn-save-name").onclick = saveDisplayName;
  $("btn-create-hood").onclick = createNeighborhood;
  $("btn-join-hood").onclick = joinNeighborhood;
  $("btn-post-move").onclick = postMove;
  $("btn-signout").onclick = async () => { await sb.auth.signOut(); };
  $("btn-save-alerts").onclick = async () => {
    const phone = $("set-phone").value.trim();
    const sms = $("set-sms").checked;
    if (sms && !phone) return setMsg("alerts-msg", "Add your mobile number to get SMS alerts.", false);
    setMsg("alerts-msg", "Saving…", true);
    const { error } = await saveContactPrefs(phone, sms);
    if (error) return setMsg("alerts-msg", error.message, false);
    setMsg("alerts-msg", "Alert settings saved ✓", true);
  };
  $("btn-back").onclick = () => {
    $("tab-detail").classList.add("hidden");
    switchTab("feed");
  };
  document.querySelectorAll(".tab").forEach((t) => {
    t.onclick = () => switchTab(t.dataset.tab);
  });
}

async function route() {
  showOnly("view-loading");
  if (!session) { setUserChip(); showOnly("view-auth"); return; }
  const { data: prof } = await sb.from("profiles").select("*").eq("id", session.user.id).maybeSingle();
  profile = prof || null;
  if (!profile) { setUserChip(); showOnly("view-onboarding-name"); return; }
  if (!profile.neighborhood_id) { setUserChip(); showOnly("view-onboarding-hood"); return; }
  const { data: nb } = await sb.from("neighborhoods").select("*").eq("id", profile.neighborhood_id).maybeSingle();
  neighborhood = nb;
  setUserChip();
  $("hood-name-label").textContent = neighborhood ? neighborhood.name : "";
  $("hood-code-label").textContent = neighborhood ? neighborhood.invite_code : "";
  showOnly("view-app");
  switchTab("feed");
  subscribeMoves();
}

function setUserChip() {
  const chip = $("userchip");
  const name = profile?.display_name || session?.user?.email;
  if (name) { chip.textContent = "👋 " + name; chip.classList.remove("hidden"); }
  else chip.classList.add("hidden");
}

/* ---------- auth ---------- */
async function handleAuth(mode) {
  const email = $("auth-email").value.trim();
  const pw = $("auth-password").value;
  if (!email || !pw) return setMsg("auth-msg", "Enter your email and password.", false);
  setMsg("auth-msg", "Working…", true);
  const { error } = mode === "signup"
    ? await sb.auth.signUp({ email, password: pw })
    : await sb.auth.signInWithPassword({ email, password: pw });
  if (error) return setMsg("auth-msg", error.message, false);
  setMsg("auth-msg", mode === "signup"
    ? "Account created! If email confirmation is on, check your inbox, then sign in."
    : "Signed in! 🎉", true);
}

/* Normalize a phone number to E.164-ish form for Twilio. */
function normPhone(p) {
  const d = String(p || "").replace(/\D/g, "");
  if (!d) return null;
  if (d.length === 10) return "+1" + d;          // assume US
  if (d.length === 11 && d[0] === "1") return "+" + d;
  return "+" + d;                                 // assume country code included
}

async function saveContactPrefs(phone, smsOptIn) {
  const normalized = normPhone(phone);
  if (phone && !normalized) return { error: { message: "That phone number doesn't look valid." } };
  return await sb.from("contact_prefs").upsert({
    user_id: session.user.id,
    phone: normalized,
    sms_opt_in: !!smsOptIn && !!normalized,
  });
}

async function loadContactPrefs() {
  const { data } = await sb.from("contact_prefs").select("*").eq("user_id", session.user.id).maybeSingle();
  return data;
}

async function saveDisplayName() {
  const name = $("ob-name").value.trim();
  if (!name) return toast("Enter a display name");
  const phone = $("ob-phone").value.trim();
  const sms = $("ob-sms").checked;
  if (sms && !phone) return toast("Add your mobile number to get SMS alerts.");
  const { error } = await sb.from("profiles").insert({ id: session.user.id, display_name: name });
  if (error) return toast(error.message);
  const res = await saveContactPrefs(phone, sms);
  if (res.error) return toast(res.error.message);
  route();
}

/* ---------- neighborhood ---------- */
async function createNeighborhood() {
  const name = $("hood-name").value.trim();
  if (!name) return setMsg("hood-msg", "Give your neighborhood a name.", false);
  setMsg("hood-msg", "Creating…", true);
  const code = genCode();
  const { data: nb, error } = await sb.from("neighborhoods")
    .insert({ name, invite_code: code }).select("*").single();
  if (error) return setMsg("hood-msg", error.message, false);
  const { error: e2 } = await sb.from("profiles").update({ neighborhood_id: nb.id }).eq("id", session.user.id);
  if (e2) return setMsg("hood-msg", e2.message, false);
  const box = $("hood-code-result");
  box.classList.remove("hidden");
  box.innerHTML = `<p>Share this code with neighbors so they can join:</p>
    <div class="bigcode">${esc(code)}</div>
    <button class="primary" id="btn-hood-continue">Continue →</button>`;
  setMsg("hood-msg", "Neighborhood created!", true);
  $("btn-hood-continue").onclick = route;
}

async function joinNeighborhood() {
  const code = $("hood-code").value.trim().toUpperCase();
  if (!code) return setMsg("hood-msg", "Enter the invite code.", false);
  setMsg("hood-msg", "Joining…", true);
  const { data: nb } = await sb.from("neighborhoods").select("*").eq("invite_code", code).maybeSingle();
  if (!nb) return setMsg("hood-msg", "No neighborhood found with that code.", false);
  const { error } = await sb.from("profiles").update({ neighborhood_id: nb.id }).eq("id", session.user.id);
  if (error) return setMsg("hood-msg", error.message, false);
  setMsg("hood-msg", `Welcome to ${nb.name}!`, true);
  route();
}

/* ---------- tabs ---------- */
function switchTab(name) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  ["feed", "post", "mine"].forEach((n) => $("tab-" + n).classList.toggle("hidden", n !== name));
  $("tab-detail").classList.add("hidden");
  if (name === "feed") loadFeed();
  if (name === "mine") loadMine();
}

/* ---------- realtime: new moves appear live ---------- */
function subscribeMoves() {
  if (channel) sb.removeChannel(channel);
  if (!neighborhood) return;
  channel = sb
    .channel("moves-feed")
    .on("postgres_changes",
      { event: "*", schema: "public", table: "moves", filter: `neighborhood_id=eq.${neighborhood.id}` },
      () => { if (!$("tab-feed").classList.contains("hidden")) loadFeed(); })
    .subscribe();
}

/* ---------- feed ---------- */
async function loadFeed() {
  if (!neighborhood) return;
  const list = $("feed-list");
  list.innerHTML = `<p class="muted">Loading moves…</p>`;
  const { data: moves, error } = await sb.from("moves")
    .select("*")
    .eq("neighborhood_id", neighborhood.id)
    .eq("status", "open")
    .order("move_date", { ascending: true });
  if (error) { list.innerHTML = `<p class="muted">Couldn't load moves: ${esc(error.message)}</p>`; return; }
  feedCache = moves || [];
  const ids = feedCache.map((m) => m.id);
  let signups = [];
  if (ids.length) {
    const { data } = await sb.from("signups").select("move_id, role").in("move_id", ids);
    signups = data || [];
  }
  const { data: mine } = await sb.from("signups").select("move_id, role").eq("user_id", session.user.id);
  const mySet = new Set((mine || []).map((s) => s.move_id + ":" + s.role));

  if (!feedCache.length) {
    list.innerHTML = `<div class="card"><p>📭 No open moves right now.</p><p class="muted">Moving soon? Post it and alert the neighborhood! 📣</p></div>`;
    return;
  }
  list.innerHTML = feedCache.map((m) => {
    const rows = (m.needed || []).map((n) => {
      const filled = signups.filter((s) => s.move_id === m.id && s.role === n.role).length;
      const isMine = mySet.has(m.id + ":" + n.role);
      return `<div class="need"><span>${esc(roleLabel(n.role))}</span><span class="pill">${filled}/${n.count}${isMine ? " · you ✓" : ""}</span></div>`;
    }).join("");
    return `<div class="card">
      <div class="mhead">
        <span class="badge ${m.move_type}">${m.move_type === "in" ? "📥 Moving in" : "📤 Moving out"}</span>
        <span class="mdate">${esc(fmtDate(m.move_date))} · ${esc(m.time_window)}</span>
      </div>
      <h3>${esc(m.title)}</h3>
      <p class="muted">📍 ${esc(m.area_label)}</p>
      ${rows}
      <button class="primary view-btn" data-id="${m.id}">View &amp; volunteer</button>
    </div>`;
  }).join("");
  list.querySelectorAll(".view-btn").forEach((b) => (b.onclick = () => openMove(b.dataset.id)));
}

/* ---------- move detail ---------- */
async function openMove(id) {
  document.querySelectorAll(".tabpanel").forEach((t) => t.classList.add("hidden"));
  $("tab-detail").classList.remove("hidden");
  document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
  const body = $("detail-body");
  body.innerHTML = `<p class="muted">Loading…</p>`;

  let m = feedCache.find((x) => x.id === id);
  if (!m) m = (await sb.from("moves").select("*").eq("id", id).maybeSingle()).data;
  if (!m) { body.innerHTML = `<p>Move not found.</p>`; return; }

  // Exact address: RLS only returns it to the creator + confirmed helpers
  let exact = null;
  const { data: addr } = await sb.from("move_addresses").select("address_exact").eq("move_id", id).maybeSingle();
  if (addr) exact = addr.address_exact;

  const { data: sgs } = await sb.from("signups")
    .select("role, user_id, profiles(display_name)").eq("move_id", id);
  const helpers = sgs || [];
  const isCreator = m.created_by === session.user.id;
  const myRoles = new Set(helpers.filter((s) => s.user_id === session.user.id).map((s) => s.role));

  const needRows = (m.needed || []).map((n) => {
    const vols = helpers.filter((s) => s.role === n.role);
    const mine = myRoles.has(n.role);
    const full = vols.length >= n.count;
    const chips = vols.map((h) => `<span class="chip">${esc(h.profiles?.display_name || "Neighbor")}</span>`).join("");
    let btn = "";
    if (m.status === "open") {
      btn = mine
        ? `<button class="danger sm" data-act="withdraw" data-role="${n.role}">Withdraw</button>`
        : (full ? "" : `<button class="primary sm" data-act="volunteer" data-role="${n.role}">Volunteer</button>`);
    }
    return `<div class="needrow">
      <div><b>${esc(roleLabel(n.role))}</b> <span class="pill">${vols.length}/${n.count}</span>
        <div class="helpers">${chips || '<span class="muted small">No volunteers yet</span>'}</div></div>
      <div>${btn}</div>
    </div>`;
  }).join("");

  body.innerHTML = `<div class="card">
    <div class="mhead">
      <span class="badge ${m.move_type}">${m.move_type === "in" ? "📥 Moving in" : "📤 Moving out"}</span>
      <span class="mdate">${esc(fmtDate(m.move_date))} · ${esc(m.time_window)}</span>
    </div>
    <h2>${esc(m.title)}</h2>
    <p>📍 ${exact ? `<b>${esc(exact)}</b> <span class="pill">exact address</span>` : esc(m.area_label)}</p>
    ${!exact ? `<p class="muted small">🔒 The exact address is shared with confirmed helpers only — volunteer to see it.</p>` : ""}
    ${m.description ? `<p>${esc(m.description)}</p>` : ""}
    <h3>Help needed</h3>
    ${needRows}
    ${isCreator && m.status === "open" ? `<div class="row">
      <button class="primary sm" id="btn-complete">Mark completed ✓</button>
      <button class="danger sm" id="btn-cancel-move">Cancel move</button></div>` : ""}
    ${m.status !== "open" ? `<p><span class="pill">Status: ${esc(m.status)}</span></p>` : ""}
  </div>`;

  body.querySelectorAll("[data-act]").forEach((b) => {
    b.onclick = () => (b.dataset.act === "volunteer" ? volunteer(id, b.dataset.role) : withdraw(id, b.dataset.role));
  });
  const bc = $("btn-complete");
  if (bc) bc.onclick = () => setStatus(id, "completed");
  const bx = $("btn-cancel-move");
  if (bx) bx.onclick = () => { if (confirm("Cancel this move? Helpers will see it as cancelled.")) setStatus(id, "cancelled"); };
}

async function volunteer(moveId, role) {
  const { error } = await sb.from("signups").insert({ move_id: moveId, user_id: session.user.id, role });
  if (error) {
    if (error.code === "23505") toast("You're already signed up for this.");
    else toast(error.message);
    return;
  }
  toast("You're in! The organizer can see you on the list. 🙌");
  openMove(moveId);
  loadFeed();
}

async function withdraw(moveId, role) {
  const { error } = await sb.from("signups").delete()
    .eq("move_id", moveId).eq("user_id", session.user.id).eq("role", role);
  if (error) return toast(error.message);
  toast("Withdrawn.");
  openMove(moveId);
  loadFeed();
}

async function setStatus(moveId, status) {
  const { error } = await sb.from("moves").update({ status }).eq("id", moveId);
  if (error) return toast(error.message);
  toast(status === "completed" ? "Marked completed! 🎉" : "Move cancelled.");
  switchTab("feed");
}

/* ---------- post a move ---------- */
function buildRoleInputs() {
  $("mv-roles").innerHTML = ROLES.map((r) => `
    <label class="roleline"><input type="checkbox" data-role="${r.key}"> ${r.label}
      <input type="number" min="1" max="50" value="2" data-count="${r.key}" class="count" aria-label="how many">
    </label>`).join("");
}

async function postMove() {
  const title = $("mv-title").value.trim();
  const type = $("mv-type").value;
  const date = $("mv-date").value;
  const time = $("mv-time").value.trim();
  const address = $("mv-address").value.trim();
  const area = $("mv-area").value.trim();
  const desc = $("mv-desc").value.trim();
  const needed = [...document.querySelectorAll('#mv-roles input[type="checkbox"]:checked')].map((cb) => {
    const k = cb.dataset.role;
    const c = parseInt(document.querySelector(`#mv-roles input[data-count="${k}"]`).value, 10) || 1;
    return { role: k, count: Math.max(1, c) };
  });
  if (!title || !date || !time || !address || !area)
    return setMsg("post-msg", "Fill in title, date, time window, exact address and area label.", false);
  if (!needed.length)
    return setMsg("post-msg", "Pick at least one kind of help needed.", false);

  setMsg("post-msg", "Posting…", true);
  const { data: mv, error } = await sb.from("moves").insert({
    created_by: session.user.id,
    neighborhood_id: neighborhood.id,
    title, move_type: type, move_date: date, time_window: time,
    area_label: area, description: desc || null, needed, status: "open",
  }).select("id").single();
  if (error) return setMsg("post-msg", error.message, false);

  const { error: e2 } = await sb.from("move_addresses").insert({ move_id: mv.id, address_exact: address });
  if (e2) return setMsg("post-msg", "Move posted, but saving the address failed: " + e2.message, false);

  ["mv-title", "mv-time", "mv-address", "mv-area", "mv-desc"].forEach((i) => ($(i).value = ""));
  $("mv-date").value = "";
  document.querySelectorAll('#mv-roles input[type="checkbox"]').forEach((c) => (c.checked = false));
  setMsg("post-msg", "Posted! Your neighbors can see it now 📣", true);
  switchTab("feed");
}

/* ---------- my activity ---------- */
async function loadMine() {
  const list = $("mine-list");
  list.innerHTML = `<p class="muted">Loading…</p>`;
  // Alert settings
  const prefs = await loadContactPrefs();
  if (prefs) {
    // show the stored number in a readable form (strip the +1 for US numbers)
    const raw = prefs.phone || "";
    $("set-phone").value = raw.replace(/^\+1(\d{10})$/, "$1");
    $("set-sms").checked = !!prefs.sms_opt_in;
  }
  const { data: mine } = await sb.from("moves").select("*")
    .eq("created_by", session.user.id).order("move_date", { ascending: false });
  const { data: sgs } = await sb.from("signups")
    .select("role, move_id, moves(id, title, move_date, move_type, status)")
    .eq("user_id", session.user.id);

  const posted = (mine || []).map((m) => `
    <div class="card"><div class="mhead">
      <span class="badge ${m.move_type}">${m.move_type === "in" ? "📥 Moving in" : "📤 Moving out"}</span>
      <span class="pill">${esc(m.status)}</span></div>
      <h3>${esc(m.title)}</h3>
      <p class="muted">${esc(fmtDate(m.move_date))} · ${esc(m.time_window)}</p>
      <button class="primary sm view-btn" data-id="${m.id}">Open</button>
    </div>`).join("");

  const helping = (sgs || []).filter((s) => s.moves).map((s) => `
    <div class="card"><div class="mhead">
      <span class="badge ${s.moves.move_type}">${s.moves.move_type === "in" ? "📥" : "📤"}</span>
      <span class="pill">${esc(s.moves.status)}</span></div>
      <h3>${esc(s.moves.title)}</h3>
      <p class="muted">${esc(fmtDate(s.moves.move_date))} · volunteering: <b>${esc(roleLabel(s.role))}</b></p>
      <button class="primary sm view-btn" data-id="${s.moves.id}">Open</button>
    </div>`).join("");

  list.innerHTML = `<h3>Moves I posted</h3>${posted || '<p class="muted">None yet.</p>'}
    <h3>Moves I'm helping with</h3>${helping || '<p class="muted">None yet — find a move and volunteer! 🙌</p>'}`;
  list.querySelectorAll(".view-btn").forEach((b) => (b.onclick = () => openMove(b.dataset.id)));
}
