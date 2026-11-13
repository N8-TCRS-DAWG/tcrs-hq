// TCRS HQ — Follow-up chaser (Supabase Edge Function "hq-chase")
// Called weekdays ~8:30am by the Apps Script in nathan@ Gmail (function chase()).
//  1. {chaseList:true}  → open leads that may need a nudge (not lost, has email, under the nudge limit).
//  2. The script checks Gmail: WE sent the last message, at least `days` ago, and no draft is waiting.
//  3. {chase:{cid,thread}} → Claude writes one short nudge; the script saves it as a Gmail DRAFT.
// Nothing is ever sent from here. Settings: settings row "sweep" → data.chase {off, days (3), max (2)}.
// A customer's data.noChase = true stops nudges for them.
// Auth: Google identity token, nathan@ only. No shared secret.

const ALLOWED_EMAILS = ["nathan@tcremodelingsupply.com"];
const MODEL = "claude-sonnet-5-5";
const CHASE_STAGES = ["new", "intake", "estimate", "design", "quote"];

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
function serverKey(): string {
  try { const k = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}"); const f = Object.values(k)[0]; if (typeof f === "string" && f) return f; } catch { /* */ }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
}
const URL_ = Deno.env.get("SUPABASE_URL")!;
async function db(path: string, init: RequestInit = {}) {
  const key = serverKey();
  const r = await fetch(`${URL_}/rest/v1/${path}`, { ...init, headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation", ...(init.headers || {}) } });
  const t = await r.text();
  if (!r.ok) throw new Error(`${path}: ${r.status} ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : null;
}
const post = (t: string, b: unknown) => db(t, { method: "POST", body: JSON.stringify(b) });
const patch = (t: string, id: string, b: unknown) => db(`${t}?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(b) });

async function claude(system: string, user: string, max = 700) {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("ANTHROPIC_API_KEY missing");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: max, system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }], messages: [{ role: "user", content: user }] }),
  });
  const out = await r.json();
  if (!r.ok) throw new Error("Claude: " + JSON.stringify(out).slice(0, 300));
  const text = (out.content || []).map((c: any) => c.text || "").join("");
  const m = text.match(/\{[\s\S]*\}/);
  return m ? JSON.parse(m[0]) : null;
}
function strip(body: string) {
  const cut = body.search(/\n(On .{5,120} wrote:|-{2,}\s*Original Message|From: .+\nSent: )/i);
  const b = (cut > 40 ? body.slice(0, cut) : body).split("\n").filter((l) => !/^\s*>/.test(l)).join("\n");
  return b.replace(/\n{3,}/g, "\n\n").trim().slice(0, 2500);
}

const CHASER = `You write ONE short follow-up email for Twin Cities Remodeling Supply (TCRS: cabinets, countertops, flooring, appliances; Minnesota) to a customer who has gone quiet after our last message.
Return ONLY JSON {"skip":false,"why":"","body":"plain-text email: greeting + message, no signature"}.
skip = true (give why) when: the customer said no, went elsewhere, or asked us to wait until a date that hasn't come yet; the latest message is from the customer (we owe THEM a reply); the thread is between TCRS and a supplier, not this customer; or a nudge would be awkward (complaint, bad news, legal).
Body rules: start "Hi <first name>,". 35-70 words. Warm, low-pressure, plain words, from Nathan. Name the specific project or quote in a few words. Ask ONE easy question they can answer in one line (still interested / want changes / good time for a quick call). Offer to keep their file on hold if timing is off. No discounts, no prices, no deadlines, no guilt, no "just checking in" opener, at most one exclamation mark.
If nudge_number is 2 or more: say it's the last check-in for now and that they can reply any time to pick it back up.`;

