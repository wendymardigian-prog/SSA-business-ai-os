"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { CHIP_LABELS, chipsOf, type ProviderDefinition } from "@/lib/integrations/providers";
import { formatLastRefreshed, formatLongDate, formatOAuthExpiry } from "@/lib/integrations/format";
import { useViewerTimezone } from "@/components/dashboard-chrome";
import { CredentialsForm } from "./credentials-form";
import { AccountsTab, hasAccountsTab, type EvolutionChannelInfo } from "./accounts-tab";
import type { SocialAccountRow } from "./publisher-defaults";
import type { IntegrationCardData } from "./types";
import type { AdAccount } from "@/lib/meta/accounts";

export interface ActivityEntry {
  id: string;
  label: string;
  performedAt: string;
  actorLabel: string;
}

const TABS = ["credenciales", "cuentas", "actividad"] as const;
type Tab = (typeof TABS)[number];

/**
 * El detalle de una integracion (G5): antes era un modal, ahora es una
 * pantalla con tres pestañas. El chip y "Requiere atencion" del listado
 * viajan en la URL con la que se llega y vuelven con la persona al salir.
 */
export function IntegrationDetail({
  provider,
  data,
  webhookUrl,
  channelsSummary,
  metaAccounts,
  metaIgUsername,
  youtubeVerifiedAt,
  evolutionChannel,
  socialAccounts,
  activityEntries,
}: {
  provider: ProviderDefinition;
  data: IntegrationCardData;
  webhookUrl: string | null;
  channelsSummary: Array<{ id: string; label: string; platform: string }>;
  metaAccounts: AdAccount[];
  metaIgUsername: string | null;
  youtubeVerifiedAt: string | null;
  evolutionChannel: EvolutionChannelInfo | null;
  socialAccounts: SocialAccountRow[];
  activityEntries: ActivityEntry[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const showAccounts = hasAccountsTab(provider.id);
  const tabParam = searchParams.get("tab");
  const activeTab: Tab =
    TABS.includes(tabParam as Tab) && (tabParam !== "cuentas" || showAccounts)
      ? (tabParam as Tab)
      : "credenciales";

  // El chip y "Requiere atencion" con los que se llego vuelven al salir.
  const backParams = new URLSearchParams();
  const tipo = searchParams.get("tipo");
  const atencion = searchParams.get("atencion");
  if (tipo) backParams.set("tipo", tipo);
  if (atencion) backParams.set("atencion", atencion);
  const backQs = backParams.toString();
  const backHref = `/dashboard/settings/integrations${backQs ? `?${backQs}` : ""}`;

  function setTab(tab: Tab) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", tab);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  const chips = chipsOf(provider);

  return (
    <div className="flex h-full flex-col">
      <PageHeader title={provider.label} tooltip={provider.description} />

      <nav className="flex items-center gap-1 px-4 pt-3 text-xs text-muted-foreground md:px-6">
        <Link href={backHref} className="hover:underline">
          Ajustes
        </Link>
        <ChevronRight className="h-3 w-3" aria-hidden />
        <Link href={backHref} className="hover:underline">
          Integraciones
        </Link>
        <ChevronRight className="h-3 w-3" aria-hidden />
        <span className="text-foreground">{provider.label}</span>
      </nav>

      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1 px-4 pt-2 md:px-6">
          {chips.map((c) => (
            <span
              key={c}
              className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
            >
              {CHIP_LABELS[c]}
            </span>
          ))}
        </div>
      )}

      <div className="flex gap-4 border-b border-border px-4 pt-3 md:px-6">
        <TabButton active={activeTab === "credenciales"} onClick={() => setTab("credenciales")} label="Credenciales" />
        {showAccounts && (
          <TabButton active={activeTab === "cuentas"} onClick={() => setTab("cuentas")} label="Cuentas" />
        )}
        <TabButton active={activeTab === "actividad"} onClick={() => setTab("actividad")} label="Actividad" />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
        {activeTab === "credenciales" && (
          <CredentialsForm provider={provider} data={data} webhookUrl={webhookUrl} />
        )}
        {activeTab === "cuentas" && showAccounts && (
          <AccountsTab
            provider={provider}
            channelsSummary={channelsSummary}
            metaAccounts={metaAccounts}
            metaIgUsername={metaIgUsername}
            youtubeVerifiedAt={youtubeVerifiedAt}
            calendarPeople={data.calendarPeople ?? 0}
            youtubeConnected={Boolean(data.oauth)}
            evolutionChannel={evolutionChannel}
            socialAccounts={socialAccounts}
          />
        )}
        {activeTab === "actividad" && <ActivityList entries={activityEntries} oauth={data.oauth ?? null} />}
      </div>
    </div>
  );
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`border-b-2 pb-2 text-sm font-medium ${
        active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

function ActivityList({
  entries,
  oauth,
}: {
  entries: ActivityEntry[];
  oauth: IntegrationCardData["oauth"];
}) {
  const timeZone = useViewerTimezone();
  return (
    <div className="max-w-lg space-y-4">
      {oauth && (
        <div className="rounded-lg border border-border p-3 text-xs">
          <p className="font-medium">Estado actual de la conexion</p>
          <p className="mt-1 text-muted-foreground">
            {[formatOAuthExpiry(oauth.tokenExpiresAt, timeZone), formatLastRefreshed(oauth.lastRefreshedAt, timeZone)]
              .filter(Boolean)
              .join(" · ") || "Sin vencimiento conocido"}
          </p>
        </div>
      )}

      {entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">Todavia no hay actividad registrada.</p>
      ) : (
        <ul className="space-y-2">
          {entries.map((entry) => (
            <li key={entry.id} className="rounded-lg border border-border p-3 text-xs">
              <p className="font-medium">{entry.label}</p>
              <p className="mt-0.5 text-muted-foreground">
                {entry.actorLabel} · {formatLongDate(entry.performedAt, timeZone) ?? entry.performedAt}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
