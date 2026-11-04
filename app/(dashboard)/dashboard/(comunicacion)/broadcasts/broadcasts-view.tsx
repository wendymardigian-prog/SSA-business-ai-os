"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Radio } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BroadcastStatus } from "@/lib/types/database";
import { PageHeader } from "@/components/page-header";
import { SectionTabs } from "@/components/comunicacion/section-tabs";
import { SectionSearch } from "@/components/comunicacion/section-search";
import { NoSearchResults } from "@/components/comunicacion/no-search-results";
import { matchesSearch } from "@/lib/comunicacion/search";
import { BROADCAST_STATUS, TONE_CLASS } from "@/lib/broadcasts/status";
import { createBroadcast } from "@/lib/actions/broadcasts";

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

export function BroadcastsView({ items, hasChannels, timeZone }: { items: BroadcastListItem[]; hasChannels: boolean; timeZone: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
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

      <div className="flex-1 overflow-auto">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
            <Radio className="h-10 w-10 text-muted-foreground/40" aria-hidden />
            <p className="mt-3 text-sm font-medium">Todavía no hay broadcasts</p>
            <p className="mt-1 max-w-sm text-xs text-muted-foreground">
              Elegí a quiénes con los mismos filtros de Contactos, el canal (WhatsApp o email) y el mensaje. Por WhatsApp salen de a poco, para no
              arriesgar el número.
            </p>
          </div>
        ) : visible.length === 0 ? (
          <NoSearchResults query={query} none="Ningún broadcast" />
        ) : (
          <ul className="divide-y divide-border">
            {visible.map((b) => {
              const status = BROADCAST_STATUS[b.status];
              const done = b.sent + b.failed;
              return (
                <li key={b.id}>
                  <Link href={`/dashboard/broadcasts/${b.id}`} className="flex flex-col gap-2 px-4 py-4 hover:bg-accent/50 sm:flex-row sm:items-center sm:gap-6 md:px-8">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate text-sm font-medium">{b.name}</h3>
                        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium", TONE_CLASS[status.tone])}>{status.label}</span>
                      </div>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {b.channelLabel ?? "Sin canal"} ·{" "}
                        {b.status === "scheduled" && b.scheduledFor ? `sale el ${formatDate(b.scheduledFor, timeZone)}` : `creado el ${formatDate(b.createdAt, timeZone)}`}
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
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
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