async function settings() {
  const row = (await db("settings?select=data&id=eq.sweep"))[0];
  const c = row?.data?.chase || {};
  return { off: !!c.off, days: Math.max(2, Number(c.days) || 3), max: Math.min(4, Math.max(1, Number(c.max) || 2)) };
}
async function chaseList() {
  const cfg = await settings();
  if (cfg.off) return { list: [], ...cfg };
  const rows = await db(`customers?select=id,name,email,stage,data&lost=is.null&email=not.is.null&stage=in.(${CHASE_STAGES.join(",")})`);
  const now = Date.now();
  const list = rows.filter((c: any) => {
    const d = c.data || {}; const ch = d.chase || {};
    if (!c.email || d.noChase || d.onlyService) return false;
    if ((ch.n || 0) >= cfg.max) return false;
    if (ch.last && now - Date.parse(ch.last) < cfg.days * 864e5) return false;
    if (ch.skipUntil && now < Date.parse(ch.skipUntil)) return false;
    return true;
  }).map((c: any) => ({ cid: c.id, name: c.name, email: String(c.email).toLowerCase().trim(), n: c.data?.chase?.n || 0 }));
  return { list, ...cfg };
}
async function chaseOne(cid: string, th: any) {
  const cfg = await settings();
  if (cfg.off) return { skip: true, why: "chaser is off" };
  const c = (await db(`customers?select=id,name,email,stage,tldr,data,lost&id=eq.${encodeURIComponent(cid)}`))[0];
  if (!c || c.lost) return { skip: true, why: "customer not found or lost" };
  const n = ((c.data || {}).chase?.n || 0) + 1;
  const co = ((await db("settings?select=data&id=eq.main"))[0]?.data || {}).company || {};
  const thread = (th.messages || []).slice(-6).map((m: any) => `--- ${m.date}\nFrom: ${m.from}\nTo: ${m.to}\n\n${strip(String(m.body || ""))}`).join("\n\n");
  const j = await claude(CHASER, `Today: ${new Date().toISOString().slice(0, 10)}\nnudge_number: ${n}\nCustomer: ${c.name} (${c.email}), stage ${c.stage}\nHQ summary: ${c.tldr || "none"}\n\nSubject: ${th.subject}\n\n${thread}`);
  const now = new Date().toISOString();
  const data = { ...(c.data || {}) };
  if (!j || j.skip || !j.body) {
    data.chase = { ...(data.chase || {}), skipUntil: new Date(Date.now() + cfg.days * 864e5).toISOString(), why: String(j?.why || "no draft").slice(0, 200) };
    await patch("customers", c.id, { data });
    return { skip: true, why: j?.why || "no draft" };
  }
  const sig = `\n\nBest,\nNathan Abzug\n${co.phone || "(612) 807-0414"}\n${co.email || "nathan@tcremodelingsupply.com"}\n${co.web || "tcremodelingsupply.com"}`;
  const body = String(j.body).trim().slice(0, 1500) + sig;
  data.chase = { n, last: now };
  await patch("customers", c.id, { data });
  await post("logs", { customer_id: c.id, kind: "system", at: now, who: "us", summary: `🔔 Follow-up #${n} saved as a Gmail draft (they went quiet) — review and send` });
  return { body, n };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Bad body" }, 400); }
  const idt = String(body?.idToken || "");
  const g = idt ? await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idt)}`) : null;
  const info = g?.ok ? await g.json() : null;
  const me = String(info?.email || "").toLowerCase();
  if (!info || String(info.email_verified) !== "true" || !ALLOWED_EMAILS.includes(me)) return json({ error: "Not allowed" }, 403);
  try {
    if (body.chaseList) return json(await chaseList());
    if (body.chase) return json(await chaseOne(String(body.chase.cid || ""), body.chase.thread || {}));
    if (body.summary) {
      const row = (await db("settings?id=eq.sweep"))[0] || { data: {} };
      const runs = [{ at: new Date().toISOString(), box: "nathan", ...body.summary }, ...(row.data.chaseRuns || [])].slice(0, 30);
      await db("settings?id=eq.sweep", { method: "PATCH", body: JSON.stringify({ data: { ...row.data, chaseRuns: runs }, updated_at: new Date().toISOString() }) });
      return json({ ok: true });
    }
    return json({ error: "Nothing to do" }, 400);
  } catch (e) { return json({ error: String(e).slice(0, 400) }, 500); }
});
