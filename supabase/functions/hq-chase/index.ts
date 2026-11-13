// TCRS HQ — Follow-up chaser (Supabase Edge Function "hq-chase")
// Called weekdays ~8:30am by the Apps Script in nathan@ Gmail (function chase()).
//  1. {chaseList:true}  → open leads that may need a nudge (not lost, has email, under the nudge limit).
//  2. The script checks Gmail: WE sent the last message, at least `days` ago, and no draft is waiting.
//  3. {chase:{cid,thread}} → Claude writes one short nudge; the script saves it as a Gmail DRAFT.
// Nothing is ever sent from here. Settings: settings row "sweep" → data.chase {off, days (3), max (2)}.
// A customer's data.noChase = true stops nudges for them.
// Trade shows: {showList:true} → leads captured in HQ Booth mode with an email and no follow-up yet;
// {show:{cid}} → Claude writes a short personal thank-you, HQ appends their exact booth offer + intake link;
// the script saves it as a NEW Gmail draft. Offers are never written by Claude.
// Morning brief: {brief:true, drafts:n} → Claude writes a 60-second brief from HQ data; the script emails it to nathan@ only.
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

// ── Trade-show follow-ups ──
const INTAKE = "https://n8-tcrs-dawg.github.io/tcrs-hq/start/";
const OFFER_TEXT: Record<string, string> = {
  code: "Your show code 2026EAGAN takes 10% off your total project.",
  "100": "Your booth prize: $100 off your project.",
  "500": "Your booth prize: $500 off a project of $2,500 or more.",
  "1000": "Your booth prize: $1,000 off a project of $5,000 or more.",
  delivery: "Your booth prize: free delivery (within 50 miles).",
  hood: "Your booth prize: a free custom range hood with your project.",
};
const SHOW_WRITER = `You write the body of a short thank-you email from Nathan at Twin Cities Remodeling Supply (TCRS: cabinets, countertops, flooring, appliances; delivery + install; Minnesota) to someone he met at a home show booth.
Return ONLY JSON {"body":"Hi <first name>,\\n\\n<2-3 short sentences>"}.
Rules: 40-80 words. Warm, plain, specific: mention what they're interested in and one detail from the notes if there is one. Then ask them to take the next step: fill out a 2-minute project form or reply with photos and rough measurements, so we can put together a rough estimate. Do NOT mention any discount, prize, code, price, date or promise — the offer and link are added after your text. No signature.`;
async function showList() {
  const rows = await db(`customers?select=id,name,email,data&lost=is.null&email=not.is.null&data->booth->>show=not.is.null`);
  return { list: rows.filter((c: any) => c.email && !c.data?.booth?.followed).map((c: any) => ({ cid: c.id, name: c.name, email: String(c.email).toLowerCase().trim() })) };
}
async function showOne(cid: string) {
  const c = (await db(`customers?select=id,name,email,products,ctype,city,tldr,data&id=eq.${encodeURIComponent(cid)}`))[0];
  const b = c?.data?.booth;
  if (!c || !b || b.followed || !c.email) return { skip: true, why: "not a pending booth lead" };
  const j = await claude(SHOW_WRITER, `Name: ${c.name}\nWho: ${c.ctype || "Homeowner"}${c.city ? ", " + c.city : ""}\nInterested in: ${(c.products || []).join(", ") || "not said"}\nTimeline: ${b.when || "not said"}\nNotes: ${b.notes || "none"}`, 500);
  const first = String(c.name || "").trim().split(/\s+/)[0] || "there";
  const intro = j?.body ? String(j.body).trim().slice(0, 900) : `Hi ${first},\n\nThanks for stopping by the TCRS booth at the Eagan home show. When you're ready, the quickest next step is our 2-minute project form, or just reply with a few photos and rough measurements and we'll put together a rough estimate.`;
  const offer = OFFER_TEXT[b.offer] || "";
  const fine = b.offer && b.offer !== "code" ? " One offer per project; booth prizes can't be combined with 2026EAGAN." : "";
  const co = ((await db("settings?select=data&id=eq.main"))[0]?.data || {}).company || {};
  const body = `${intro}\n\n${offer ? offer + fine + "\n\n" : ""}Project form (2 minutes): ${INTAKE}\n\nBest,\nNathan Abzug\n${co.phone || "(612) 807-0414"}\n${co.email || "nathan@tcremodelingsupply.com"}\n${co.web || "tcremodelingsupply.com"}`;
  const now = new Date().toISOString();
  await patch("customers", c.id, { data: { ...c.data, booth: { ...b, followed: now } } });
  await post("logs", { customer_id: c.id, kind: "system", at: now, who: "us", summary: "✉️ Post-show follow-up saved as a Gmail draft — review and send" });
  return { to: c.email, subject: "Great meeting you at the Eagan Home Show", body };
}

