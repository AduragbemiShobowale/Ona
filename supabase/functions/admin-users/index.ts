// Ọ̀nà account management. Runs with the service role so it can create auth users;
// every request is checked against the caller's role first.
//
//   super_admin  creates businesses (with their owner), Operations leads; deactivates and resets them
//   operations   creates riders; an Operations lead also creates dispatch staff (operations, not lead)
//
// No e-mail is needed to get started: each new account gets a temporary password,
// shown once to the person who created it, and must change it at first sign-in.
// Riders without e-mail sign in with their phone number, stored as a login-only address.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
// A reserved domain (RFC 2606): mail to it is never delivered, so nobody else can receive a rider's reset link.
const RIDER_LOGIN_DOMAIN = "rider.ona.invalid";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

function tempPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("") + "#7";
}

const clean = (v: unknown) => String(v ?? "").trim();
const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");
const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

// Nigerian numbers: 0803… or +234803… both become 234803…
function normalisePhone(p: unknown) {
  let d = digits(p);
  if (d.startsWith("0")) d = "234" + d.slice(1);
  return d;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  const { data: caller } = await service.auth.getUser(token);
  if (!caller?.user) return json({ error: "Sign in again." }, 401);
  const { data: me } = await service.from("profiles").select("role,status,ops_lead").eq("id", caller.user.id).single();
  if (!me || me.status !== "active") return json({ error: "Your account is not active." }, 403);
  const isAdmin = me.role === "super_admin";
  const isOps = me.role === "operations";
  const isLead = isOps && me.ops_lead;
  if (!isAdmin && !isOps) return json({ error: "You do not have permission to manage accounts." }, 403);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request." }, 400);
  }

  const audit = (action: string, entityId: string, value: unknown, reason?: string) =>
    service.from("audit_log").insert({ entity: "account", entity_id: entityId, action, reason, new_value: value, user_id: caller.user!.id });

  async function createUser(email: string, fullName: string, meta: Record<string, unknown>) {
    const password = tempPassword();
    const { data, error } = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
      app_metadata: { ...meta, must_change_password: true },
    });
    if (error) {
      const msg = /already been registered|already exists/i.test(error.message) ? "That e-mail or phone number already has an account." : error.message;
      throw new Error(msg);
    }
    return { id: data.user!.id, password };
  }

  // Who may manage an existing account
  async function canManage(userId: string) {
    const { data: target } = await service.from("profiles").select("role,ops_lead").eq("id", userId).single();
    if (!target) return { ok: false, msg: "Account not found." };
    if (isAdmin && ["owner", "operations"].includes(target.role)) return { ok: true, target };
    if (isOps && target.role === "rider") return { ok: true, target };
    if (isLead && target.role === "operations" && !target.ops_lead) return { ok: true, target };
    return { ok: false, msg: "You cannot manage this account." };
  }

  try {
    switch (body.action) {
      case "create_business": {
        if (!isAdmin) return json({ error: "Only the super admin can add businesses." }, 403);
        const name = clean(body.name);
        const ownerEmail = clean(body.owner_email).toLowerCase();
        const ownerName = clean(body.owner_name);
        if (name.length < 2) return json({ error: "Enter the business name." }, 400);
        if (!emailOk(ownerEmail)) return json({ error: "Enter the owner's e-mail." }, 400);
        if (ownerName.length < 2) return json({ error: "Enter the owner's name." }, 400);
        const { data: biz, error: bErr } = await service.from("businesses").insert({
          name, sector: clean(body.sector) || null, phone: clean(body.phone) || null,
          pickup_address: clean(body.pickup_address) || null, pickup_landmark: clean(body.pickup_landmark) || null,
          zone: clean(body.zone) || null, created_by: caller.user.id,
        }).select("id").single();
        if (bErr) return json({ error: bErr.message }, 400);
        try {
          const u = await createUser(ownerEmail, ownerName, { ona_role: "owner", business_id: biz.id });
          await audit("create_business", biz.id, { name, owner: ownerEmail });
          return json({ business_id: biz.id, user_id: u.id, login: ownerEmail, temp_password: u.password });
        } catch (e) {
          await service.from("businesses").delete().eq("id", biz.id); // keep no business without an owner
          throw e;
        }
      }

      case "create_staff": {
        // super admin: Operations lead. Operations lead: dispatch staff.
        const fullName = clean(body.full_name);
        const email = clean(body.email).toLowerCase();
        if (!isAdmin && !isLead) return json({ error: "You cannot add staff." }, 403);
        if (fullName.length < 2 || !emailOk(email)) return json({ error: "Enter a name and a valid e-mail." }, 400);
        const lead = isAdmin; // the super admin creates leads; leads create dispatch staff
        const u = await createUser(email, fullName, { ona_role: "operations", ops_lead: lead });
        await audit("create_staff", u.id, { email, ops_lead: lead });
        return json({ user_id: u.id, login: email, temp_password: u.password });
      }

      case "create_rider": {
        if (!isOps) return json({ error: "Only Operations can add riders." }, 403);
        const fullName = clean(body.full_name);
        const phone = normalisePhone(body.phone);
        const email = clean(body.email).toLowerCase();
        if (fullName.length < 2) return json({ error: "Enter the rider's name." }, 400);
        if (!/^234\d{10}$/.test(phone)) return json({ error: "Enter a Nigerian phone number, like 0803 555 0142." }, 400);
        if (email && !emailOk(email)) return json({ error: "That e-mail does not look right." }, 400);
        const login = email || `${phone}@${RIDER_LOGIN_DOMAIN}`;
        const u = await createUser(login, fullName, {
          ona_role: "rider", phone, zone: clean(body.zone) || null, licence_expiry: clean(body.licence_expiry) || null,
        });
        if (body.vehicle_id) {
          const { error } = await service.from("riders").update({ vehicle_id: body.vehicle_id }).eq("profile_id", u.id);
          if (!error) await service.from("vehicles").update({ status: "assigned" }).eq("id", body.vehicle_id);
        }
        await audit("create_rider", u.id, { phone, email: email || null });
        return json({ user_id: u.id, login: email || phone, temp_password: u.password });
      }

      case "reset_password": {
        const userId = clean(body.user_id);
        const chk = await canManage(userId);
        if (!chk.ok) return json({ error: chk.msg }, 403);
        const password = tempPassword();
        const { error } = await service.auth.admin.updateUserById(userId, { password });
        if (error) return json({ error: error.message }, 400);
        await service.from("profiles").update({ must_change_password: true }).eq("id", userId);
        await audit("reset_password", userId, null);
        return json({ temp_password: password });
      }

      case "set_status": {
        const userId = clean(body.user_id);
        const status = body.status === "inactive" ? "inactive" : "active";
        const reason = clean(body.reason);
        if (reason.length < 5) return json({ error: "Give a reason." }, 400);
        const chk = await canManage(userId);
        if (!chk.ok) return json({ error: chk.msg }, 403);
        // Deactivating ends their sessions at once (banned until reactivated).
        const { error } = await service.auth.admin.updateUserById(userId, { ban_duration: status === "inactive" ? "876000h" : "none" });
        if (error) return json({ error: error.message }, 400);
        await service.from("profiles").update({ status }).eq("id", userId);
        await audit(status === "inactive" ? "deactivate" : "reactivate", userId, { status }, reason);
        return json({ ok: true });
      }

      default:
        return json({ error: "Unknown action." }, 400);
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Something went wrong." }, 400);
  }
});
