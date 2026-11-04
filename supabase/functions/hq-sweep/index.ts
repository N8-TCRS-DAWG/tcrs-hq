// TCRS HQ — Inbox sweep (Supabase Edge Function "hq-sweep")
// Called at 9am and 9pm by the Apps Script in nathan@ (and service@) Gmail, once per email thread.
// Claude reads the new messages and keeps the customer profile current: contact info, products,
// dates, a TL;DR, history lines (with who spoke), next steps, and stage. For a brand-new lead's
// first email it also writes the first reply, which the script sends or saves as a Gmail draft.
// Auth: Google identity token, accounts on ALLOWED_EMAILS only. No shared secret.

const ALLOWED_EMAILS = ["nathan@tcremodelingsupply.com", "service@tcremodelingsupply.com"];
const OUR_DOMAIN = "tcremodelingsupply.com";
const STAGES = ["new", "intake", "estimate", "design", "quote", "accepted", "paid", "ordered", "installed"];
const MODEL_TRIAGE = "claude-haiku-5-5";
const MODEL_READ = "claude-sonnet-5-5";

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

async function claude(model: string, system: string, user: string, max = 2500) {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("ANTHROPIC_API_KEY missing");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: max, system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }], messages: [{ role: "user", content: user }] }),
  });
  const out = await r.json();
  if (!r.ok) throw new Error("Claude: " + JSON.stringify(out).slice(0, 300));
  const text = (out.content || []).map((c: any) => c.text || "").join("");
  const m = text.match(/\{[\s\S]*\}/);
  return m ? JSON.parse(m[0]) : null;
}

const TRIAGE = `You sort email for Twin Cities Remodeling Supply (TCRS: cabinets, countertops, flooring, appliances, furniture, remodeling projects; Minnesota).
Answer ONLY JSON {"relevant":true|false,"why":"few words"}.
relevant = a customer or possible customer about a project/product/quote/order/delivery/install, OR a supplier/contractor/designer email about a specific customer job.
Not relevant: newsletters, marketing, receipts for TCRS's own purchases, software notices, spam, internal chit-chat with no customer.`;

const READER = `You keep TCRS's project files current from email. TCRS = Twin Cities Remodeling Supply (cabinets via J&K / Twin Rivers, countertops, flooring, appliances incl. scratch-and-dent Appliances4Less, furniture; delivery + install). "Us" = anyone @${OUR_DOMAIN} (Nathan, Trevor, Lee, service@).
You get: the customer list, the matched customer's file (if any), and an email thread. Messages marked NEW are unread by HQ; others are context only.
Return ONLY JSON:
{"relevant":true,
 "kind":"new_lead|customer|partner_about_customer|other",
 "customerId":"id from the list or null",
 "confidence":"high|medium|low",
 "customer":{"name":null,"phone":null,"email":null,"address":null,"city":null,"zip":null,"source":null,"ctype":"Homeowner|Contractor|Flipper|Landlord|Designer|null","budget":null,"timeline":null,"products":[],"services":[],"finishes":null,"measure_date":null,"delivery_date":null,"install_date":null},
 "tldr":"2-3 plain sentences: who, what project, where it stands now",
 "log":[{"mid":"message id of a NEW message","who":"us|customer|supplier|contractor","summary":"one line starting with who spoke, e.g. 'Bri asked for a pantry…' / 'Nathan sent QT030290 ($7,931)'"}],
 "actions_add":[{"title":"short imperative step","due":"YYYY-MM-DD|null","whose":"us|customer|supplier|contractor"}],
 "actions_done":["ids of the file's open steps that these emails show are finished"],
 "stage":null,
 "first_contact":false,
 "reply":null,
 "warnings":[]}
Rules:
- Never invent facts. Fields not stated stay null / []. Products from: Cabinets, Countertops, Flooring, Appliances, Doors & trim, Garage doors, Sauna / plunge, Furniture, Other. Services from: Delivery, Installation, Design / layout, Removal.
- Match: pick customerId only when the email, phone, name or project address clearly matches. A supplier/designer email about a customer's job → kind partner_about_customer and that customer's id. Unknown person asking about a project → new_lead with customerId null.
- log: one line per NEW message (skip auto-notifications). "who" is the sender's side.
- actions_add: only real next steps that are not already in the file's open steps. whose = who must act next. If a customer asked us something, that's an "us" step. If we asked them, it's a "customer" step. Due dates only when stated or obvious (e.g. "by Friday").
- stage: one of ${STAGES.join(", ")} only when the emails clearly show a move (estimate/quote sent, quote accepted, payment made, order placed, delivery/install scheduled). Otherwise null.
- first_contact = true only when this thread is a NEW person's first inquiry to TCRS and nobody from TCRS has replied in it yet.
- reply: only when first_contact is true. {"body":"plain-text email"}. Warm, short (under 120 words), from Nathan. Thank them for reaching out, one line acknowledging their project, then ask ONLY for what's still missing from: full name, best phone number, project address, products needed, services needed (delivery, install, design), and layout / photos / dimensions / inspiration pictures. No prices, no promises, no dates. Sign off:
Nathan
Twin Cities Remodeling Supply{PHONE}`;

