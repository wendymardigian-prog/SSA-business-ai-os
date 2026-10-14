"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Bot, CheckCircle2, AlertCircle, RefreshCw, Settings } from "lucide-react";
import { Popover } from "@/components/ui/popover";
import { Tip } from "@/components/ui/tooltip";
import { PERIOD_LABELS, PERIOD_PRESETS, type PeriodPreset } from "@/lib/dashboards/period";
import { syncMetaAdsNow } from "@/lib/actions/meta-ads-sync";

/**
 * Los controles de la barra superior del dashboard de anuncios: la pill de
 * sincronizacion, los filtros (cuenta y periodo) y los botones de la derecha.
 */

const ICON_BUTTON =
  "inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-background text-foreground transition-colors hover:bg-accent disabled:opacity-60";

const SELECT =
  "h-8 rounded-lg border border-input bg-background px-3 text-xs shadow-sm focus:outline-none focus:ring-2 focus:ring-ring/30";

/**
 * "Sincronizado · hoy 14:32". Los datos NO son en vivo: vienen del sync, y
 * decir "en tiempo real" seria mentir. La hora dice cuan frescos son.
 */
export function SyncedPill({ label }: { label: string | null }) {
  return (
    <span className="hidden items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400 sm:inline-flex">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(34,197,94,0.18)]" aria-hidden />
      {label ? `Sincronizado · ${label}` : "Sincronizado"}
    </span>
  );
}

export function HeaderFilters({
  accounts,
  adAccountId,
  period,
  onChange,
}: {
  accounts: Array<{ id: string; name: string | null }>;
  adAccountId: string;
  period: PeriodPreset;
  onChange: (params: { cuenta?: string; periodo?: string }) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      {accounts.length > 1 && (
        <select
          aria-label="Cuenta publicitaria"
          value={adAccountId}
          onChange={(e) => onChange({ cuenta: e.target.value })}
          className={SELECT}
        >
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name || account.id}
            </option>
          ))}
        </select>
      )}
      <select aria-label="Periodo" value={period} onChange={(e) => onChange({ periodo: e.target.value })} className={SELECT}>
        {PERIOD_PRESETS.map((preset) => (
          <option key={preset} value={preset}>
            {PERIOD_LABELS[preset]}
          </option>
        ))}
      </select>
    </div>
  );
}

export function RefreshButton({ refreshing, onRefresh }: { refreshing: boolean; onRefresh: () => void }) {
  return (
    <button
      type="button"
      onClick={onRefresh}
      disabled={refreshing}
      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs transition-colors hover:bg-accent disabled:opacity-60"
    >
      <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} aria-hidden />
      <span className="hidden sm:inline">Actualizar</span>
      <span className="sr-only sm:hidden">Actualizar</span>
    </button>
  );
}

/**
 * "Sincronizar ahora": pide traer ya las metricas, el catalogo y las miniaturas de la cuenta.
 * La sincronizacion corre en segundo plano (la cola la toma en un minuto): el boton solo la pide.
 */
function SyncNowButton({ adAccountId }: { adAccountId: string }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const onClick = () =>
    startTransition(async () => {
      const result = await syncMetaAdsNow(adAccountId);
      setMessage(
        result.ok
          ? { tone: "ok", text: result.alreadyQueued ? "Ya hay una sincronización en camino." : "Listo, la sincronización está en camino. Tarda un par de minutos." }
          : { tone: "error", text: result.error },
      );
    });

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-background text-xs font-medium transition-colors hover:bg-accent disabled:opacity-60"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${pending ? "animate-spin" : ""}`} aria-hidden />
        Sincronizar ahora
      </button>
      {message && (
        <p role="status" className={`text-[11px] leading-relaxed ${message.tone === "error" ? "text-destructive" : "text-muted-foreground"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}

export function HeaderActions({
  refreshing,
  onRefresh,
  onOpenAi,
  account,
  syncedLabel,
  canSync = false,
}: {
  refreshing: boolean;
  onRefresh: () => void;
  onOpenAi: () => void;
  account: { id: string; name: string | null; currency: string | null; lastError: string | null } | null;
  syncedLabel: string | null;
  /** Tiene `settings.general`: puede pedir la sincronizacion. */
  canSync?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <RefreshButton refreshing={refreshing} onRefresh={onRefresh} />

      <Tip content="Analizar con IA" side="bottom">
        <button type="button" onClick={onOpenAi} aria-label="Analizar con IA" className={ICON_BUTTON}>
          <Bot className="h-3.5 w-3.5" aria-hidden />
        </button>
      </Tip>

      {account && (
        <Popover
          label="Configuración de cuenta"
          triggerClassName={ICON_BUTTON}
          trigger={<Settings className="h-3.5 w-3.5" aria-hidden />}
          panelClassName="w-72 space-y-3"
        >
          <div className="space-y-0.5">
            <p className="text-xs font-semibold">Cuenta conectada</p>
            <p className="text-[11px] text-muted-foreground">{account.name || "Meta Ads"}</p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            {account.lastError ? (
              <>
                <AlertCircle className="h-3.5 w-3.5 text-amber-500" aria-hidden />
                <span className="font-medium text-amber-600">Con un error al sincronizar</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" aria-hidden />
                <span className="font-medium text-emerald-600">Conectado</span>
              </>
            )}
          </div>
          {account.lastError && <p className="text-[11px] leading-relaxed text-muted-foreground">{account.lastError}</p>}
          <div className="space-y-1">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Account ID</p>
            <p className="break-all font-mono text-xs">{account.id}</p>
          </div>
          <div className="flex justify-between gap-3 text-xs">
            <div className="space-y-1">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Moneda</p>
              <p>{account.currency ?? "—"}</p>
            </div>
            <div className="space-y-1 text-right">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Última sincronización</p>
              <p>{syncedLabel ?? "—"}</p>
            </div>
          </div>
          {canSync && <SyncNowButton adAccountId={account.id} />}
          <Link
            href="/dashboard/dashboards/ads/sin-vincular"
            className="flex h-8 w-full items-center justify-center rounded-lg border border-border text-xs font-medium transition-colors hover:bg-accent"
          >
            Toques sin vincular
          </Link>
          <Link
            href="/dashboard/settings/integrations"
            className="flex h-8 w-full items-center justify-center rounded-lg bg-primary text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            Cambiar cuenta
          </Link>
        </Popover>
      )}
    </div>
  );
}
