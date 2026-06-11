import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const approveUserFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ userId: z.string().uuid(), role: z.enum(["pre_sales", "legal", "finance", "admin"]) }))
  .handler(async ({ data }) => {
    const token = getRequest().headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return new Response("Unauthorized", { status: 401 });

    const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
    if (authErr || !user) return new Response("Unauthorized", { status: 401 });

    const { data: roles } = await supabaseAdmin
      .from("user_roles").select("role").eq("user_id", user.id);
    if (!roles?.some((r) => r.role === "admin")) return new Response("Forbidden", { status: 403 });

    const { data: profile } = await supabaseAdmin
      .from("profiles").select("email").eq("id", data.userId).single();

    await supabaseAdmin.from("profiles").update({ status: "active" }).eq("id", data.userId);
    await supabaseAdmin.from("user_roles").delete().eq("user_id", data.userId);
    await supabaseAdmin.from("user_roles").insert({ user_id: data.userId, role: data.role });

    if (profile?.email) {
      await (supabaseAdmin as any)
        .from("notifications")
        .update({ read: true })
        .eq("type", "new_user_signup")
        .ilike("body", `%${profile.email}%`);
    }

    return { ok: true };
  });
