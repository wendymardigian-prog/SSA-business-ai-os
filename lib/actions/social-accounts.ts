"use server";

import { revalidatePath } from "next/cache";
import { getAdminContext } from "@/lib/auth/guards";
import { logAudit } from "@/lib/audit";
import { parsePublishers, canChooseDefault, type PublisherId } from "@/lib/social/accounts-schema";

/**
 * Cambiar el publicador por defecto de una cuenta social, a mano (G7).
 *
 * Hoy solo se puede elegir post por post, en el editor de contenido. Lo que
 * se guarda ACA es `social_accounts.default_publisher`, que `syncSocialAccounts`
 * (lib/social/accounts.ts) ya respeta mientras siga usable, y que
 * `schedule-core.ts` ya lee como respaldo cuando un post no elige uno.
 *
 * El rol se revalida aca: el guard de la pagina es comodidad, la barrera real
 * es esto mas la RLS de `social_accounts` (solo Owner/Admin escriben, 00082).
 */
export type SocialAccountActionResult = { ok: true } | { ok: false; error: string };

export async function setDefaultPublisher(
  accountId: string,
  publisher: PublisherId,
): Promise<SocialAccountActionResult> {
  const ctx = await getAdminContext();
  if (!ctx) return { ok: false, error: "Solo Owner y Admin pueden elegir el publicador" };

  const { data: account, error: readError } = await ctx.supabase
    .from("social_accounts")
    .select("id, platform, publishers, default_publisher")
    .eq("id", accountId)
    .eq("workspace_id", ctx.workspace.id)
    .maybeSingle();

  if (readError || !account) {
    return { ok: false, error: "No encontre esa cuenta" };
  }

  const parsed = parsePublishers(account.publishers);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }
  if (!canChooseDefault(parsed.publishers, publisher)) {
    return { ok: false, error: "Ese publicador no esta disponible para esta cuenta ahora mismo" };
  }

  const { error: writeError } = await ctx.supabase
    .from("social_accounts")
    .update({ default_publisher: publisher })
    .eq("id", accountId)
    .eq("workspace_id", ctx.workspace.id);

  if (writeError) {
    return { ok: false, error: "No pude guardar el cambio" };
  }

  await logAudit({
    supabase: ctx.supabase,
    workspaceId: ctx.workspace.id,
    entityType: "social_account",
    entityId: accountId,
    action: "update",
    changes: {
      default_publisher: { old: account.default_publisher, new: publisher },
    },
    metadata: { platform: account.platform },
    performedBy: ctx.user.id,
  });

  revalidatePath("/dashboard/settings/integrations");
  return { ok: true };
}
