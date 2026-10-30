import { getPermissionContext } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { getMyProfile } from "@/lib/account/profile";
import { getMyNotificationPrefs } from "@/lib/account/notification-prefs";
import { effectiveWhatsApp } from "@/lib/account/validation";
import { resolveViewerTimezone } from "@/lib/user-timezone";
import { parseAccountTab } from "@/lib/account/tabs";
import { sectionsFor } from "@/lib/notifications/preferences";
import { emailConfigured, loadTeamAlertsChannel } from "@/lib/notifications/team-alerts";
import { AccountView } from "@/components/account/account-view";
import { ProfileTab } from "@/components/account/profile-tab";
import { NotificationsTab } from "@/components/account/notifications-tab";
import { WhatsAppTestButton } from "@/components/account/whatsapp-test-button";

/**
 * Mi cuenta (00273/00274): lo de cada persona, no del negocio. No pide ningun
 * permiso: cualquier miembro entra a la suya, y todo lo que se guarda aca sale
 * de la sesion.
 */
export default async function AccountPage({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  const [ctx, params, profile, prefs] = await Promise.all([getPermissionContext(), searchParams, getMyProfile(), getMyNotificationPrefs()]);
  const { user, workspace, role } = ctx;

  // Lo del negocio (si hay email conectado, desde que WhatsApp se avisa): con el
  // cliente de servicio, siempre para el workspace de la sesion. No sale ninguna clave.
  const service = await createServiceClient();
  const [timezone, hasEmail, alertsChannel] = await Promise.all([
    resolveViewerTimezone(workspace.timezone),
    emailConfigured(service, workspace.id),
    loadTeamAlertsChannel(service, workspace.id),
  ]);

  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const fullName = typeof meta.full_name === "string" ? meta.full_name.trim() : "";
  const shortName = typeof meta.name === "string" ? meta.name.trim() : "";
  const name = fullName || shortName;

  const isAdmin = role === "owner" || role === "admin";
  const sections = sectionsFor({ isAdmin, can: ctx.can }).map((s) => ({
    key: s.key,
    title: s.title,
    events: s.events.map((e) => ({ key: e.key, label: e.label, description: e.description })),
  }));
  const whatsappNumber = effectiveWhatsApp({
    phone: profile.phone,
    whatsapp_phone: profile.whatsappPhone,
    whatsapp_same_as_phone: profile.whatsappSameAsPhone,
  });

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
          whatsappTest={alertsChannel && whatsappNumber ? <WhatsAppTestButton /> : null}
        />
      }
      notifications={
        <NotificationsTab
          sections={sections}
          initialPrefs={prefs}
          email={{ address: user.email ?? "", configured: hasEmail }}
          whatsapp={{ number: whatsappNumber, channelReady: Boolean(alertsChannel), canConfigure: ctx.can("settings.general") }}
        />
      }
    />
  );
}
