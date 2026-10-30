import { getWorkspace } from "@/lib/workspace";
import { getMyProfile } from "@/lib/account/profile";
import { resolveViewerTimezone } from "@/lib/user-timezone";
import { parseAccountTab } from "@/lib/account/tabs";
import { AccountView } from "@/components/account/account-view";
import { ProfileTab } from "@/components/account/profile-tab";

/**
 * Mi cuenta (00273/00274): lo de cada persona, no del negocio. No pide ningun
 * permiso: cualquier miembro entra a la suya, y todo lo que se guarda aca sale
 * de la sesion.
 */
export default async function AccountPage({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  const [{ user, workspace }, params, profile] = await Promise.all([getWorkspace(), searchParams, getMyProfile()]);
  const timezone = await resolveViewerTimezone(workspace.timezone);

  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const fullName = typeof meta.full_name === "string" ? meta.full_name.trim() : "";
  const shortName = typeof meta.name === "string" ? meta.name.trim() : "";
  const name = fullName || shortName;

  return (
    <AccountView
      initialTab={parseAccountTab(params.tab)}
      profile={
        <ProfileTab
          email={user.email ?? ""}
          name={name}
          avatarUrl={profile.avatarUrl}
          phone={profile.phone}
          whatsappPhone={profile.whatsappPhone}
          whatsappSameAsPhone={profile.whatsappSameAsPhone}
          timezone={timezone}
        />
      }
      notifications={<p className="text-sm text-muted-foreground">Muy pronto.</p>}
    />
  );
}