// ── Jarvis morning brief (emailed to Nathan himself, weekdays ~7am) ──
const BRIEFER = `You are Jarvis, the morning brief for Nathan, who runs sales at Twin Cities Remodeling Supply (TCRS). Write a plain-text email body he can read in 60 seconds on his phone.
Return ONLY JSON {"subject":"short, specific, e.g. 'Brief: 3 replies owed, Thenhaus quote day 9'","body":"plain text"}.
Body sections, each only if it has content, in this order, short lines, real names and numbers from the data only:
TODAY'S 3 MOVES — the three actions with the most money or urgency behind them, one line each.
WAITING ON US — overdue or due-today steps whose move is ours (name: step, days late).
GONE QUIET — biggest open deals where the customer hasn't answered (name, value, days quiet).
DRAFTS — how many Gmail drafts are waiting (follow-ups, thank-yous) — "review and send".
MONEY — open pipeline total, collected this month, any payment waiting for review in HQ.
No greeting fluff, no sign-off, no advice beyond the data. Never invent a number.`;
async function brief(drafts: number) {
  const today = new Date().toISOString().slice(0, 10);
  const [cs, acts, logs, pays] = await Promise.all([
    db("customers?select=id,name,stage,est_price,budget,paid,lost,source&lost=is.null"),
    db("actions?select=customer_id,title,due,waiting_on&done=eq.false"),
    db(`logs?select=customer_id,at,who,kind&kind=neq.system&at=gte.${new Date(Date.now() - 60 * 864e5).toISOString()}`),
    db("payments?select=amount,status,paid_date"),
  ]);
  const last: Record<string, any> = {};
  for (const l of logs) if (!last[l.customer_id] || l.at > last[l.customer_id].at) last[l.customer_id] = l;
  const days = (iso: string) => Math.round((Date.parse(today) - Date.parse(iso.slice(0, 10))) / 864e5);
  const open = cs.filter((c: any) => ["new", "intake", "estimate", "design", "quote", "accepted"].includes(c.stage));
  const val = (c: any) => Math.max(Number(c.est_price) || Number(c.budget) || 0, Number(c.paid?.amount) || 0);
  const rows = open.map((c: any) => {
    const a = acts.filter((x: any) => x.customer_id === c.id);
    const l = last[c.id];
    return `${c.name} | ${c.stage} | value $${Math.round(val(c))} | last contact ${l ? days(l.at) + "d ago by " + (l.who || "?") : "none in 60d"} | steps: ${a.map((x: any) => `${x.title} (${x.waiting_on}${x.due ? ", due " + x.due + (x.due < today ? " LATE " + days(x.due) + "d" : "") : ""})`).join("; ") || "none"}`;
  }).join("\n");
  const month = today.slice(0, 7);
  const collected = cs.filter((c: any) => String(c.paid?.at || "").startsWith(month)).reduce((s: number, c: any) => s + (Number(c.paid?.amount) || 0), 0);
  const review = pays.filter((p: any) => p.status === "review").length;
  const pipeline = open.reduce((s: number, c: any) => s + val(c), 0);
  const j = await claude(BRIEFER, `Today: ${today}\nGmail drafts waiting: ${drafts}\nOpen pipeline: $${Math.round(pipeline)} across ${open.length} leads\nCollected this month (paid dates in HQ): $${Math.round(collected)}\nPayments waiting for review in HQ: ${review}\n\nOpen leads (name | stage | value | last contact | open steps):\n${rows}`, 1200);
  const body = (j?.body ? String(j.body) : `Open pipeline $${Math.round(pipeline)} across ${open.length} leads. Drafts waiting: ${drafts}.`) + `\n\nOpen HQ: https://n8-tcrs-dawg.github.io/tcrs-hq/  (press J for Jarvis)`;
  return { subject: String(j?.subject || `TCRS brief ${today}`).slice(0, 120), body };
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
    if (body.showList) return json(await showList());
    if (body.show) return json(await showOne(String(body.show.cid || "")));
    if (body.brief) return json(await brief(Number(body.drafts) || 0));
    if (body.summary) {
      const row = (await db("settings?id=eq.sweep"))[0] || { data: {} };
      const runs = [{ at: new Date().toISOString(), box: "nathan", ...body.summary }, ...(row.data.chaseRuns || [])].slice(0, 30);
      await db("settings?id=eq.sweep", { method: "PATCH", body: JSON.stringify({ data: { ...row.data, chaseRuns: runs }, updated_at: new Date().toISOString() }) });
      return json({ ok: true });
    }
    return json({ error: "Nothing to do" }, 400);
  } catch (e) { return json({ error: String(e).slice(0, 400) }, 500); }
});
