"use server";

import { revalidatePath } from "next/cache";
import { getPermissionAction } from "@/lib/auth/guards";
import { logAudit } from "@/lib/audit";
import { isValidTimeZone } from "@/lib/timezone";
import {
  suggestUsername,
  usernameChangeNeedsConfirmation,
  validateUsername,
} from "@/lib/scheduling/profile";
import { getProfileForUser, takenUsernames } from "@/lib/scheduling/data/profiles";

/**
 * Perfil de agenda (F3). Cada persona edita el suyo; quien tiene
 * `scheduling.manage_others` puede editar el de otra (salvo sus cuentas de
 * Google, que no pasan por aca).
 */

const AGENDA_PATH = "/dashboard/agenda";

export type ProfileActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { data: T }))
  | { ok: false; error: string; needsConfirmation?: boolean };

export interface ProfileFormInput {
  username: string;
  displayName: string;
  timezone: string;
  timeFormat: "12h" | "24h";
  welcomeMessage?: string | null;
  /** Para editar el perfil de otra persona (manage_others). */
  forUserId?: string | null;
  confirmBrokenLinks?: boolean;
}

async function resolveTarget(forUserId: string | null | undefined) {
  const ctx = await getPermissionAction("scheduling.use");
  if (!ctx) return { ctx: null, targetId: null, error: "No tenes permiso para tener una agenda" } as const;
  const targetId = forUserId && forUserId !== ctx.user.id ? forUserId : ctx.user.id;
  if (targetId !== ctx.user.id && !ctx.can("scheduling.manage_others")) {
    return { ctx: null, targetId: null, error: "No tenes permiso para configurar la agenda de otra persona" } as const;
  }
  return { ctx, targetId, error: null } as const;
}

/** Lo que la pantalla necesita para el primer ingreso: la sugerencia de usuario. */
export async function suggestProfileUsername(forUserId?: string | null): Promise<ProfileActionResult<{ username: string; timezone: string; displayName: string }>> {
  const { ctx, targetId, error } = await resolveTarget(forUserId);
  if (!ctx) return { ok: false, error };
  const taken = await takenUsernames(ctx.supabase, ctx.workspace.id, targetId);
  const meta = (ctx.user.user_metadata ?? {}) as { full_name?: string; name?: string };
  const displayName = targetId === ctx.user.id ? meta.full_name ?? meta.name ?? ctx.user.email?.split("@")[0] ?? "" : "";
  return {
    ok: true,
    data: {
      username: suggestUsername(displayName, targetId === ctx.user.id ? ctx.user.email : null, taken),
      timezone: (ctx.workspace as { timezone?: string }).timezone ?? "America/Costa_Rica",
      displayName,
    },
  };
}

