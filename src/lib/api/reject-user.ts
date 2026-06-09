import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const rejectUserFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ userId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const token = getRequest().headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return new Response("Unauthorized", { status: 401 });

    const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
    if (authErr || !user) return new Response("Unauthorized", { status: 401 });

    const { data: roles } = await supabaseAdmin
      .from("user_roles").select("role").eq("user_id", user.id);
    const isAdmin = roles?.some((r) => r.role === "admin");
    if (!isAdmin) return new Response("Forbidden", { status: 403 });

    await supabaseAdmin.from("profiles").delete().eq("id", data.userId);
    await supabaseAdmin.auth.admin.deleteUser(data.userId);

    return { ok: true };
  });
