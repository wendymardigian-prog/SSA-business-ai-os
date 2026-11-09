// @plantilla-quitar(servicios)
"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckSquare, Loader2, Square } from "lucide-react";
import {
  cancelService,
  completeService,
  completeServiceItem,
  confirmService,
  discardService,
  extendService,
  moveServiceToPhase,
  pauseService,
  resumeService,
  setServiceOwner,
  startServiceChallenge,
  uncompleteServiceItem,
} from "@/lib/actions/services";
import { ACTION_LABELS, serviceActions, serviceAlerts, type ServiceActionKey, type ServiceAlertInput } from "@/lib/services/screens/service";
import { LIGHT_LABELS, STATUS_LABELS, dayLabel, type Light, type ServiceStatus } from "@/lib/services/screens/list";
import { ActionError } from "@/components/contacts/ui";
import { ContentDialog, DialogField, fieldInput } from "@/components/content/dialog";
import { Historial } from "@/components/historial/historial";
import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";
import { LightDot } from "./services-list-view";

export interface ServiceDetailData {
  id: string;
  contactId: string;
  contactName: string;
  productName: string;
  variantName: string;
  status: ServiceStatus;
  light: Light | null;
  lightReason: string | null;
  startsOn: string | null;
  endsOn: string | null;
  progressPct: number;
  ownerId: string | null;
  origin: string;
  originReason: string | null;
  priceCents: number | null;
  saleId: string | null;
  previousServiceId: string | null;
  extensionSaleIds: string[];
  pausedDays: number;
  alerts: ServiceAlertInput;
  phases: Array<{
    id: string;
    name: string;
    status: string;
    challenge: boolean;
    awaitingStart: boolean;
    items: Array<{ id: string; name: string; kind: string; required: boolean; status: string; dueOn: string | null; taskId: string | null; needsAttention: boolean; occurrence: number | null }>;
  }>;
}

type Tab = "actividad" | "camino" | "accesos" | "datos";
const TABS: Array<{ key: Tab; label: string }> = [
  { key: "actividad", label: "Actividad" },
  { key: "camino", label: "Camino" },
  { key: "accesos", label: "Accesos" },
  { key: "datos", label: "Datos" },
];

/**
 * La ficha del servicio (F29): cabecera con el semáforo y su motivo, fase y «Día N de M», responsable editable;
 * acciones según estado y permiso; alertas con acción, en orden de gravedad; pestañas en la URL.
 */
