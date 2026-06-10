import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function assertAdmin(authHeader: string | null) {
  const token = authHeader?.replace("Bearer ", "");
  if (!token) return new Response("Unauthorized", { status: 401 });
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return new Response("Unauthorized", { status: 401 });
  const { data: roles } = await supabaseAdmin
    .from("user_roles").select("role").eq("user_id", user.id);
  if (!roles?.some((r) => r.role === "admin"))
    return new Response("Forbidden", { status: 403 });
  return null;
}

// ── createUserFn ──────────────────────────────────────────────────────────────
export const createUserFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({
    email: z.string().email(),
    password: z.string().min(8),
    fullName: z.string().min(1),
    role: z.enum(["pre_sales", "legal", "finance", "admin"]),
  }))
  .handler(async ({ data }) => {
    const guard = await assertAdmin(getRequest().headers.get("authorization"));
    if (guard) return guard;

    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.fullName },
    });
    if (createErr) throw new Error(createErr.message);

    const userId = created.user.id;

    // handle_new_user trigger fires synchronously: profile (status=pending) +
    // user_roles (pre_sales) already inserted. Activate and assign chosen role.
    await (supabaseAdmin as any).from("profiles").update({ status: "active" }).eq("id", userId);
    await supabaseAdmin.from("user_roles").delete().eq("user_id", userId);
    const { error: roleErr } = await supabaseAdmin
      .from("user_roles").insert({ user_id: userId, role: data.role });
    if (roleErr) throw new Error(roleErr.message);

    return { ok: true, userId };
  });

// ── changePasswordFn ──────────────────────────────────────────────────────────
export const changePasswordFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({
    userId: z.string().uuid(),
    newPassword: z.string().min(8),
  }))
  .handler(async ({ data }) => {
    const guard = await assertAdmin(getRequest().headers.get("authorization"));
    if (guard) return guard;

    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      password: data.newPassword,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ── deleteUserFn ──────────────────────────────────────────────────────────────
export const deleteUserFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ userId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const guard = await assertAdmin(getRequest().headers.get("authorization"));
    if (guard) return guard;

    // Delete profile first (CASCADE removes user_roles, bid_assignments rows)
    await (supabaseAdmin as any).from("profiles").delete().eq("id", data.userId);
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