export async function saveSchedulingProfile(input: ProfileFormInput): Promise<ProfileActionResult<{ created: boolean }>> {
  const { ctx, targetId, error } = await resolveTarget(input.forUserId);
  if (!ctx) return { ok: false, error };

  const displayName = (input.displayName ?? "").trim();
  if (displayName.length < 2 || displayName.length > 80) return { ok: false, error: "El nombre visible tiene que tener entre 2 y 80 caracteres" };
  if (!isValidTimeZone(input.timezone)) return { ok: false, error: "La zona horaria no es valida" };
  if (input.timeFormat !== "12h" && input.timeFormat !== "24h") return { ok: false, error: "El formato de hora tiene que ser 12h o 24h" };

  const taken = await takenUsernames(ctx.supabase, ctx.workspace.id, targetId);
  const checked = validateUsername(input.username, { taken });
  if (!checked.ok) return { ok: false, error: checked.message };

  const existing = await getProfileForUser(ctx.supabase, ctx.workspace.id, targetId);
  const welcome = input.welcomeMessage?.trim() ? input.welcomeMessage.trim().slice(0, 500) : null;

  if (existing) {
    // Cambiar el usuario rompe links: con eventos activos se pide confirmar.
    // (Hasta que exista event_types, B3, la cuenta de eventos activos es 0.)
    const activeEvents = await countActiveEvents(ctx.supabase, ctx.workspace.id, targetId);
    const change = usernameChangeNeedsConfirmation({
      currentUsername: existing.username,
      nextUsername: checked.username,
      activeEvents,
      confirmBrokenLinks: input.confirmBrokenLinks,
    });
    if (!change.ok) return { ok: false, error: change.message, needsConfirmation: true };

    const { error: updateError } = await ctx.supabase
      .from("scheduling_profiles")
      .update({ username: checked.username, display_name: displayName, timezone: input.timezone, time_format: input.timeFormat, welcome_message: welcome })
      .eq("id", existing.id);
    if (updateError) return { ok: false, error: `No pude guardar el perfil: ${updateError.message}` };

    await logAudit({
      supabase: ctx.supabase,
      workspaceId: ctx.workspace.id,
      entityType: "scheduling_profile",
      entityId: existing.id,
      action: "scheduling_profile.updated",
      changes: {
        ...(existing.username !== checked.username ? { username: { old: existing.username, new: checked.username } } : {}),
        ...(existing.timezone !== input.timezone ? { timezone: { old: existing.timezone, new: input.timezone } } : {}),
      },
      performedBy: ctx.user.id,
    });
    revalidatePath(AGENDA_PATH);
    return { ok: true, data: { created: false } };
  }

  const { data: created, error: insertError } = await ctx.supabase
    .from("scheduling_profiles")
    .insert({
      workspace_id: ctx.workspace.id,
      user_id: targetId,
      username: checked.username,
      display_name: displayName,
      timezone: input.timezone,
      time_format: input.timeFormat,
      welcome_message: welcome,
    })
    .select("id")
    .maybeSingle();
  if (insertError || !created) {
    const dup = insertError?.code === "23505";
    return { ok: false, error: dup ? "Ese usuario ya lo usa otra persona del negocio" : `No pude crear el perfil: ${insertError?.message ?? ""}` };
  }

  await logAudit({
    supabase: ctx.supabase,
    workspaceId: ctx.workspace.id,
    entityType: "scheduling_profile",
    entityId: created.id,
    action: "scheduling_profile.created",
    performedBy: ctx.user.id,
  });
  revalidatePath(AGENDA_PATH);
  return { ok: true, data: { created: true } };
}

/** La foto: bucket `avatars`, <workspace>/<user>/avatar.<ext>, hasta 2 MB. */
export async function uploadSchedulingAvatar(formData: FormData): Promise<ProfileActionResult<{ url: string }>> {
  const forUserId = (formData.get("forUserId") as string | null) || null;
  const { ctx, targetId, error } = await resolveTarget(forUserId);
  if (!ctx) return { ok: false, error };

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "Elegi una imagen" };
  const allowed: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
  const ext = allowed[file.type];
  if (!ext) return { ok: false, error: "La foto tiene que ser jpg, png o webp" };
  if (file.size > 2 * 1024 * 1024) return { ok: false, error: "La foto no puede pesar mas de 2 MB" };

  const profile = await getProfileForUser(ctx.supabase, ctx.workspace.id, targetId);
  if (!profile) return { ok: false, error: "Primero guarda tu usuario y tu zona horaria" };

  const path = `${ctx.workspace.id}/${targetId}/avatar-${Date.now()}.${ext}`;
  const { error: uploadError } = await ctx.supabase.storage
    .from("avatars")
    .upload(path, file, { contentType: file.type, upsert: true });
  if (uploadError) return { ok: false, error: `No pude subir la foto: ${uploadError.message}` };

  const { data: pub } = ctx.supabase.storage.from("avatars").getPublicUrl(path);
  await ctx.supabase.from("scheduling_profiles").update({ avatar_url: pub.publicUrl }).eq("id", profile.id);
  revalidatePath(AGENDA_PATH);
  return { ok: true, data: { url: pub.publicUrl } };
}

async function countActiveEvents(supabase: Parameters<typeof getProfileForUser>[0], workspaceId: string, userId: string): Promise<number> {
  // event_types llega en B3; hasta entonces no hay links que romper.
  const { count, error } = await supabase
    .from("event_types" as never)
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("owner_user_id", userId)
    .in("status", ["active", "hidden"])
    .is("deleted_at", null);
  if (error) return 0;
  return count ?? 0;
}
