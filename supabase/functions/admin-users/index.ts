// Account management: Admin manages all accounts, Dispatch manages drivers.
// Runs with the service role so it can create and ban auth users; every
// request is checked against the caller's profile role first.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const STAFF_ROLES = ["ops", "finance", "warehouse", "dispatch", "driver", "admin"];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

function tempPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("") + "#7";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  const { data: caller } = await service.auth.getUser(token);
  if (!caller?.user) return json({ error: "Sign in again." }, 401);
  const { data: me } = await service.from("profiles").select("role,status").eq("id", caller.user.id).single();
  // Admin manages every account. Dispatch may only add, deactivate and reset drivers.
  const isAdmin = me?.role === "admin" && me?.status === "active";
  const isDispatch = me?.role === "dispatch" && me?.status === "active";
  if (!isAdmin && !isDispatch) return json({ error: "You do not have permission to manage accounts." }, 403);

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request." }, 400);
  }

  if (isDispatch) {
    if (body.action === "create_staff" && body.role !== "driver") return json({ error: "Dispatch can only add drivers." }, 403);
    if (body.action === "create_customer") return json({ error: "Only an administrator can create customer accounts." }, 403);
    if (body.action === "set_status" || body.action === "reset_password") {
      const { data: target } = await service.from("profiles").select("role").eq("id", String(body.user_id ?? "")).single();
      if (target?.role !== "driver") return json({ error: "Dispatch can only manage driver accounts." }, 403);
    }
  }

  const audit = (action: string, entityId: string, value: unknown) =>
    service.from("audit_log").insert({ entity: "user", entity_id: entityId, action, new_value: value, user_id: caller.user!.id });

  try {
    switch (body.action) {
      case "create_staff": {
        const email = String(body.email ?? "").trim().toLowerCase();
        const fullName = String(body.full_name ?? "").trim();
        const role = String(body.role ?? "");
        if (!email || !fullName) return json({ error: "Name and e-mail are required." }, 400);
        if (!STAFF_ROLES.includes(role)) return json({ error: "Choose a staff role." }, 400);
        const password = tempPassword();
        const { data, error } = await service.auth.admin.createUser({
          email, password, email_confirm: true, user_metadata: { full_name: fullName },
        });
        if (error) return json({ error: error.message }, 400);
        const id = data.user.id;
        await service.from("profiles").update({
          role, full_name: fullName, phone: body.phone || null, must_change_password: true,
        }).eq("id", id);
        if (role === "driver") {
          await service.from("drivers").insert({ user_id: id, phone: body.phone || null, licence_no: body.licence_no || null });
        }
        await audit("create_staff", id, { email, role });
        return json({ id, email, temp_password: password });
      }

      case "create_customer": {
        const email = String(body.email ?? "").trim().toLowerCase();
        const c = body.customer ?? {};
        for (const f of ["name", "reg_no", "contact_name", "phone", "address"]) {
          if (!String(c[f] ?? "").trim()) return json({ error: `${f.replace("_", " ")} is required.` }, 400);
        }
        if (!email) return json({ error: "E-mail is required." }, 400);
        const { data: dup } = await service.from("customers").select("id").ilike("reg_no", String(c.reg_no).trim());
        if (dup && dup.length) return json({ error: "A customer with this registration number already exists." }, 400);
        const password = tempPassword();
        const { data, error } = await service.auth.admin.createUser({
          email, password, email_confirm: true, user_metadata: { full_name: c.contact_name },
        });
        if (error) return json({ error: error.message }, 400);
        const id = data.user.id;
        await service.from("profiles").update({ full_name: c.contact_name, phone: c.phone, must_change_password: true }).eq("id", id);
        const { data: cust, error: cErr } = await service.from("customers").insert({
          name: c.name, reg_no: String(c.reg_no).trim(), contact_name: c.contact_name, email, phone: c.phone,
          address: c.address, industry: c.industry || null, status: "active",
          payment_terms: c.payment_terms || "prepaid", credit_limit: c.credit_limit || 0,
          allowed_region_ids: c.allowed_region_ids || [],
        }).select("id").single();
        if (cErr) return json({ error: cErr.message }, 400);
        await service.from("customer_users").insert({ user_id: id, customer_id: cust.id });
        await service.from("registration_applications").insert({
          customer_id: cust.id, outcome: "auto_approved", decision: "accept", decided_by: caller.user.id,
          decided_at: new Date().toISOString(), note: "Created by administrator",
          rule_results: [{ rule: "admin_created", result: "pass", message: "Account created directly by an administrator" }],
        });
        await audit("create_customer", id, { email, customer_id: cust.id });
        return json({ id, customer_id: cust.id, email, temp_password: password });
      }

      case "set_status": {
        const id = String(body.user_id ?? "");
        const status = body.status === "inactive" ? "inactive" : "active";
        if (id === caller.user.id) return json({ error: "You cannot deactivate your own account." }, 400);
        const { error } = await service.auth.admin.updateUserById(id, { ban_duration: status === "inactive" ? "876000h" : "none" });
        if (error) return json({ error: error.message }, 400);
        await service.from("profiles").update({ status }).eq("id", id);
        await service.from("drivers").update({ active: status === "active" }).eq("user_id", id);
        await audit("set_status", id, { status });
        return json({ ok: true });
      }

      case "reset_password": {
        const id = String(body.user_id ?? "");
        const password = tempPassword();
        const { error } = await service.auth.admin.updateUserById(id, { password });
        if (error) return json({ error: error.message }, 400);
        await service.from("profiles").update({ must_change_password: true }).eq("id", id);
        await audit("reset_password", id, {});
        return json({ temp_password: password });
      }

      default:
        return json({ error: "Unknown action." }, 400);
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Something went wrong." }, 500);
  }
});
