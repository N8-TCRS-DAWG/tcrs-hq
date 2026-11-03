// TCRS HQ — Claude helper (Supabase Edge Function "hq-ai")
// Reads uploads (text, photos, PDFs) and returns Claude's answer.
// Needs the secret ANTHROPIC_API_KEY (Edge Functions → Secrets).
// Only logged-in admin/sales users can call it; the TV login cannot.

const MODELS: Record<string, string> = {
  quick: "claude-haiku-5-5",
  default: "claude-sonnet-5-5",
  complex: "claude-opus-5-5",
};

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ error: "ANTHROPIC_API_KEY is not set in Supabase → Edge Functions → Secrets" }, 500);

  // Who is calling? Ask the database for this user's role.
  const auth = req.headers.get("Authorization") ?? "";
  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = req.headers.get("apikey") || Deno.env.get("SUPABASE_ANON_KEY") || "";
  const roleRes = await fetch(`${url}/rest/v1/rpc/my_role`, {
    method: "POST",
    headers: { Authorization: auth, apikey: anon, "Content-Type": "application/json" },
    body: "{}",
  });
  const role = roleRes.ok ? await roleRes.json() : null;
  if (role !== "admin" && role !== "sales") return json({ error: "Your login can't use Claude features" }, 403);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Bad request body" }, 400); }

  const allowed = new Set(["text", "image", "document"]);
  const content = (Array.isArray(body.content) ? body.content : [])
    .filter((b: any) => b && allowed.has(b.type));
  if (!content.length) return json({ error: "Nothing to read" }, 400);

  const model = MODELS[body.model] ?? MODELS.default;
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: Math.min(Number(body.max_tokens) || 6000, 16000),
      system: String(body.system ?? ""),
      messages: [{ role: "user", content }],
    }),
  });
  const out = await r.json();
  if (!r.ok) return json({ error: out?.error?.message ?? `Claude error ${r.status}` }, 502);
  const text = (out.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  return json({ text, model, usage: out.usage, stop: out.stop_reason });
});
