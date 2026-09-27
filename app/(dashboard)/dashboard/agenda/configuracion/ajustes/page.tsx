import { getPermissionContext } from "@/lib/auth/guards";
import { getProfileForUser, listMembersWithProfiles, takenUsernames } from "@/lib/scheduling/data/profiles";
import { suggestUsername } from "@/lib/scheduling/profile";
import { ProfileSettingsView } from "@/components/scheduling/profile-settings-view";

export const dynamic = "force-dynamic";

/**
 * Configuracion de agenda > Ajustes (F3): el perfil de agenda de la persona.
 * Con `scheduling.manage_others` se puede editar el de otra (`?persona=`),
 * salvo sus cuentas de Google.
 */
export default async function AgendaAjustesPage({ searchParams }: { searchParams: Promise<{ persona?: string }> }) {
  const ctx = await getPermissionContext();
  const params = await searchParams;
  const canManageOthers = ctx.can("scheduling.manage_others");
  const targetUserId = canManageOthers && params.persona ? params.persona : ctx.user.id;

  const [profile, taken, members] = await Promise.all([
    getProfileForUser(ctx.supabase, ctx.workspace.id, targetUserId),
    takenUsernames(ctx.supabase, ctx.workspace.id, targetUserId),
    canManageOthers ? listMembersWithProfiles(ctx.supabase, ctx.workspace.id) : Promise.resolve([]),
  ]);

  const meta = (ctx.user.user_metadata ?? {}) as { full_name?: string; name?: string };
  const ownName = meta.full_name ?? meta.name ?? ctx.user.email?.split("@")[0] ?? "";
  const workspaceTimezone = (ctx.workspace as { timezone?: string }).timezone ?? "America/Costa_Rica";
  const isSelf = targetUserId === ctx.user.id;

  return (
    <ProfileSettingsView
      targetUserId={targetUserId}
      isSelf={isSelf}
      canManageOthers={canManageOthers}
      canManageSettings={ctx.can("settings.manage")}
      members={members.map((m) => ({ userId: m.userId, label: m.profile?.display_name ?? m.userId.slice(0, 8), username: m.profile?.username ?? null }))}
      initial={
        profile
          ? { username: profile.username, displayName: profile.display_name, timezone: profile.timezone, timeFormat: profile.time_format, welcomeMessage: profile.welcome_message ?? "", avatarUrl: profile.avatar_url }
          : { username: suggestUsername(isSelf ? ownName : "", isSelf ? ctx.user.email : null, taken), displayName: isSelf ? ownName : "", timezone: workspaceTimezone, timeFormat: "24h", welcomeMessage: "", avatarUrl: null }
      }
      exists={Boolean(profile)}
      publicBase={`${process.env.NEXT_PUBLIC_APP_URL ?? ""}/calendario/`}
    />
  );
}
