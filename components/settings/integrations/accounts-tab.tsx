import Link from "next/link";
import type { ProviderDefinition } from "@/lib/integrations/providers";
import type { AdAccount } from "@/lib/meta/accounts";
import { MetaAccountsFooter } from "./meta-accounts-footer";
import { YouTubeProbeFooter } from "./youtube-probe-footer";
import { GoogleServices } from "./google-services";
import { PublisherDefaults, type SocialAccountRow } from "./publisher-defaults";

export interface EvolutionChannelInfo {
  connectionStatus: string;
  lastError: string | null;
  label: string | null;
}

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
  channelsSummary,
  metaAccounts,
  metaIgUsername,
  youtubeVerifiedAt,
  calendarPeople,
  youtubeConnected,
  evolutionChannel,
  socialAccounts,
}: {
  provider: ProviderDefinition;
  channelsSummary: Array<{ id: string; label: string; platform: string }>;
  metaAccounts: AdAccount[];
  metaIgUsername: string | null;
  youtubeVerifiedAt: string | null;
  calendarPeople: number;
  youtubeConnected: boolean;
  evolutionChannel: EvolutionChannelInfo | null;
  socialAccounts: SocialAccountRow[];
}) {
  if (provider.id === "zernio") {
    return (
      <div className="max-w-lg space-y-5">
        <div>
          <p className="text-sm font-medium">Cuentas conectadas</p>
          {channelsSummary.length === 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Todavia no hay cuentas conectadas. Al guardar la clave se sincronizan solas.
            </p>
          ) : (
            <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
              {channelsSummary.map((c) => (
                <li key={c.id}>
                  {c.label} <span className="opacity-70">({c.platform})</span>
                </li>
              ))}
            </ul>
          )}
          <Link href="/dashboard/channels" className="mt-2 inline-block text-xs underline">
            Administrar canales
          </Link>
        </div>
        <div>
          <p className="text-sm font-medium">Por donde publica cada cuenta</p>
          <div className="mt-2">
            <PublisherDefaults accounts={socialAccounts} />
          </div>
        </div>
      </div>
    );
  }

  if (provider.id === "evolution") {
    // Mismas tres etiquetas y la misma columna que /dashboard/channels
    // (channels-view.tsx): connected/connecting/cualquier otra cosa (G6).
    const label =
      evolutionChannel?.connectionStatus === "connected"
        ? "Conectado"
        : evolutionChannel?.connectionStatus === "connecting"
          ? "Conectando"
          : "Desconectado";
    return (
      <div className="max-w-lg space-y-3">
        <div className="rounded-lg border border-border p-3">
          <p className="text-sm font-medium">WhatsApp</p>
          {evolutionChannel ? (
            <>
              <p className="mt-1 text-xs text-muted-foreground">
                {evolutionChannel.label ?? "Numero conectado"} · {label}
              </p>
              {evolutionChannel.connectionStatus !== "connected" && evolutionChannel.lastError && (
                <p className="mt-1 text-xs text-red-600 dark:text-red-400">{evolutionChannel.lastError}</p>
              )}
            </>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">Todavia no hay un numero conectado.</p>
          )}
        </div>
        <Link href="/dashboard/channels" className="inline-block text-xs underline">
          Abrir WhatsApp (QR)
        </Link>
        <p className="text-[11px] text-muted-foreground">
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
