// TCRS HQ — QuickBooks payment ingest (Supabase Edge Function "hq-ingest")
// Called by the Apps Script in nathan@tcremodelingsupply.com's Google account.
// Auth: the caller sends a Google identity token (X-Google-Id-Token). We ask
// Google to verify it and only accept accounts on ALLOWED_EMAILS. No shared
// secret exists anywhere. Writes use the project's server key from the env.

const ALLOWED_EMAILS = ["nathan@tcremodelingsupply.com"];

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

function serverKey(): string {
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
    const first = Object.values(keys)[0];
    if (typeof first === "string" && first) return first;
  } catch { /* fall through */ }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
}

const URL_ = Deno.env.get("SUPABASE_URL")!;
async function db(path: string, init: RequestInit = {}) {
  const key = serverKey();
  const r = await fetch(`${URL_}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation", ...(init.headers || {}) },
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${path}: ${r.status} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
}

// ── parse one QuickBooks "Payment received" email ──
function field(body: string, label: string): string | null {
  const re = new RegExp(`\\|\\s*${label}\\s*\\|\\s*([^|\\n]+?)\\s*\\|`, "i");
  const m = body.match(re);
  return m ? m[1].trim() : null;
}
const money = (s: string | null) => (s ? Number(s.replace(/[^0-9.]/g, "")) || null : null);
function usDate(s: string | null) {
  const m = s?.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : null;
}
function parse(subject: string, body: string) {
  if (!/^payment received/i.test(subject)) return null;          // ignore TCRS paying others etc.
  const paidTo = field(body, "Paid to");
  if (paidTo && !/twin cities remodeling/i.test(paidTo)) return null;
  const amount = money(field(body, "Invoice amount")) ??
    money((body.match(/\$\s?([\d,]+\.\d{2})\s*Payment has been received/i) || [])[1] || null);
  if (!amount) return null;
  const subjName = (subject.match(/-\((.+)\)\s*$/) || [])[1] || null;
  const subjInv = (subject.match(/Invoice #\s*([\w-]+?)-\(/i) || [])[1] || null;
  return {
    amount,
    customer_name: field(body, "Customer name") || subjName,
    customer_email: (field(body, "Customer email") || "").toLowerCase() || null,
    invoice_no: field(body, "Invoice no\\.") || subjInv,
    paid_date: usDate(field(body, "Paid date")),
    method: field(body, "Payment method"),
    ext_id: field(body, "Authorization ID"),
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  // 1. Who is calling? Google verifies the identity token.
  // Sent in the body (idToken): Google strips outgoing X-Google-* headers from UrlFetchApp.
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Bad body" }, 400); }
  const idt = String(body?.idToken || req.headers.get("X-Hq-Id-Token") || req.headers.get("X-Google-Id-Token") || "");
  if (!idt) return json({ error: "Missing Google identity token" }, 401);
  const g = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idt)}`);
  const info = g.ok ? await g.json() : null;
  const email = String(info?.email || "").toLowerCase();
  if (!info || info.email_verified !== "true" && info.email_verified !== true || !ALLOWED_EMAILS.includes(email)) {
    return json({ error: "Not allowed" }, 403);
  }

  // 2. Messages from the script: [{id, subject, date, body}]
  const msgs = Array.isArray(body?.messages) ? body.messages.slice(0, 200) : [];

  const customers = await db("customers?select=id,name,email,lost");
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const out = { received: msgs.length, applied: 0, review: 0, skipped: 0, duplicate: 0 };
  const touched = new Set<string>();

  for (const m of msgs) {
    const p = parse(String(m.subject || ""), String(m.body || ""));
    if (!p) { out.skipped++; continue; }
    const dup = await db(`payments?select=id&or=(gmail_id.eq.${encodeURIComponent(m.id)}${p.ext_id ? `,ext_id.eq.${encodeURIComponent(p.ext_id)}` : ""})`);
    if (dup.length) { out.duplicate++; continue; }

    let match: any[] = [];
    let note = "";
    if (p.customer_email) { match = customers.filter((c: any) => (c.email || "").toLowerCase() === p.customer_email); note = "matched by email"; }
    if (match.length !== 1 && p.customer_name) { match = customers.filter((c: any) => c.name && norm(c.name) === norm(p.customer_name!)); note = "matched by name"; }
    const ok = match.length === 1;
    if (!ok) note = match.length > 1 ? "more than one customer matches" : "no customer with this email or name";

    await db("payments", { method: "POST", body: JSON.stringify({
      source: "quickbooks", gmail_id: m.id, ext_id: p.ext_id, subject: String(m.subject || "").slice(0, 300),
      customer_id: ok ? match[0].id : null, customer_name: p.customer_name, customer_email: p.customer_email,
      invoice_no: p.invoice_no, amount: p.amount, paid_date: p.paid_date, method: p.method,
      status: ok ? "applied" : "review", match_note: note,
    }) });
    if (ok) {
      out.applied++; touched.add(match[0].id);
      await db("logs", { method: "POST", body: JSON.stringify({
        customer_id: match[0].id, kind: "system", at: new Date().toISOString(),
        summary: `QuickBooks payment $${p.amount.toFixed(2)} received (invoice ${p.invoice_no || "?"}, ${p.paid_date || "date ?"}) — ${note}`,
      }) });
    } else out.review++;
  }
  for (const cid of touched) await db("rpc/hq_recalc_paid", { method: "POST", body: JSON.stringify({ cid }) });
  return json(out);
});
