"use client";

/**
 * «Cola de mensajes» (cola de WhatsApp, 00420). Una tarjeta por número (estado, cupo de la hora y del día, ritmo y
 * reserva, pausar o reanudar, lo masivo, el calentamiento y vaciar) y los envíos por estado en pestañas. Las reglas viven
 * en `lib/send-queue/automation/*`: este componente solo las compone. Colores de estado: verde, amarillo y rojo.
 */
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Flame, Loader2, MoreVertical, Pause, Play, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { ContactCapCard } from "@/components/send-queue/contact-cap-card";
import { LaneAlertCard } from "@/components/send-queue/lane-alert-card";
import { WarmupDialog } from "@/components/send-queue/warmup-dialog";
import { TopbarTabs } from "@/components/ui/topbar-tabs";
import { LinkFilterMenu } from "@/components/ui/link-filter-menu";
import { DataTable, type DataColumn } from "@/components/ui/data-table/data-table";
import { useTablePrefs } from "@/components/ui/data-table/use-table-prefs";
import type { ColumnMeta } from "@/lib/ui/data-table/prefs";
import { emptyQueueLane, pauseQueueLane, resumeQueueLane, setBulkPaused } from "@/lib/actions/send-queue";
import { displayStatus, REASON_LABELS, type QueueTone, type StatusTabKey } from "@/lib/send-queue/automation/labels";
import { PRIORITY_LABELS } from "@/lib/send-queue/automation/settings";
import { barTone, busiestWarning, queueTimingText, type LaneCard, type QueueRow, type QueueScreen } from "@/lib/send-queue/automation/screen";

const ROUTE = "/dashboard/flows/cola";
const SHOW_REASON = new Set<string>(["failed", "expired", "overdue", "discarded"]);

const PILL_CLASS: Record<QueueTone, string> = {
  green: "bg-green-600/15 text-green-800 dark:text-green-300",
  yellow: "bg-yellow-400/20 text-yellow-900 dark:bg-yellow-400/15 dark:text-yellow-300",
  red: "bg-red-600/15 text-red-800 dark:text-red-300",
  neutral: "bg-foreground/10 text-foreground/90",
};

const BAR_CLASS: Record<QueueTone, string> = {
  green: "bg-green-600",
  yellow: "bg-yellow-500",
  red: "bg-red-600",
  neutral: "bg-muted-foreground/40",
};

const META: ColumnMeta[] = [
  { key: "prevista", label: "Prevista", defaultWidth: 130 },
  { key: "mensaje", label: "Mensaje", defaultWidth: 340 },
  { key: "destino", label: "Para", defaultWidth: 180 },
  { key: "automatizacion", label: "Automatización", defaultWidth: 200 },
  { key: "numero", label: "Número", defaultWidth: 170, defaultVisible: false },
  { key: "prioridad", label: "Prioridad", defaultWidth: 110, defaultVisible: false },
  { key: "estado", label: "Estado", defaultWidth: 200 },
];

function hrefFor(tab: StatusTabKey, channelId: string | null): string {
  const p = new URLSearchParams();
  if (tab !== "pendientes") p.set("estado", tab);
  if (channelId) p.set("numero", channelId);
  const q = p.toString();
  return q ? `${ROUTE}?${q}` : ROUTE;
}