export function ServiceDetailView({
  data,
  initialTab,
  today,
  members,
  userNames,
  timeZone,
  permissions,
  accesses,
  certificate,
  assistant,
}: {
  data: ServiceDetailData;
  /** El Asistente IA del programa (bloque IA): gasto del mes, límite y conversaciones. */
  assistant?: React.ReactNode;
  /** El certificado (bloque CE), arriba de los datos: se arma en el servidor. */
  certificate?: React.ReactNode;
  /** La pestaña Accesos (bloque AC): se arma en el servidor con lo que la persona puede ver. */
  accesses?: React.ReactNode;
  initialTab: Tab;
  today: string;
  members: Array<{ id: string; name: string }>;
  userNames: Record<string, string>;
  timeZone: string;
  permissions: string[];
}) {
  const router = useRouter();
  const can = (k: string) => permissions.includes(k);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [dialog, setDialog] = useState<ServiceActionKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const actions = serviceActions(data.status, can);
  const alerts = serviceAlerts(data.alerts);
  const light = data.light ?? "gray";

  function go(next: Tab) {
    setTab(next);
    const u = new URL(window.location.href);
    u.searchParams.set("tab", next);
    window.history.replaceState(null, "", u.toString());
  }
  function run(task: () => Promise<{ ok: boolean; error?: { message: string } }>) {
    setError(null);
    start(async () => {
      const r = await task();
      if (!r.ok) setError(r.error?.message ?? "No se pudo hacer");
      else router.refresh();
    });
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={data.contactName}
        tooltip="El servicio del cliente: su camino, su semáforo y lo que se puede hacer."
        backHref={
          <Link href="/dashboard/clientes" aria-label="Volver a Clientes" className="-ml-1 rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        }
      />
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-6 md:px-8">
          <header className="space-y-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Link href={`/dashboard/clientes/c/${data.contactId}`} className="text-lg font-semibold hover:underline">
                {data.contactName}
              </Link>
              <span className="text-sm text-muted-foreground">
                {data.productName}
                {data.variantName ? ` · ${data.variantName}` : ""}
              </span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{STATUS_LABELS[data.status]}</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span className="flex items-center gap-2">
                <LightDot light={light} label={LIGHT_LABELS[light]} />
                {data.lightReason || LIGHT_LABELS[light]}
              </span>
              <span>{data.phases.find((p) => p.status === "in_progress")?.name ?? "Sin fase en curso"}</span>
              <span>{dayLabel(data, today)}</span>
              <span>{Math.round(data.progressPct)}% de avance</span>
              <label className="flex items-center gap-1.5">
                <span className="sr-only">Responsable</span>
                <select
                  value={data.ownerId ?? ""}
                  disabled={!can("services.change_owner") || pending}
                  onChange={(e) => e.target.value && run(() => setServiceOwner(data.id, e.target.value))}
                  className="h-8 rounded-lg border border-border bg-background px-2 text-sm text-foreground"
                >
                  <option value="">Sin responsable</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {actions.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {actions
                  .filter((a) => a !== "change_owner")
                  .map((a) => (
                    <button
                      key={a}
                      type="button"
                      disabled={pending}
                      onClick={() => (a === "resume" ? run(() => resumeService(data.id, null)) : a === "confirm" ? run(() => confirmService(data.id, null, null)) : setDialog(a))}
                      className={cn("h-8 rounded-lg border border-border px-3 text-sm hover:bg-accent", a === "cancel" && "text-destructive")}
                    >
                      {ACTION_LABELS[a]}
                    </button>
                  ))}
                {pending && <Loader2 className="h-4 w-4 animate-spin self-center text-muted-foreground" aria-hidden />}
              </div>
            )}
          </header>

          {alerts.length > 0 && (
            <ul className="space-y-2" aria-label="Alertas">
              {alerts.map((a, i) => (
                <li key={`${a.kind}-${i}`} className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
                  <span className="flex-1">{a.text}</span>
                  {a.action.href ? (
                    <Link href={a.action.href} className="font-medium text-primary-ink hover:underline">
                      {a.action.label}
                    </Link>
                  ) : a.action.command === "confirm" && can("services.confirm") ? (
                    <button type="button" onClick={() => run(() => confirmService(data.id, null, null))} className="font-medium text-primary-ink hover:underline">
                      {a.action.label}
                    </button>
                  ) : a.action.command === "do_item" && a.action.itemId && can("services.items") ? (
                    <button type="button" onClick={() => run(() => completeServiceItem(a.action.itemId!, data.id))} className="font-medium text-primary-ink hover:underline">
                      {a.action.label}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {error && <ActionError message={error} />}

          <div role="tablist" aria-label="Ficha del servicio" className="flex gap-1 overflow-x-auto border-b border-border">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => go(t.key)}
                className={cn("-mb-px shrink-0 border-b-2 px-3 py-2 text-sm", tab === t.key ? "border-primary-edge font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div role="tabpanel">
            {tab === "actividad" && <Historial entityType="service" entityId={data.id} names={{ users: userNames }} timeZone={timeZone} />}
            {tab === "camino" && (
              <ol className="space-y-3">
                {data.phases.length === 0 && <p className="text-sm text-muted-foreground">Esta variante no tenía camino cuando se creó el servicio.</p>}
                {data.phases.map((ph) => (
                  <li key={ph.id} className={cn("rounded-xl border border-border p-3", ph.status === "pending" && "opacity-70")}>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold">
                        {ph.name} <span className="text-xs font-normal text-muted-foreground">· {ph.status === "in_progress" ? "En curso" : ph.status === "completed" ? "Completada" : "Pendiente"}</span>
                      </h3>
                      <div className="flex gap-2">
                        {ph.challenge && ph.awaitingStart && can("services.change_phase") && (
                          <button type="button" onClick={() => run(() => startServiceChallenge(data.id))} className="h-7 rounded-lg border border-border px-2 text-xs hover:bg-accent">
                            Empezar el Reto
                          </button>
                        )}
                        {ph.status === "pending" && can("services.change_phase") && data.status === "active" && (
                          <button type="button" onClick={() => run(() => moveServiceToPhase(data.id, ph.id, "Cambio a mano"))} className="h-7 rounded-lg border border-border px-2 text-xs hover:bg-accent">
                            Pasar a esta fase
                          </button>
                        )}
                      </div>
                    </div>
                    <ul className="space-y-1">
                      {ph.items.map((it) => {
                        const done = it.status === "completed";
                        const canToggle = can("services.items") && ph.status !== "completed";
                        return (
                          <li key={it.id} className="flex items-center gap-2 text-sm">
                            <button
                              type="button"
                              disabled={!canToggle || pending}
                              onClick={() => run(() => (done ? uncompleteServiceItem(it.id, data.id) : completeServiceItem(it.id, data.id)))}
                              aria-label={done ? `Destildar «${it.name}»` : `Tildar «${it.name}»`}
                              aria-pressed={done}
                              className="text-muted-foreground disabled:opacity-50"
                            >
                              {done ? <CheckSquare className="h-4 w-4 text-good" aria-hidden /> : <Square className="h-4 w-4" aria-hidden />}
                            </button>
                            <span className={cn("flex-1", done && "text-muted-foreground line-through")}>
                              {it.name}
                              {it.occurrence ? ` · ${it.occurrence}` : ""}
                              {!it.required && <span className="ml-1 text-xs text-muted-foreground">(opcional)</span>}
                              {it.needsAttention && <span className="ml-1 text-xs text-warn">(Requiere atención)</span>}
                            </span>
                            {it.taskId && (
                              <Link href={`/dashboard/tareas?tarea=${it.taskId}`} className="text-xs text-primary-ink hover:underline">
                                Tarea en Tareas
                              </Link>
                            )}
                            {it.dueOn && !done && <span className="text-xs text-muted-foreground">vence {it.dueOn.split("-").reverse().join("/")}</span>}
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ))}
              </ol>
            )}
            {tab === "accesos" && accesses}
            {tab === "datos" && certificate}
            {tab === "datos" && assistant}
            {tab === "datos" && (
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <Datum label="Origen" value={`${data.origin}${data.originReason ? ` · ${data.originReason}` : ""}`} />
                <Datum label="Precio congelado" value={data.priceCents != null ? `USD ${(data.priceCents / 100).toLocaleString("es-AR", { minimumFractionDigits: 2 })}` : "—"} />
                <Datum label="Venta" value={data.saleId ? <Link className="text-primary-ink hover:underline" href={`/dashboard/ventas?venta=${data.saleId}`}>Ver venta</Link> : "Sin venta"} />
                <Datum label="Servicio anterior" value={data.previousServiceId ? <Link className="text-primary-ink hover:underline" href={`/dashboard/clientes/s/${data.previousServiceId}`}>Ver</Link> : "—"} />
                <Datum label="Ventas que lo extendieron" value={data.extensionSaleIds.length ? String(data.extensionSaleIds.length) : "—"} />
                <Datum label="Días en pausa" value={String(data.pausedDays)} />
                <Datum label="Inicio" value={data.startsOn?.split("-").reverse().join("/") ?? "—"} />
                <Datum label="Fin" value={data.endsOn?.split("-").reverse().join("/") ?? "Sin fecha de fin"} />
              </dl>
            )}
          </div>
        </div>
      </div>
      {dialog && <ActionDialog action={dialog} serviceId={data.id} phases={data.phases} onClose={() => setDialog(null)} />}
    </div>
  );
}

function Datum({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5">{value}</dd>
    </div>
  );
}

function ActionDialog({ action, serviceId, phases, onClose }: { action: ServiceActionKey; serviceId: string; phases: ServiceDetailData["phases"]; onClose: () => void }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [n, setN] = useState("7");
  const [unit, setUnit] = useState<"days" | "months">("days");
  const [cutAccess, setCutAccess] = useState(true);
  const [resumeOn, setResumeOn] = useState("");
  const [phaseId, setPhaseId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    setError(null);
    start(async () => {
      let r: { ok: boolean; error?: { message: string } };
      switch (action) {
        case "pause":
          r = await pauseService(serviceId, { reason, cutAccess, resumeOn: resumeOn || null });
          break;
        case "extend":
          r = await extendService(serviceId, { mode: "period", n: Number(n), unit, kind: "bonus", reason });
          break;
        case "complete":
          r = await completeService(serviceId, reason);
          break;
        case "cancel":
          r = await cancelService(serviceId, reason);
          break;
        case "discard":
          r = await discardService(serviceId, reason);
          break;
        case "change_phase":
          r = await moveServiceToPhase(serviceId, phaseId, reason);
          break;
        default:
          r = { ok: true };
      }
      if (!r.ok) return setError(r.error?.message ?? "No se pudo hacer");
      onClose();
      router.refresh();
    });
  }

  return (
    <ContentDialog
      title={ACTION_LABELS[action]}
      label={ACTION_LABELS[action]}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="h-9 rounded-lg border border-border px-3 text-sm hover:bg-accent">
            Volver
          </button>
          <button
            type="button"
            disabled={pending || !reason.trim() || (action === "change_phase" && !phaseId)}
            onClick={submit}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
            {ACTION_LABELS[action].replace("…", "")}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {action === "extend" && (
          <div className="grid grid-cols-2 gap-2">
            <DialogField label="Cuánto">
              <input inputMode="numeric" value={n} onChange={(e) => setN(e.target.value)} className={fieldInput} />
            </DialogField>
            <DialogField label="Unidad">
              <select value={unit} onChange={(e) => setUnit(e.target.value as typeof unit)} className={fieldInput}>
                <option value="days">días</option>
                <option value="months">meses</option>
              </select>
            </DialogField>
          </div>
        )}
        {action === "pause" && (
          <>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={cutAccess} onChange={(e) => setCutAccess(e.target.checked)} />
              Pausar también el acceso al portal
            </label>
            <DialogField label="Reanudar sola el (opcional)">
              <input type="date" value={resumeOn} onChange={(e) => setResumeOn(e.target.value)} className={fieldInput} />
            </DialogField>
          </>
        )}
        {action === "change_phase" && (
          <DialogField label="A qué fase">
            <select value={phaseId} onChange={(e) => setPhaseId(e.target.value)} className={fieldInput}>
              <option value="">Elegí…</option>
              {phases.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </DialogField>
        )}
        <DialogField label="Motivo" hint="Queda en el historial del servicio.">
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className={fieldInput} />
        </DialogField>
        {error && <ActionError message={error} />}
      </div>
    </ContentDialog>
  );
}
