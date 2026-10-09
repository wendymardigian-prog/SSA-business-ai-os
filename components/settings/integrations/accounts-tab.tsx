import type { ProviderDefinition } from "@/lib/integrations/providers";
import type { AdAccount } from "@/lib/meta/accounts";
import { MetaAccountsFooter } from "./meta-accounts-footer";
import { YouTubeProbeFooter } from "./youtube-probe-footer";
import { GoogleServices } from "./google-services";
import { PublisherDefaults, type SocialAccountRow } from "./publisher-defaults";
import { ChannelsPanel, type Channel } from "@/components/channels/channels-panel";

/** A donde vuelve el OAuth de un canal conectado desde la pestaña Cuentas de Zernio. */
const ZERNIO_ACCOUNTS_HREF = "/dashboard/settings/integrations/zernio?tab=cuentas";

/**
 * La pestaña Cuentas del detalle (G5): lo que antes eran los `extraFooter`
 * del modal, mas el selector de publicador por defecto (G7). Cada proveedor
 * tiene el suyo; los que no tienen nada que mostrar (resend, las de IA) ni
 * siquiera llegan aca (ver `hasAccountsTab`).
 */
export function hasAccountsTab(providerId: string): boolean {
  return ["zernio", "evolution", "postproxy", "linkedin", "threads", "google", "meta"].includes(providerId);
}

export function AccountsTab({
  provider,
  channels,
  metaAccounts,
  metaIgUsername,
  youtubeVerifiedAt,
  calendarPeople,
  youtubeConnected,
  socialAccounts,
}: {
  provider: ProviderDefinition;
  /** Los canales del workspace (las filas completas): "cuentas" y "canales" son lo mismo. */
  channels: Channel[];
  metaAccounts: AdAccount[];
  metaIgUsername: string | null;
  youtubeVerifiedAt: string | null;
  calendarPeople: number;
  youtubeConnected: boolean;
  socialAccounts: SocialAccountRow[];
}) {
  if (provider.id === "zernio") {
    return (
      <div className="space-y-8">
        <ChannelsPanel channels={channels} provider="zernio" returnTo={ZERNIO_ACCOUNTS_HREF} />
        <div className="max-w-lg">
          <p className="text-sm font-medium">Por donde publica cada cuenta</p>
          <div className="mt-2">
            <PublisherDefaults accounts={socialAccounts} />
          </div>
        </div>
      </div>
    );
  }

  if (provider.id === "evolution") {
    // El mismo panel que en Zernio, filtrado a WhatsApp: tarjeta con su estado
    // en vivo (connected / connecting / desconectado) y el QR para vincular.
    return (
      <div className="space-y-3">
        <ChannelsPanel channels={channels} provider="evolution" returnTo="/dashboard/settings/integrations/evolution?tab=cuentas" />
        <p className="max-w-lg text-[11px] text-muted-foreground">
          El modelo es un numero de WhatsApp por workspace: no se gestionan varias instancias de
          Evolution desde aca.
        </p>
      </div>
    );
  }

  if (provider.id === "meta") {
    return (
      <div className="max-w-lg">
        <MetaAccountsFooter accounts={metaAccounts} igUsername={metaIgUsername} />
      </div>
    );
  }

  if (provider.id === "google") {
    return (
      <div className="max-w-lg space-y-5">
        <GoogleServices youtubeConnected={youtubeConnected} calendarPeople={calendarPeople} />
        <YouTubeProbeFooter verifiedAt={youtubeVerifiedAt} />
        <div>
          <p className="text-sm font-medium">Por donde publica YouTube</p>
          <div className="mt-2">
            <PublisherDefaults accounts={socialAccounts} />
          </div>
        </div>
      </div>
    );
  }

  if (provider.id === "postproxy" || provider.id === "linkedin" || provider.id === "threads") {
    return (
      <div className="max-w-lg">
        <PublisherDefaults accounts={socialAccounts} />
      </div>
    );
  }

  return null;
}