function Pill({ label, tone }: { label: string; tone: QueueTone }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ${PILL_CLASS[tone]}`}>{label}</span>;
}

function Bar({ used, limit, pct, unit }: { used: number; limit: number | null; pct: number | null; unit: string }) {
  return (
    <div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className={`h-full rounded-full ${BAR_CLASS[barTone(pct)]}`} style={{ width: `${pct ?? 0}%` }} />
      </div>
      <p className="mt-1 flex justify-between font-mono text-xs text-muted-foreground">
        <span>
          {used} / {limit ?? "sin tope"} {unit}
        </span>
        <span>{pct === null ? "—" : `${pct} %`}</span>
      </p>
    </div>
  );
}

export function QueueView({ screen, tab, channelId, viewerTimeZone }: { screen: QueueScreen; tab: StatusTabKey; channelId: string | null; viewerTimeZone: string }) {
  const prefs = useTablePrefs("send_queue", "base", META, null);
  const warning = busiestWarning(screen.cards);
  const fmt = useMemo(
    () => new Intl.DateTimeFormat("es-AR", { timeZone: viewerTimeZone, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }),
    [viewerTimeZone],
  );
  const hourFmt = useMemo(() => new Intl.DateTimeFormat("es-AR", { timeZone: viewerTimeZone, hour: "2-digit", minute: "2-digit" }), [viewerTimeZone]);
  const dayKey = useMemo(() => new Intl.DateTimeFormat("en-CA", { timeZone: viewerTimeZone, year: "numeric", month: "2-digit", day: "2-digit" }), [viewerTimeZone]);

  const columns: DataColumn<QueueRow>[] = useMemo(() => {
    // La hora sola si es de hoy; con día si es de otro.
    const when = (r: QueueRow) => {
      const d = new Date(r.status === "sent" && r.sentAt ? r.sentAt : r.scheduledFor);
      return dayKey.format(d) === dayKey.format(new Date(screen.nowMs)) ? hourFmt.format(d) : fmt.format(d);
    };
    return [
      { ...META[0], render: (r) => <span className="font-mono text-xs">{when(r)}</span> },
      { ...META[1], render: (r) => <p className="truncate text-sm">{r.preview ?? "—"}</p> },
      {
        ...META[2],
        render: (r) => <span className="truncate text-sm text-muted-foreground">{r.clientLabel ?? (r.targetKind === "number" ? "Número suelto" : "—")}</span>,
      },
      {
        ...META[3],
        render: (r) =>
          r.flowId ? (
            <Link href={`/dashboard/flows/${r.flowId}`} className="truncate text-sm hover:underline">
              {r.flowName ?? "Automatización"}
            </Link>
          ) : (
            <span className="text-sm text-muted-foreground">—</span>
          ),
      },
      { ...META[4], render: (r) => <span className="truncate text-[13px]">{r.channelName}</span> },
      { ...META[5], render: (r) => <span className="text-sm">{PRIORITY_LABELS[r.priority]}</span> },
      {
        ...META[6],
        render: (r) => {
          const s = displayStatus(r.status, r.reasonCode);
          // El motivo solo cuando explica algo que no dice la pastilla (fallido, caducado, vencido o descartado).
          const why = SHOW_REASON.has(r.status) ? (r.reason ?? (r.reasonCode ? REASON_LABELS[r.reasonCode] : null)) : null;
          return (
            <div className="min-w-0">
              <Pill label={s.label} tone={s.tone} />
              {why && (
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={why}>
                  {why}
                </p>
              )}
            </div>
          );
        },
      },
    ];
  }, [dayKey, fmt, hourFmt, screen.nowMs]);

  const timing = queueTimingText(screen.cards, screen.nowMs);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        route={ROUTE}
        tabs={
          <TopbarTabs
            label="Envíos por estado"
            active={tab}
            tabs={screen.tabs.map((t) => ({ key: t.key, label: t.label, href: hrefFor(t.key, channelId), count: t.count }))}
          />
        }
        filters={
          screen.channels.length > 1 ? (
            <LinkFilterMenu
              label="Número"
              current={channelId ?? "todos"}
              defaultKey="todos"
              options={[{ key: "todos", label: "Todos los números", href: hrefFor(tab, null) }, ...screen.channels.map((c) => ({ key: c.id, label: c.name, href: hrefFor(tab, c.id) }))]}
            />
          ) : undefined
        }
        right={
          <Link href="/dashboard/channels" className="inline-flex h-8 items-center whitespace-nowrap rounded-lg border border-border px-2.5 text-[13px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground">
            Ajustar ritmo
          </Link>
        }
      />

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 pb-20 sm:p-6">
        {warning && (
          <p role="status" className="flex items-center gap-1.5 rounded-lg border border-yellow-500/40 bg-yellow-400/15 px-3 py-2 text-xs text-yellow-900 dark:text-yellow-100">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden /> {warning}
          </p>
        )}

        {screen.cards.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center">
            <p className="text-sm font-medium">No hay ningún número de WhatsApp conectado.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Conectá uno en{" "}
              <Link href="/dashboard/channels" className="underline">
                Canales
              </Link>
              : cada número tiene su propia cola.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {screen.cards.map((c) => (
              <LaneCardView key={c.channelId} card={c} />
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{screen.totalPending}</span> en cola
            {timing ? ` · ${timing}` : ""}
          </p>
          <p className="text-xs text-muted-foreground">
            Hoy: {screen.today.sent} enviados · {screen.today.failed} fallidos · {screen.today.expired} caducados · {screen.today.overdue} vencidos ·{" "}
            {screen.today.discarded} descartados
          </p>
        </div>

        {screen.rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            {tab === "pendientes"
              ? "No hay nada esperando. Lo que respondés a quien te escribe sale al instante y no pasa por acá."
              : "No hay envíos en esta pestaña."}
          </div>
        ) : (
          <>
            <DataTable className="hidden md:block" caption="Envíos de la cola" columns={columns} rows={screen.rows} rowKey={(r) => r.id} state={prefs} />
            <ul className="space-y-2 md:hidden">
              {screen.rows.map((r) => {
                const s = displayStatus(r.status, r.reasonCode);
                return (
                  <li key={r.id} className="rounded-xl border border-border p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 flex-1 break-words text-sm">{r.preview ?? "—"}</p>
                      <Pill label={s.label} tone={s.tone} />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {fmt.format(new Date(r.status === "sent" && r.sentAt ? r.sentAt : r.scheduledFor))} · {r.clientLabel ?? "—"} · {r.flowName ?? "—"}
                    </p>
                    {r.reason && SHOW_REASON.has(r.status) && <p className="mt-1 text-xs text-muted-foreground">{r.reason}</p>}
                  </li>
                );
              })}
            </ul>
            {screen.truncated && <p className="text-xs text-muted-foreground">Se muestran los 200 primeros. Filtrá por número para ver el resto.</p>}
          </>
        )}

        <div className="grid gap-3 lg:grid-cols-2">
          <ContactCapCard cap={screen.contactCap} />
          <LaneAlertCard settings={screen.laneAlert} />
        </div>
      </div>
    </div>
  );
}

function LaneCardView({ card }: { card: LaneCard }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [warmupOpen, setWarmupOpen] = useState(false);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) setError(res.error ?? "No se pudo.");
      router.refresh();
    });

  const empty = () => {
    if (!window.confirm(`¿Vaciar la cola de ${card.name}? Los ${card.pending} envíos que esperan quedan descartados con el motivo y no se mandan.`)) return;
    run(() => emptyQueueLane(card.channelId));
  };
  const pause = () => {
    if (!window.confirm(`¿Pausar ${card.name}? No sale nada de su cola ni de sus broadcasts hasta que lo reanudes. Lo que escribe el equipo sigue saliendo.`)) return;
    run(() => pauseQueueLane(card.channelId));
  };

  return (
    <article className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4" aria-label={`Número ${card.name}`}>
      <div className="min-w-0">
        <h2 className="truncate text-sm font-semibold">{card.name}</h2>
        <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-2">
          <Pill label={card.status.label} tone={card.status.tone} />
          <span className="font-mono text-xs text-muted-foreground">{card.pending} en cola</span>
          {card.subtitle && <span className="truncate text-xs text-muted-foreground">· {card.subtitle}</span>}
        </div>
      </div>
      <Bar used={card.hour.used} limit={card.hour.limit} pct={card.hour.pct} unit="esta hora" />
      <Bar used={card.day.used} limit={card.day.limit} pct={card.day.pct} unit="hoy" />
      <p className="text-xs text-muted-foreground">
        {card.paceText} · {card.windowText}
      </p>
      <div className="mt-auto flex items-center gap-2">
        <p className="line-clamp-2 min-w-0 flex-1 text-xs text-muted-foreground" title={card.note ?? undefined}>
          {card.note ?? ""}
        </p>
        {pending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Guardando" />}
        {card.paused ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => resumeQueueLane(card.channelId))}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-accent disabled:opacity-60"
          >
            <Play className="h-3.5 w-3.5" aria-hidden /> Reanudar
          </button>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={pause}
            aria-label={`Pausar ${card.name}`}
            title="Pausar"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-60"
          >
            <Pause className="h-4 w-4" aria-hidden />
          </button>
        )}
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenu((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menu}
            aria-label={`Más acciones de ${card.name}`}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <MoreVertical className="h-4 w-4" aria-hidden />
          </button>
          {menu && (
            <div role="menu" className="absolute bottom-9 right-0 z-20 w-52 rounded-lg border border-border bg-popover p-1 shadow-lg">
              <button
                type="button"
                role="menuitem"
                disabled={pending}
                onClick={() => {
                  setMenu(false);
                  run(() => setBulkPaused(card.channelId, !card.bulkPaused));
                }}
                className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-60"
              >
                {card.bulkPaused ? "Reanudar lo masivo" : "Pausar lo masivo"}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenu(false);
                  setWarmupOpen(true);
                }}
                className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
              >
                <Flame className="h-3.5 w-3.5" aria-hidden /> Calentamiento
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={pending || card.pending === 0}
                onClick={() => {
                  setMenu(false);
                  empty();
                }}
                className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm text-red-700 hover:bg-red-600/10 disabled:opacity-50 dark:text-red-300"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden /> Vaciar cola
              </button>
            </div>
          )}
        </div>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {warmupOpen && <WarmupDialog channelId={card.channelId} name={card.name} steps={card.warmupSteps} warming={card.warming} onClose={() => setWarmupOpen(false)} />}
    </article>
  );
}
