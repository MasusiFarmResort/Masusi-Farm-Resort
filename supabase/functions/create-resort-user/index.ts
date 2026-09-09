
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") || "";
    const admin = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });

    const token = authHeader.replace("Bearer ", "");
    const { data: callerData, error: callerErr } = await admin.auth.getUser(token);
    if (callerErr || !callerData.user) throw new Error("Unauthorized");

    const { data: profile } = await admin.from("profiles").select("role_id,role,is_active").eq("id", callerData.user.id).single();
    if (!profile?.is_active) throw new Error("Inactive account");
    let allowed = profile.role === "admin";
    if (!allowed && profile.role_id) {
      const { data: perm } = await admin.from("role_permissions").select("can_add").eq("role_id", profile.role_id).eq("page_key", "users").maybeSingle();
      allowed = !!perm?.can_add;
    }
    if (!allowed) throw new Error("You do not have Add User permission");

    const { full_name, email, password, role_id } = await req.json();
    if (!full_name || !email || !password || !role_id) throw new Error("Missing required fields");
    if (String(password).length < 8) throw new Error("Password must be at least 8 characters");

    const { data: role, error: roleErr } = await admin.from("roles").select("id,code").eq("id", role_id).single();
    if (roleErr || !role) throw new Error("Invalid role");

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name, role_id, legacy_role: role.code },
    });
    if (createErr) throw createErr;

    await admin.from("profiles").update({ full_name, email, role_id, role: role.code, is_active: true }).eq("id", created.user.id);

    return new Response(JSON.stringify({ ok: true, user_id: created.user.id }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message || String(e) }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
