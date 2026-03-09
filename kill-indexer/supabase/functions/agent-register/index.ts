import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ── GET: return all registered agents ────────────────────────────────────────
  if (req.method === "GET") {
    const { data, error } = await db
      .from("agent_registry")
      .select("*")
      .order("updt", { ascending: false });

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { "Content-Type": "application/json", ...CORS },
      });
    }

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "Content-Type": "application/json", ...CORS },
    });
  }

  // ── POST: upsert agent registration ──────────────────────────────────────────
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "GET or POST required" }), {
      status: 405, headers: { "Content-Type": "application/json", ...CORS },
    });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON" }), {
      status: 400, headers: { "Content-Type": "application/json", ...CORS },
    });
  }

  const address = body["agent-address"] as string | undefined;
  if (!address) {
    return new Response(JSON.stringify({ error: "agent-address is required" }), {
      status: 400, headers: { "Content-Type": "application/json", ...CORS },
    });
  }

  const row: Record<string, unknown> = {
    address,
    updt: new Date().toISOString(),
  };
  if (body["agent-name"]         !== undefined) row.name         = body["agent-name"];
  if (body["agent-build"]        !== undefined) row.build        = body["agent-build"];
  if (body["agent-capabilities"] !== undefined) row.capabilities = body["agent-capabilities"];
  if (body["agent-ip"]           !== undefined) row.ip           = body["agent-ip"];
  if (body["agent-sol"]          !== undefined) row.sol          = body["agent-sol"];
  if (body["agent-kill"]         !== undefined) row.kill         = body["agent-kill"];

  const { data, error } = await db
    .from("agent_registry")
    .upsert(row, { onConflict: "address" })
    .select()
    .single();

  if (error) {
    console.error("upsert error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { "Content-Type": "application/json", ...CORS },
    });
  }

  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json", ...CORS },
  });
});