function strip(body: string) {
  // drop quoted history ("On … wrote:" and > lines) and long signatures to save tokens
  const cut = body.search(/\n(On .{5,120} wrote:|-{2,}\s*Original Message|From: .+\nSent: )/i);
  const b = (cut > 40 ? body.slice(0, cut) : body).split("\n").filter((l) => !/^\s*>/.test(l)).join("\n");
  return b.replace(/\n{3,}/g, "\n\n").trim().slice(0, 5000);
}
const emailsIn = (s: string) => (String(s || "").toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g) || []);
const digits = (s: string) => String(s || "").replace(/\D/g, "").slice(-10);

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  const idt = req.headers.get("X-Google-Id-Token") || "";
  const g = idt ? await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idt)}`) : null;
  const info = g?.ok ? await g.json() : null;
  const me = String(info?.email || "").toLowerCase();
  if (!info || String(info.email_verified) !== "true" || !ALLOWED_EMAILS.includes(me)) return json({ error: "Not allowed" }, 403);
  const box = me.startsWith("service@") ? "service" : "nathan";

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Bad body" }, 400); }

  // End-of-run summary from the script
  if (body.summary) {
    const row = (await db("settings?id=eq.sweep"))[0] || { data: { runs: [] } };
    const runs = [{ at: new Date().toISOString(), box, ...body.summary }, ...(row.data.runs || [])].slice(0, 30);
    await db("settings?id=eq.sweep", { method: "PATCH", body: JSON.stringify({ data: { ...row.data, runs }, updated_at: new Date().toISOString() }) });
    return json({ ok: true });
  }

  const th = body.thread;
  if (!th?.messages?.length) return json({ error: "No thread" }, 400);
  try {
    const mids = th.messages.map((m: any) => String(m.mid || m.gid)).filter(Boolean);
    const seen = new Set((await db(`logs?select=ext_id&ext_id=in.(${mids.map((x: string) => `"${x.replace(/"/g, "")}"`).join(",")})`)).map((l: any) => l.ext_id));
    const fresh = th.messages.filter((m: any) => !seen.has(String(m.mid || m.gid)));
    if (!fresh.length) return json({ action: "seen" });

    const [customers, partners, setRows] = await Promise.all([
      db("customers?select=id,name,email,phone,address,city,stage,products,services,lost,tldr,first_contact,measure_date,delivery_date,install_date,source,ctype,budget,timeline,finishes,zip,data"),
      db("partners?select=name,ptype,email"),
      db("settings?select=id,data&id=eq.main"),
    ]);
    const st = setRows[0]?.data || {};

    // Pre-match on email / phone so Claude sees the right file.
    const people = new Set(th.messages.flatMap((m: any) => [...emailsIn(m.from), ...emailsIn(m.to), ...emailsIn(m.cc)]).filter((e: string) => !e.endsWith("@" + OUR_DOMAIN)));
    const text = th.messages.map((m: any) => m.body || "").join("\n");
    let pre = customers.filter((c: any) => c.email && people.has(c.email.toLowerCase()));
    if (!pre.length) pre = customers.filter((c: any) => digits(c.phone).length === 10 && digits(text).length && text.replace(/\D/g, "").includes(digits(c.phone)));
    const preC = pre.length === 1 ? pre[0] : null;
    const partnerMail = partners.some((p: any) => p.email && people.has(p.email.toLowerCase()));

    const thread = th.messages.map((m: any) => `--- ${seen.has(String(m.mid || m.gid)) ? "context" : "NEW"} | id: ${m.mid || m.gid} | ${m.date}\nFrom: ${m.from}\nTo: ${m.to}${m.cc ? "\nCc: " + m.cc : ""}${(m.attachments || []).length ? "\nAttachments: " + m.attachments.join(", ") : ""}\n\n${strip(String(m.body || ""))}`).join("\n\n");

    // Cheap triage when nothing matched (keeps the monthly Claude bill small).
    if (!preC && !partnerMail) {
      const t = await claude(MODEL_TRIAGE, TRIAGE, `Subject: ${th.subject}\n\n${thread.slice(0, 6000)}`, 100);
      if (!t?.relevant) return json({ action: "ignored", why: t?.why || "" });
    }

    let file = "No matched customer.";
    let open: any[] = [];
    if (preC) {
      open = await db(`actions?select=id,title,due,waiting_on&customer_id=eq.${preC.id}&done=eq.false`);
      file = `Matched customer (by email/phone): ${JSON.stringify({ id: preC.id, name: preC.name, email: preC.email, phone: preC.phone, address: preC.address, stage: preC.stage, products: preC.products, tldr: preC.tldr })}\nOpen steps: ${JSON.stringify(open)}`;
    }
    const list = customers.filter((c: any) => !c.lost).map((c: any) => `${c.id} | ${c.name || ""} | ${c.email || ""} | ${c.phone || ""} | ${c.address || ""} | ${c.stage}`).join("\n");
    const sys = READER.replace("{PHONE}", st.company?.phone ? "\n" + st.company.phone : "");
    const j = await claude(MODEL_READ, sys, `Today: ${new Date().toISOString().slice(0, 10)}. Mailbox: ${box}@.\n\nCustomers (id | name | email | phone | address | stage):\n${list}\n\n${file}\n\nSubject: ${th.subject}\n\n${thread}`);
    if (!j || j.relevant === false || j.kind === "other") return json({ action: "ignored", why: "not a customer job" });

    // Which customer?
    let c = customers.find((x: any) => x.id === j.customerId) || preC;
    if (c && open.length === 0 && c !== preC) open = await db(`actions?select=id,title,due,waiting_on&customer_id=eq.${c.id}&done=eq.false`);
    const now = new Date().toISOString();
    const cu = j.customer || {};
    let created = false;
    if (!c) {
      if (j.kind !== "new_lead") return json({ action: "ignored", why: "partner email, customer not found" });
      const first = th.messages[0]?.date?.slice(0, 10) || now.slice(0, 10);
      const ins = await post("customers", {
        name: cu.name || (th.messages[0]?.from || "").replace(/<.*>/, "").trim() || "New lead (email)",
        email: cu.email || [...people][0] || null, phone: cu.phone, address: cu.address, city: cu.city, zip: cu.zip,
        source: cu.source || "Email", ctype: cu.ctype, budget: cu.budget, timeline: cu.timeline, finishes: cu.finishes,
        products: cu.products || [], services: cu.services || [], first_contact: first, stage: "new", tldr: j.tldr || null,
        data: { auto: { at: now, src: box + "@" }, needsReview: j.confidence !== "high", ...(box === "service" ? { onlyService: true } : {}) },
      });
      c = ins[0]; created = true;
    } else {
      // Fill blanks; note conflicting values instead of overwriting contact info.
      const p: any = {}; const changes: any[] = [];
      for (const k of ["name", "phone", "email", "address", "city", "zip", "source", "ctype", "budget", "timeline", "finishes"]) {
        if (cu[k] == null || cu[k] === "") continue;
        if (!c[k]) p[k] = cu[k];
        else if (String(c[k]).toLowerCase().trim() !== String(cu[k]).toLowerCase().trim() && ["phone", "email", "address"].includes(k)) changes.push({ field: k, old: c[k], new: cu[k], at: now });
      }
      for (const k of ["measure_date", "delivery_date", "install_date"]) if (cu[k] && cu[k] !== c[k]) { p[k] = cu[k]; if (c[k]) changes.push({ field: k, old: c[k], new: cu[k], at: now }); }
      for (const k of ["products", "services"]) { const u = [...new Set([...(c[k] || []), ...(cu[k] || [])])]; if (u.length !== (c[k] || []).length) p[k] = u; }
      if (j.tldr) p.tldr = j.tldr;
      p.data = { ...(c.data || {}), auto: { at: now, src: box + "@" }, ...(changes.length ? { changes: [...((c.data || {}).changes || []), ...changes].slice(-20) } : {}) };
      p.updated_at = now;
      await patch("customers", c.id, p);
    }

    // History (one per new message), with who spoke.
    const byMid = new Map((j.log || []).map((l: any) => [String(l.mid), l]));
    for (const m of fresh) {
      const id = String(m.mid || m.gid);
      const l: any = byMid.get(id);
      const mine = emailsIn(m.from).some((e: string) => e.endsWith("@" + OUR_DOMAIN));
      await post("logs", {
        customer_id: c.id, kind: "email", at: m.date || now, ext_id: id, src: box + "@",
        who: ["us", "customer", "supplier", "contractor"].includes(l?.who) ? l.who : mine ? "us" : null,
        summary: l?.summary || `${mine ? "We" : (m.from || "").replace(/<.*>/, "").trim()} emailed: ${th.subject}`.slice(0, 200),
        body: strip(String(m.body || "")).slice(0, 4000),
      }).catch(() => null); // duplicate id from the other mailbox → skip
    }
    // Steps
    const openIds = new Set(open.map((a: any) => a.id));
    for (const id of j.actions_done || []) if (openIds.has(id)) await patch("actions", id, { done: true, done_at: now });
    const have = new Set(open.map((a: any) => a.title.toLowerCase()));
    for (const a of (j.actions_add || []).slice(0, 4)) {
      if (!a?.title || have.has(a.title.toLowerCase())) continue;
      await post("actions", { customer_id: c.id, title: String(a.title).slice(0, 300), due: /^\d{4}-\d{2}-\d{2}$/.test(a.due || "") ? a.due : null, waiting_on: ["us", "customer", "supplier", "contractor"].includes(a.whose) ? a.whose : "us", done: false });
    }
    // Stage
    if (j.stage && STAGES.includes(j.stage) && j.stage !== c.stage && !created) {
      await patch("customers", c.id, { stage: j.stage });
      await post("logs", { customer_id: c.id, kind: "system", at: now, summary: `Auto (email): moved ${c.stage} → ${j.stage}` });
    }
    if (created) await post("logs", { customer_id: c.id, kind: "system", at: now, summary: `Lead created automatically from ${box}@ email "${String(th.subject || "").slice(0, 80)}"${j.confidence !== "high" ? " — please check" : ""}` });

    // First-contact reply (nathan@ only, once per customer).
    let reply = null;
    const usInThread = th.messages.some((m: any) => emailsIn(m.from).some((e: string) => e.endsWith("@" + OUR_DOMAIN)));
    if (box === "nathan" && !body.noReply && j.first_contact && j.reply?.body && !usInThread && !(c.data || {}).autoReplied) {
      const mode = st.sweep?.autoSend ? "send" : "draft";
      reply = { body: String(j.reply.body).slice(0, 3000), mode };
      await patch("customers", c.id, { data: { ...((await db(`customers?select=data&id=eq.${c.id}`))[0].data || {}), autoReplied: { at: now, mode } } });
      await post("logs", { customer_id: c.id, kind: "system", at: now, summary: mode === "send" ? "First reply sent automatically (intake questions)" : "First reply saved as a Gmail draft (intake questions) — review and send" });
    }
    return json({ action: created ? "created" : "updated", customer: c.name, cid: c.id, reply });
  } catch (e) {
    return json({ error: String(e).slice(0, 400) }, 500);
  }
});
