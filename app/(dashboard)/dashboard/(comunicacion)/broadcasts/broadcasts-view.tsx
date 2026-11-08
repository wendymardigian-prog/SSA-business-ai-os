"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, Plus, Radio, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BroadcastStatus } from "@/lib/types/database";
import { PageHeader } from "@/components/page-header";
import { SectionTabs } from "@/components/comunicacion/section-tabs";
import { SectionSearch } from "@/components/comunicacion/section-search";
import { NoSearchResults } from "@/components/comunicacion/no-search-results";
import { matchesSearch } from "@/lib/comunicacion/search";
import { BROADCAST_STATUS, TONE_CLASS } from "@/lib/broadcasts/status";
import { canDeleteBroadcast, STATUS_FILTERS } from "@/lib/broadcasts/list";
import { createBroadcast, deleteBroadcastAction } from "@/lib/actions/broadcasts";
import { useInboxUrl } from "@/components/inbox/use-inbox-url";

export interface BroadcastListItem {
  id: string;
  name: string;
  status: BroadcastStatus;
  channelLabel: string | null;
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  scheduledFor: string | null;
  createdAt: string;
}

function formatDate(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleString("es", { timeZone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function BroadcastsView({
  items,
  counts,
  statusFilter,
  hasChannels,
  timeZone,
}: {
  items: BroadcastListItem[];
  /** Cuántos hay en cada estado (para las píldoras del filtro). */
  counts: Record<BroadcastStatus, number>;
  /** El estado de `?estado=`, o null para "Todos". */
  statusFilter: BroadcastStatus | null;
  hasChannels: boolean;
  timeZone: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const url = useInboxUrl();
  const totalAll = STATUS_FILTERS.reduce((n, f) => n + (counts[f.status] ?? 0), 0);
  // Bloque I (I4): el buscador de la barra filtra la lista que ya llego.
  const query = useSearchParams().get("q") ?? "";
  const visible = items.filter((b) => matchesSearch(query, b.name));

  function create() {
    setError(null);
    start(async () => {
      const res = await createBroadcast({});
      if (res.ok) router.push(`/dashboard/broadcasts/${res.id}`);
      else setError(res.error);
    });
  }

  function remove(b: BroadcastListItem) {
    if (!window.confirm(`¿Eliminar «${b.name}»? No salió ningún mensaje: se borra junto con su cola y no se puede deshacer.`)) return;
    setError(null);
    setDeletingId(b.id);
    start(async () => {
      const res = await deleteBroadcastAction(b.id);
      setDeletingId(null);
      if (!res.ok) setError(res.error);
      router.refresh();
    });
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        route="/dashboard/broadcasts"
        left={<SectionTabs />}
        filters={<SectionSearch value={query} placeholder="Buscar un broadcast" label="Buscar broadcasts" />}
        right={
          <button
            type="button"
            onClick={create}
            disabled={pending}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            <Plus className="h-4 w-4" aria-hidden />
            <span className="hidden sm:inline">Nuevo broadcast</span>
            <span className="sr-only sm:hidden">Nuevo broadcast</span>
          </button>
        }
      />

      {error && (
        <p role="alert" className="mx-4 mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 md:mx-8 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      )}

      {!hasChannels && (
        <p className="mx-4 mt-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground md:mx-8">
          Para mandar un broadcast hace falta un número de WhatsApp conectado o el email configurado.{" "}
          <Link href="/dashboard/channels" className="font-medium text-primary-ink underline-offset-2 hover:underline">
            Ir a Canales
          </Link>
        </p>
      )}

      {totalAll > 0 && (
        <nav aria-label="Filtrar por estado" className="flex flex-wrap items-center gap-1.5 border-b border-border px-4 py-2.5 md:px-8">
          <StatusPill label="Todos" count={totalAll} active={statusFilter === null} onClick={() => url.setParam("estado", "")} />
          {STATUS_FILTERS.filter((f) => (counts[f.status] ?? 0) > 0 || statusFilter === f.status).map((f) => (
            <StatusPill
              key={f.param}
              label={BROADCAST_STATUS[f.status].label}
              count={counts[f.status] ?? 0}
              active={statusFilter === f.status}
              onClick={() => url.setParam("estado", f.param)}
            />
          ))}
          {url.pending && <Loader2 className="ml-1 h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden />}
        </nav>
      )}

      <div className="flex-1 overflow-auto">
        {totalAll === 0 && items.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
            <Radio className="h-10 w-10 text-muted-foreground/40" aria-hidden />
            <p className="mt-3 text-sm font-medium">Todavía no hay broadcasts</p>
            <p className="mt-1 max-w-sm text-xs text-muted-foreground">
              Elegí a quiénes con los mismos filtros de Contactos, el canal (WhatsApp o email) y el mensaje. Por WhatsApp salen de a poco, para no
              arriesgar el número.
            </p>
          </div>
        ) : visible.length === 0 ? (
          query ? (
            <NoSearchResults query={query} none="Ningún broadcast" />
          ) : (
            <p className="px-6 py-16 text-center text-sm text-muted-foreground">
              No hay broadcasts {statusFilter ? `en «${BROADCAST_STATUS[statusFilter].label}»` : ""}.
            </p>
          )
        ) : (
          <ul className="divide-y divide-border">
            {visible.map((b) => {
              const status = BROADCAST_STATUS[b.status];
              const done = b.sent + b.failed;
              const deletable = canDeleteBroadcast(b);
              return (
                <li key={b.id} className="group flex items-center hover:bg-accent/50">
                  <Link href={`/dashboard/broadcasts/${b.id}`} className="flex min-w-0 flex-1 flex-col gap-2 py-4 pl-4 pr-2 sm:flex-row sm:items-center sm:gap-6 md:pl-8">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate text-sm font-medium">{b.name}</h3>
                        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium", TONE_CLASS[status.tone])}>{status.label}</span>
                      </div>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {b.channelLabel ?? "Sin canal"} · creado el {formatDate(b.createdAt, timeZone)}
                        {b.status === "scheduled" && b.scheduledFor ? ` · sale el ${formatDate(b.scheduledFor, timeZone)}` : ""}
                      </p>
                    </div>
                    {b.status !== "draft" && (
                      <div className="flex shrink-0 items-center gap-5 text-center text-xs">
                        <Stat label="Destinatarios" value={b.total} />
                        <Stat label="Enviados" value={b.sent} className="text-green-700 dark:text-green-400" />
                        <Stat label="Fallidos" value={b.failed} className={b.failed ? "text-red-700 dark:text-red-400" : undefined} />
                        <Stat label="Salteados" value={b.skipped} />
                        {b.status === "sending" && b.total > 0 && <Stat label="Avance" value={`${Math.round((done / b.total) * 100)} %`} />}
                      </div>
                    )}
                  </Link>
                  <div className="flex w-12 shrink-0 justify-center pr-2 md:mr-4">
                    {deletable && (
                      <button
                        type="button"
                        onClick={() => remove(b)}
                        disabled={pending}
                        aria-label={`Eliminar ${b.name}`}
                        title="Eliminar (no salió ningún mensaje)"
                        className="rounded-lg p-2 text-muted-foreground hover:bg-red-50 hover:text-red-700 disabled:opacity-50 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                      >
                        {deletingId === b.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Trash2 className="h-4 w-4" aria-hidden />}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function StatusPill({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs font-medium",
        active ? "border-primary-edge bg-primary/10 text-primary-ink" : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {label}
      <span className="tabular-nums opacity-70">{count}</span>
    </button>
  );
}

function Stat({ label, value, className }: { label: string; value: number | string; className?: string }) {
  return (
    <div>
      <p className={cn("text-base font-semibold tabular-nums", className)}>{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
    </div>
  );
}
