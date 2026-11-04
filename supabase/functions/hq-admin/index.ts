// TCRS HQ — team admin (Supabase Edge Function "hq-admin")
// Invite a teammate by email and give them a role. Only HQ admins can call it.
// The invitee gets Supabase's invite email and sets their own password in HQ.

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

function serverKey(): string {
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
    const first = Object.values(keys)[0];
    if (typeof first === "string" && first) return first;
  } catch { /* ignore */ }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  const url = Deno.env.get("SUPABASE_URL")!;
  const auth = req.headers.get("Authorization") ?? "";
  const anon = req.headers.get("apikey") || "";

  // caller must be an HQ admin
  const r = await fetch(`${url}/rest/v1/rpc/my_role`, { method: "POST", headers: { Authorization: auth, apikey: anon, "Content-Type": "application/json" }, body: "{}" });
  const role = r.ok ? await r.json() : null;
  if (role !== "admin") return json({ error: "Only an HQ admin can invite people" }, 403);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  const email = String(body.email || "").trim().toLowerCase();
  const name = String(body.name || "").trim();
  const newRole = ["admin", "sales", "tv"].includes(body.role) ? body.role : "sales";
  const redirect = String(body.redirect || "");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "That email doesn't look right" }, 400);

  const key = serverKey();
  const inv = await fetch(`${url}/auth/v1/invite${redirect ? `?redirect_to=${encodeURIComponent(redirect)}` : ""}`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email, data: { name } }),
  });
  const out = await inv.json().catch(() => ({}));
  if (!inv.ok) return json({ error: out?.msg || out?.error_description || out?.message || `Invite failed (${inv.status})` }, 400);
  const id = out?.id || out?.user?.id;
  if (id) {
    await fetch(`${url}/rest/v1/profiles?id=eq.${id}`, {
      method: "PATCH",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ role: newRole, ...(name ? { name } : {}) }),
    });
  }
  return json({ ok: true, id, email, role: newRole });
});
