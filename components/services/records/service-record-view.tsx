// @plantilla-quitar(servicios)
"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, CheckSquare, ChevronDown, ChevronLeft, ChevronRight, Loader2, Lock, MoreHorizontal, Paperclip, Square } from "lucide-react";
import { completeServiceItem, confirmService, resumeService, setServiceDates, setServiceOwner, startServiceChallenge, uncompleteServiceItem } from "@/lib/actions/services";
import { serviceActions, type ServiceActionKey } from "@/lib/services/screens/service";
import { LIGHT_LABELS, STATUS_LABELS, type Light, type ServiceStatus } from "@/lib/services/screens/list";
import { withRecord, type ServiceRecordTab } from "@/lib/services/screens/record-url";
import type { AssistantCreditsView, AttendanceRateView, ClassroomProgressView, LessonState, NextPaymentView } from "@/lib/services/screens/record-figures";
import type { LightSignal, RecordAlert, RecordTone } from "@/lib/services/screens/service-record";
import { DATES_PLAN_MESSAGES, datesEditPlan, durationFromDates, endFromDuration, type DatesPlanError } from "@/lib/services/set-dates";
import { reviewRowView } from "@/lib/program/review";
import type { ReviewItem } from "@/lib/program/load-review";
import { ActionError } from "@/components/contacts/ui";
import { Historial } from "@/components/historial/historial";
import { PortalMenu, PortalMenuItem } from "@/components/ui/portal-menu";
import { ReviewDrawer } from "@/components/services/portal/review-list";
import { LightDot } from "@/components/services/clients/services-list-view";
import { cn } from "@/lib/utils";
import { rememberRecordOpener } from "./record-modal";
import { ServiceActionDialog } from "./service-action-dialog";
import { SidePanel } from "@/components/tasks/overlay";
import { EvidenceBox } from "@/components/services/evidence-box";
import type { EvidenceEntry, EvidenceRule } from "@/lib/services/evidence";

export interface ServiceRecordStep {
  id: string;
  phaseId: string;
  name: string;
  kind: string;
  required: boolean;
  status: string;
  dueOn: string | null;
  taskId: string | null;
  needsAttention: boolean;
  occurrence: number | null;
  /** A4 (F146): «Desde el 13/11» o «Después de: …», y el texto de por qué no se puede tildar. */
  lock: { label: string; message: string } | null;
  /** A4 (F147). */
  evidenceRule: EvidenceRule | null;
  evidence: EvidenceEntry[];
  evidenceMissing: boolean;
}

export interface ServiceRecordData {
  id: string;
  /** Quien mira (A4: quitar la evidencia propia). */
  viewerId: string | null;
  /** A4 (F151): «Supera su tope (N de M)» por persona, para asignar a mano (no frena). */
  capacityNotes: Record<string, string>;
  contactId: string;
  contactName: string;
  productName: string;
  variantName: string;
  status: ServiceStatus;
  light: Light | null;
  lightReason: string | null;
  lightAt: string | null;
  startsOn: string | null;
  endsOn: string | null;
  progressPct: number;
  ownerId: string | null;
  hasPortal: boolean;
  sale: { id: string; amountCents: number; paid: number; total: number } | null;
  elapsed: { day: number; total: number | null } | null;
  payment: NextPaymentView | null;
  attendance: AttendanceRateView | null;
  classroom: ClassroomProgressView | null;
  assistant: AssistantCreditsView | null;
  assistantInfo: { conversations: number; lastAt: string | null } | null;
  alerts: RecordAlert[];
  signals: LightSignal[];
  overdue: Array<{ id: string; name: string; dueOn: string }>;
  phases: Array<{ id: string; name: string; status: string; durationDays: number | null; startedAt: string | null; completedAt: string | null; challenge: boolean; awaitingStart: boolean; items: ServiceRecordStep[] }>;
  reviews: ReviewItem[];
}

// ── Formatos (las fechas del servicio son civiles: se leen en UTC) ─────────
const civil = new Intl.DateTimeFormat("es", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });
const civilShort = new Intl.DateTimeFormat("es", { timeZone: "UTC", day: "numeric", month: "short" });
const fmtDate = (d: string | null) => (d ? civil.format(new Date(`${d}T12:00:00Z`)) : "—");
const fmtShort = (d: string | null) => (d ? civilShort.format(new Date(`${d}T12:00:00Z`)) : "—");
const usd = (cents: number) => `US$${(cents / 100).toLocaleString("es-AR", { maximumFractionDigits: cents % 100 ? 2 : 0 })}`;

const TONE_TEXT: Record<RecordTone, string> = { good: "text-good", warn: "text-warn", bad: "text-bad", neutral: "text-muted-foreground" };
const TONE_DOT: Record<RecordTone, string> = { good: "bg-good", warn: "bg-warn", bad: "bg-bad", neutral: "bg-muted-foreground/40" };
const LIGHT_BAND: Record<string, string> = { red: "border-bad/50 bg-bad/5", yellow: "border-warn/50 bg-warn/5", green: "border-good/40 bg-good/5", gray: "border-border bg-muted/30" };

function useRecordNav() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return {
    open: (record: { kind: "service"; id: string; tab?: ServiceRecordTab } | { kind: "client"; id: string }) => router.push(withRecord(pathname, params?.toString() ?? "", record), { scroll: false }),
    href: (record: { kind: "service"; id: string; tab?: ServiceRecordTab } | { kind: "client"; id: string }) => withRecord(pathname, params?.toString() ?? "", record),
  };
}

function MiniBar({ pct, tone = "neutral" }: { pct: number; tone?: RecordTone }) {
  return (
    <span className="mt-1 block h-1.5 w-full max-w-24 overflow-hidden rounded-full bg-muted" aria-hidden>
      <span className={cn("block h-full rounded-full", tone === "bad" ? "bg-bad" : tone === "warn" ? "bg-warn" : "bg-primary")} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </span>
  );
}

function Figure({ label, children, bar }: { label: string; children: ReactNode; bar?: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
      {bar}
    </div>
  );
}

// ── Cabecera ────────────────────────────────────────────────────────────────
export function ServiceRecordHeader({ data, today, members, permissions }: { data: ServiceRecordData; today: string; members: Array<{ id: string; name: string }>; permissions: string[] }) {
  const router = useRouter();
  const nav = useRecordNav();
  const can = (k: string) => permissions.includes(k);
  const [dialog, setDialog] = useState<ServiceActionKey | null>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const actions = serviceActions(data.status, can);
  const main = actions.filter((a) => a === "pause" || a === "resume" || a === "extend" || a === "confirm" || a === "discard");
  const canDates = can("services.extend") && !["completed", "cancelled"].includes(data.status);
  const more: Array<{ key: string; label: string; onSelect: () => void; danger?: boolean }> = [
    ...(canDates ? [{ key: "dates", label: "Editar fechas y plazo", onSelect: () => setEditing(true) }] : []),
    ...(actions.includes("complete") ? [{ key: "complete", label: "Completar el servicio", onSelect: () => setDialog("complete") }] : []),
    ...(actions.includes("cancel") ? [{ key: "cancel", label: "Cancelar el servicio", onSelect: () => setDialog("cancel"), danger: true }] : []),
  ];

  function run(task: () => Promise<{ ok: boolean; error?: { message: string } }>) {
    setError(null);
    start(async () => {
      const r = await task();
      if (!r.ok) setError(r.error?.message ?? "No se pudo hacer");
      else router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2 pr-12">
        <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
          <Link href={nav.href({ kind: "client", id: data.contactId })} scroll={false} className="inline-flex items-center gap-0.5 text-xs font-medium text-primary-ink hover:underline">
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
            {data.contactName}
          </Link>
          <h2 className="truncate text-lg font-semibold">
            {data.productName}
            {data.variantName && <span className="font-normal text-muted-foreground"> · {data.variantName}</span>}
          </h2>
          <p className="text-xs text-muted-foreground">
            <span className="mr-2 rounded-full bg-muted px-2 py-0.5 text-foreground">{STATUS_LABELS[data.status]}</span>
            {data.sale ? (
              <Link href={`/dashboard/ventas/${data.sale.id}`} className="hover:underline">
                Venta · {usd(data.sale.amountCents)}
                {data.sale.total > 1 ? ` · ${data.sale.paid} de ${data.sale.total} cuotas` : ""}
              </Link>
            ) : (
              "Sin venta"
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {main.map((a) => (
            <button
              key={a}
              type="button"
              disabled={pending}
              onClick={() => (a === "resume" ? run(() => resumeService(data.id, null)) : a === "confirm" ? run(() => confirmService(data.id, null, null)) : setDialog(a))}
              className="inline-flex h-10 items-center rounded-lg border border-border px-3 text-sm hover:bg-accent md:h-8"
            >
              {a === "pause" ? "Pausar" : a === "resume" ? "Reanudar" : a === "extend" ? "Extender" : a === "confirm" ? "Confirmar" : "Descartar"}
            </button>
          ))}
          {more.length > 0 && (
            <PortalMenu label="Más acciones del servicio" align="end" width={240} triggerClassName="h-10 gap-1 rounded-lg border border-border px-3 text-sm hover:bg-accent md:h-8" trigger={<><MoreHorizontal className="h-4 w-4" aria-hidden /> Más…</>}>
              {more.map((m) => (
                <PortalMenuItem key={m.key} onSelect={m.onSelect} className={m.danger ? "text-destructive" : undefined}>
                  {m.label}
                </PortalMenuItem>
              ))}
            </PortalMenu>
          )}
          {pending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />}
        </div>
      </div>

      {editing ? (
        <DatesEditor data={data} onDone={() => setEditing(false)} />
      ) : (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-5">
          <Figure label="Inicio">{fmtDate(data.startsOn)}</Figure>
          <Figure label="Lleva">
            {data.elapsed ? (
              <>
                <span className="font-semibold">{data.elapsed.day} {data.elapsed.day === 1 ? "día" : "días"}</span>
                {data.elapsed.total ? <span className="text-muted-foreground"> de {data.elapsed.total}</span> : null}
              </>
            ) : (
              "—"
            )}
          </Figure>
          <Figure label="Plazo contratado">{durationFromDates(data.startsOn, data.endsOn) ? `${durationFromDates(data.startsOn, data.endsOn)} ${durationFromDates(data.startsOn, data.endsOn) === 1 ? "día" : "días"}` : "Sin fin"}</Figure>
          <Figure label="Fin">{data.endsOn ? fmtDate(data.endsOn) : "Sin fin"}</Figure>
          <Figure label="Responsable">
            {can("services.change_owner") && data.status !== "cancelled" ? (
              <label className="block">
                <span className="sr-only">Responsable</span>
                <select
                  value={data.ownerId ?? ""}
                  disabled={pending}
                  onChange={(e) => e.target.value && run(() => setServiceOwner(data.id, e.target.value))}
                  className="h-10 w-full max-w-[200px] rounded-lg border border-border bg-background px-2 text-sm md:h-8"
                >
                  {!data.ownerId && <option value="">Sin responsable</option>}
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                      {m.id !== data.ownerId && data.capacityNotes[m.id] ? ` · ${data.capacityNotes[m.id]}` : ""}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              members.find((m) => m.id === data.ownerId)?.name ?? "Sin responsable"
            )}
          </Figure>
        </dl>
      )}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border pt-2 sm:grid-cols-4" aria-label="Cifras del servicio">
        <Figure label="Avance" bar={<MiniBar pct={data.progressPct} />}>
          <span className="font-semibold">{Math.round(data.progressPct)} %</span>
        </Figure>
        {data.attendance && (
          <Figure label="Asistencia" bar={<MiniBar pct={data.attendance.pct} tone={data.attendance.pct < 50 ? "warn" : "neutral"} />}>
            <span className="font-semibold">{data.attendance.pct} %</span>
            <span className="text-muted-foreground"> {data.attendance.attended} de {data.attendance.total}</span>
          </Figure>
        )}
        {data.assistant && (
          <Figure label="Asistente IA" bar={<MiniBar pct={data.assistant.pct} tone={data.assistant.reached ? "bad" : "neutral"} />}>
            <span className="font-semibold">{data.assistant.pct} %</span>
            <span className="text-muted-foreground"> del mes</span>
          </Figure>
        )}
        {data.payment && (
          <Figure label={data.payment.kind === "overdue" ? "Pago" : data.payment.kind === "paid" ? "Pago" : "Próximo pago"}>
            {data.payment.kind === "paid" ? (
              <span className="font-semibold text-good">Pagado</span>
            ) : data.payment.kind === "overdue" ? (
              <span className="font-semibold text-bad">Vencido hace {data.payment.daysLate} {data.payment.daysLate === 1 ? "día" : "días"}</span>
            ) : (
              <>
                <span className="font-semibold">{fmtShort(data.payment.dueOn)}</span>
                <span className="text-muted-foreground">
                  {" "}
                  · cuota {data.payment.index} de {data.payment.total} · {usd(data.payment.amountCents)}
                </span>
              </>
            )}
          </Figure>
        )}
      </dl>
      {error && <ActionError message={error} />}
      {dialog && <ServiceActionDialog action={dialog} serviceId={data.id} phases={data.phases} onClose={() => setDialog(null)} />}
      <span className="sr-only">{today}</span>
    </div>
  );
}

/** «Más… › Editar fechas y plazo»: inicio, plazo y fin pasan a campos, con el motivo. Al tocar el plazo se mueve el fin. */
function DatesEditor({ data, onDone }: { data: ServiceRecordData; onDone: () => void }) {
  const router = useRouter();
  const [startsOn, setStartsOn] = useState(data.startsOn ?? "");
  const [endsOn, setEndsOn] = useState(data.endsOn ?? "");
  const [duration, setDuration] = useState(String(durationFromDates(data.startsOn, data.endsOn) ?? ""));
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function onStart(v: string) {
    setStartsOn(v);
    const n = Number(duration);
    const end = Number.isInteger(n) && n > 0 ? endFromDuration(v, n) : null;
    if (end) setEndsOn(end);
  }
  function onDuration(v: string) {
    setDuration(v);
    const end = endFromDuration(startsOn, Number(v));
    if (end) setEndsOn(end);
  }
  function onEnd(v: string) {
    setEndsOn(v);
    const d = durationFromDates(startsOn, v);
    setDuration(d ? String(d) : "");
  }
  function save() {
    const plan = datesEditPlan({ status: data.status, oldStartsOn: data.startsOn, oldEndsOn: data.endsOn, startsOn: startsOn || null, endsOn: endsOn || null, reason });
    if (!plan.ok) return setError(DATES_PLAN_MESSAGES[plan.error as DatesPlanError]);
    setError(null);
    start(async () => {
      const r = await setServiceDates(data.id, { startsOn, endsOn: endsOn || null, reason });
      if (!r.ok) return setError(r.error.message);
      onDone();
      router.refresh();
    });
  }

  const field = "h-10 w-full rounded-lg border border-border bg-background px-2 text-sm md:h-9";
  return (
    <div className="grid gap-2 rounded-xl border border-primary-edge/60 bg-primary/5 p-3 sm:grid-cols-[repeat(3,minmax(0,150px))_minmax(0,1fr)_auto]" role="group" aria-label="Editar fechas y plazo">
      <label className="text-xs text-muted-foreground">
        Inicio
        <input type="date" value={startsOn} onChange={(e) => onStart(e.target.value)} className={field} />
      </label>
      <label className="text-xs text-muted-foreground">
        Plazo contratado (días)
        <input inputMode="numeric" value={duration} onChange={(e) => onDuration(e.target.value.replace(/\D/g, ""))} className={field} />
      </label>
      <label className="text-xs text-muted-foreground">
        Fin
        <input type="date" value={endsOn} onChange={(e) => onEnd(e.target.value)} className={field} />
      </label>
      <label className="text-xs text-muted-foreground">
        Motivo
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Queda en la actividad" className={field} maxLength={500} />
      </label>
      <div className="flex items-end gap-2">
        <button type="button" disabled={pending} onClick={save} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50 md:h-9">
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
          Guardar
        </button>
        <button type="button" onClick={onDone} className="h-10 rounded-lg border border-border px-3 text-sm hover:bg-accent md:h-9">
          Cancelar
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive sm:col-span-5">
          {error}
        </p>
      )}
      <p className="text-xs text-muted-foreground sm:col-span-5">Al guardar se recalculan los plazos de los pasos y el semáforo.</p>
    </div>
  );
}

// ── Cuerpo: columna principal y columna derecha ────────────────────────────
export function ServiceRecordView({
  data,
  tab,
  today,
  timeZone,
  userNames,
  permissions,
  accesses,
  certificate,
  assistantCard,
  meetings,
}: {
  data: ServiceRecordData;
  tab: ServiceRecordTab;
  today: string;
  timeZone: string;
  userNames: Record<string, string>;
  permissions: string[];
  accesses: ReactNode;
  certificate: ReactNode;
  assistantCard: ReactNode;
  /** Servicios A4 (F137): el bloque Reuniones. */
  meetings?: ReactNode;
}) {
  const router = useRouter();
  const can = (k: string) => permissions.includes(k);
  const [panel, setPanel] = useState<ServiceRecordTab>(tab);
  const [reviewing, setReviewing] = useState<ReviewItem | null>(null);
  const [openAccesses, setOpenAccesses] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const light = (data.light ?? "gray") as Light;
  const pendingReviews = data.reviews.filter((r) => r.reviewStatus === null || r.reviewStatus === "pending");

  function run(task: () => Promise<{ ok: boolean; error?: { message: string } }>) {
    setError(null);
    start(async () => {
      const r = await task();
      if (!r.ok) setError(r.error?.message ?? "No se pudo hacer");
      else router.refresh();
    });
  }
  function onAlert(a: RecordAlert) {
    if (!a.action) return;
    if (a.action.command === "review" && pendingReviews[0]) setReviewing(pendingReviews[0]);
    else if (a.action.command === "accesses") {
      setOpenAccesses(true);
      requestAnimationFrame(() => document.getElementById("record-accesos")?.scrollIntoView({ block: "start", behavior: "smooth" }));
    } else if (a.action.command === "confirm") run(() => confirmService(data.id, null, null));
    else if (a.action.command === "do_item" && a.action.itemId) run(() => completeServiceItem(a.action!.itemId!, data.id));
  }

  return (
    <div className="grid min-h-0 gap-4 p-4 md:p-6 min-[1000px]:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0 space-y-4">
        {data.alerts.length > 0 && (
          <ul className="space-y-2" aria-label="Alertas">
            {data.alerts.map((a, i) => (
              <li key={`${a.kind}-${i}`} className={cn("flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 text-sm", a.tone === "bad" ? "border-bad/40 bg-bad/5" : a.tone === "warn" ? "border-warn/40 bg-warn/5" : "border-border bg-muted/40")}>
                <span className={cn("h-2 w-2 shrink-0 rounded-full", TONE_DOT[a.tone])} aria-hidden />
                <span className="min-w-0 flex-1">{a.text}</span>
                {a.action?.href ? (
                  <Link href={a.action.href} className="inline-flex min-h-10 items-center font-medium text-primary-ink hover:underline md:min-h-0">
                    {a.action.label}
                  </Link>
                ) : a.action ? (
                  <button type="button" onClick={() => onAlert(a)} className="inline-flex min-h-10 items-center rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90 md:min-h-8">
                    {a.action.label}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {error && <ActionError message={error} />}

        <section aria-label="Semáforo" className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-3 py-2.5", LIGHT_BAND[light])}>
          <span className="flex items-center gap-2 text-sm font-semibold">
            <LightDot light={light} label={LIGHT_LABELS[light]} />
            {LIGHT_LABELS[light]}
          </span>
          <span className="min-w-0 flex-1 text-sm">
            {data.lightReason || "Sin señales"}
            {data.lightAt && <span className="text-xs text-muted-foreground"> · desde {new Intl.DateTimeFormat("es", { timeZone, day: "numeric", month: "short" }).format(new Date(data.lightAt))}</span>}
          </span>
          <ul className="flex flex-wrap gap-1.5" aria-label="Señales">
            {data.signals.map((s) => (
              <li key={s.key} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2 py-0.5 text-xs">
                <span className={cn("h-1.5 w-1.5 rounded-full", TONE_DOT[s.tone])} aria-hidden />
                {s.label}
              </li>
            ))}
          </ul>
        </section>

        {data.hasPortal && (
          <div className="grid gap-4 md:grid-cols-2">
            <section aria-labelledby="record-entregas" className="space-y-2 rounded-xl border border-border p-3">
              <h3 id="record-entregas" className="flex items-center gap-2 text-sm font-semibold">
                Entregas
                {pendingReviews.length > 0 && <span className="rounded-full bg-warn/15 px-2 py-0.5 text-xs font-medium text-warn">{pendingReviews.length} por revisar</span>}
              </h3>
              {data.reviews.length === 0 ? (
                <p className="text-sm text-muted-foreground">Todavía no entregó actividades.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {[...pendingReviews, ...data.reviews.filter((r) => !pendingReviews.includes(r)).slice(0, 4)].map((r) => {
                    const v = reviewRowView(r);
                    const isPending = pendingReviews.includes(r);
                    return (
                      <li key={r.id} className="flex items-center gap-2 py-2 text-sm">
                        <span className={cn("h-2 w-2 shrink-0 rounded-full", isPending ? "bg-warn" : "bg-good")} aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{r.formName}</span>
                          <span className="block text-xs text-muted-foreground">{fmtShort(r.createdAt.slice(0, 10))}</span>
                        </span>
                        {isPending && can("submissions.review") ? (
                          <button type="button" onClick={() => setReviewing(r)} className="inline-flex min-h-10 items-center rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground md:min-h-8">
                            Revisar
                          </button>
                        ) : (
                          <span className="text-xs text-muted-foreground">{v.stateLabel}</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
            <AttendanceBlock attendance={data.attendance} />
          </div>
        )}

        {data.hasPortal && data.assistantInfo && (
          <section aria-label="Asistente IA" className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-border p-3 text-sm">
            <h3 className="font-semibold">Asistente IA</h3>
            {data.assistant && (
              <span>
                <span className="text-xs text-muted-foreground">Créditos usados </span>
                {data.assistant.used.toLocaleString("es")} de {data.assistant.total.toLocaleString("es")}
              </span>
            )}
            <span>
              <span className="text-xs text-muted-foreground">Conversaciones </span>
              {data.assistantInfo.conversations}
            </span>
            {data.assistantInfo.lastAt && (
              <span>
                <span className="text-xs text-muted-foreground">Última </span>
                {new Intl.DateTimeFormat("es", { timeZone, day: "numeric", month: "short" }).format(new Date(data.assistantInfo.lastAt))}
              </span>
            )}
          </section>
        )}

        {data.hasPortal && <ClassroomBlock classroom={data.classroom} />}

        {certificate}

        {meetings}

        {data.hasPortal && accesses && (
          <Collapsible id="record-accesos" title="Accesos al portal" hint="Qué tiene abierto y hasta cuándo" open={openAccesses} onToggle={setOpenAccesses}>
            {accesses}
          </Collapsible>
        )}
        {assistantCard && (
          <Collapsible id="record-limite" title="Límite del asistente IA" hint="El general del programa o uno propio">
            {assistantCard}
          </Collapsible>
        )}
      </div>

      <aside className="min-w-0 space-y-3 min-[1000px]:sticky min-[1000px]:top-0 min-[1000px]:self-start" aria-label="Camino y actividad">
        <div role="tablist" aria-label="Columna del servicio" className="flex rounded-lg bg-muted/60 p-0.5">
          {(["camino", "actividad"] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={panel === k}
              onClick={() => setPanel(k)}
              className={cn("h-10 flex-1 rounded-md text-sm md:h-8", panel === k ? "bg-background font-medium shadow-sm" : "text-muted-foreground")}
            >
              {k === "camino" ? "Camino del cliente" : "Actividad"}
            </button>
          ))}
        </div>
        {panel === "camino" ? (
          <JourneyColumn data={data} today={today} can={can} pending={pending} run={run} />
        ) : (
          <Historial key={data.id} entityType="service" entityId={data.id} names={{ users: userNames }} timeZone={timeZone} />
        )}
      </aside>

      {reviewing && (
        <ReviewDrawer
          item={reviewing}
          canReview={can("submissions.review")}
          onClose={() => setReviewing(null)}
          onDone={() => {
            setReviewing(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function Collapsible({ id, title, hint, children, open: controlled, onToggle }: { id: string; title: string; hint?: string; children: ReactNode; open?: boolean; onToggle?: (v: boolean) => void }) {
  const [own, setOwn] = useState(false);
  const open = controlled ?? own;
  const toggle = () => (onToggle ? onToggle(!open) : setOwn(!open));
  return (
    <section id={id} className="rounded-xl border border-border">
      <h3>
        <button type="button" aria-expanded={open} onClick={toggle} className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-sm">
          <span className="font-semibold">{title}</span>
          {hint && <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{hint}</span>}
          <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden />
        </button>
      </h3>
      {open && <div className="border-t border-border p-3">{children}</div>}
    </section>
  );
}

function AttendanceBlock({ attendance }: { attendance: AttendanceRateView | null }) {
  return (
    <section aria-labelledby="record-asistencia" className="space-y-2 rounded-xl border border-border p-3">
      <h3 id="record-asistencia" className="text-sm font-semibold">
        Asistencia a clases
        {attendance && (
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {attendance.attended} de {attendance.total} · {attendance.pct} %
          </span>
        )}
      </h3>
      {!attendance ? (
        <p className="text-sm text-muted-foreground">Todavía no pasó ninguna clase en vivo desde que empezó.</p>
      ) : (
        <ul className="divide-y divide-border">
          {attendance.recent.map((o) => (
            <li key={`${o.live_session_id}-${o.occurs_on}`} className="flex items-center gap-2 py-2 text-sm">
              <span className={cn("h-2 w-2 shrink-0 rounded-full", o.attended ? "bg-good" : "bg-bad")} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate">
                  {fmtShort(o.occurs_on)} · {o.title}
                </span>
                <span className="block text-xs text-muted-foreground">{o.attended ? (o.source === "team" ? "La marcó el equipo" : o.source === "click" ? "Entró por el link" : "Marcó que estuvo") : "No asistió"}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">«Marcar asistió» se hace desde Portal › programa › Calendario.</p>
    </section>
  );
}

const LESSON_LABEL: Record<LessonState["kind"], string> = {
  approved: "Aprobada",
  submitted: "Entregada",
  to_fix: "A corregir",
  viewed: "Vista",
  not_submitted: "Sin entregar",
  not_viewed: "Sin ver",
  locked: "Bloqueada",
};

function ClassroomBlock({ classroom }: { classroom: ClassroomProgressView | null }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const all = useMemo(() => classroom?.modules.map((m) => m.id) ?? [], [classroom]);
  return (
    <section aria-labelledby="record-classroom" className="rounded-xl border border-border">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
        <h3 id="record-classroom" className="text-sm font-semibold">
          Avance en el classroom
        </h3>
        {classroom && (
          <span className="text-xs text-muted-foreground">
            {classroom.modules.length} {classroom.modules.length === 1 ? "módulo" : "módulos"} · {classroom.lessonsViewed} {classroom.lessonsViewed === 1 ? "clase vista" : "clases vistas"} · {classroom.tasksDone} de {classroom.tasksTotal} actividades
          </span>
        )}
        {classroom && (
          <span className="ml-auto flex gap-1">
            <button type="button" onClick={() => setOpen(new Set(all))} className="min-h-10 rounded-md px-2 text-xs text-primary-ink hover:underline md:min-h-0">
              Abrir todos
            </button>
            <button type="button" onClick={() => setOpen(new Set())} className="min-h-10 rounded-md px-2 text-xs text-primary-ink hover:underline md:min-h-0">
              Cerrar todos
            </button>
          </span>
        )}
      </div>
      {!classroom ? (
        <p className="border-t border-border px-3 py-3 text-sm text-muted-foreground">
          El programa todavía no tiene contenido. Se arma en <Link href="/dashboard/portal" className="text-primary-ink hover:underline">Portal › programa</Link>.
        </p>
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {classroom.modules.map((m, i) => {
            const isOpen = open.has(m.id);
            return (
              <li key={m.id}>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setOpen((prev) => {
                    const next = new Set(prev);
                    if (next.has(m.id)) next.delete(m.id);
                    else next.add(m.id);
                    return next;
                  })}
                  className={cn("flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-sm", m.locked && "text-muted-foreground")}
                >
                  <ChevronRight className={cn("h-4 w-4 shrink-0 transition-transform", isOpen && "rotate-90")} aria-hidden />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">
                      {i + 1}. {m.title}
                    </span>
                    {m.locked && m.opensText && <span className="text-xs"> · {m.opensText.charAt(0).toLowerCase() + m.opensText.slice(1)}</span>}
                  </span>
                  <span className="hidden w-28 sm:block">
                    <MiniBar pct={m.pct} />
                  </span>
                  <span className="w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                    {m.done} de {m.total}
                  </span>
                </button>
                {isOpen && (
                  <ul className="space-y-1 pb-2 pl-9 pr-3">
                    {m.lessons.length === 0 && <li className="text-xs text-muted-foreground">Sin clases todavía.</li>}
                    {m.lessons.map((l) => (
                      <li key={l.id} className="flex items-center gap-2 text-sm">
                        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", l.done ? "bg-good" : l.state.kind === "to_fix" ? "bg-warn" : "bg-muted-foreground/40")} aria-hidden />
                        <span className={cn("min-w-0 flex-1 truncate", !l.done && "text-muted-foreground")}>{l.title}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {LESSON_LABEL[l.state.kind]}
                          {"on" in l.state ? ` · ${fmtShort(l.state.on)}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function JourneyColumn({
  data,
  today,
  can,
  pending,
  run,
}: {
  data: ServiceRecordData;
  today: string;
  can: (k: string) => boolean;
  pending: boolean;
  run: (task: () => Promise<{ ok: boolean; error?: { message: string } }>) => void;
}) {
  const current = data.phases.find((p) => p.status === "in_progress")?.id ?? null;
  const [open, setOpen] = useState<Set<string>>(new Set(current ? [current] : []));
  const [changing, setChanging] = useState(false);
  const [panel, setPanel] = useState<string | null>(null);
  const panelItem = panel ? data.phases.flatMap((p) => p.items).find((i) => i.id === panel) ?? null : null;
  if (data.phases.length === 0) return <p className="text-sm text-muted-foreground">Esta variante no tenía camino cuando se creó el servicio.</p>;
  return (
    <div className="space-y-2">
      {data.overdue.map((o) => (
        <p key={o.id} className="flex items-start gap-2 rounded-lg border border-warn/40 bg-warn/5 px-3 py-2 text-xs">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" aria-hidden />
          <span>
            Paso vencido: {o.name} (venció el {fmtShort(o.dueOn)})
          </span>
        </p>
      ))}
      <ol className="space-y-2">
        {data.phases.map((ph, i) => {
          const isOpen = open.has(ph.id);
          const done = ph.items.filter((it) => it.status === "completed").length;
          const days = ph.startedAt ? Math.max(0, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(ph.startedAt.slice(0, 10) + "T00:00:00Z")) / 86_400_000)) : null;
          return (
            <li key={ph.id} className={cn("rounded-xl border", ph.status === "in_progress" ? "border-primary-edge" : "border-border", ph.status === "pending" && "opacity-80")}>
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() =>
                  setOpen((prev) => {
                    const next = new Set(prev);
                    if (next.has(ph.id)) next.delete(ph.id);
                    else next.add(ph.id);
                    return next;
                  })
                }
                className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left"
              >
                <span className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs", ph.status === "completed" ? "bg-good/15 text-good" : ph.status === "in_progress" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
                  {ph.status === "completed" ? "✓" : i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{ph.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {ph.status === "completed" ? "Completada" : ph.status === "in_progress" ? `Lleva ${days ?? 0} de ${ph.durationDays ?? "—"} días` : "Pendiente"} · {done} de {ph.items.length}
                  </span>
                </span>
                <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-180")} aria-hidden />
              </button>
              {isOpen && (
                <div className="space-y-1 border-t border-border px-3 py-2">
                  {ph.challenge && ph.awaitingStart && can("services.change_phase") && (
                    <button type="button" disabled={pending} onClick={() => run(() => startServiceChallenge(data.id))} className="mb-1 h-10 rounded-lg border border-border px-2 text-xs hover:bg-accent md:h-8">
                      Empezar el Reto
                    </button>
                  )}
                  <ul className="space-y-1">
                    {ph.items.map((it) => {
                      const isDone = it.status === "completed";
                      const late = !isDone && it.dueOn !== null && it.dueOn < today;
                      const canToggle = can("services.items") && ph.status !== "completed";
                      return (
                        <li key={it.id} className="flex items-center gap-2 text-sm">
                          <span className="min-w-0 flex-1">
                            <button type="button" onClick={() => setPanel(it.id)} className={cn("block max-w-full truncate text-left hover:underline", isDone && "text-muted-foreground line-through")}>
                              {it.lock && <Lock className="mr-1 inline h-3.5 w-3.5 align-[-2px] text-muted-foreground" aria-label="Bloqueado" />}
                              {it.name}
                              {it.occurrence ? ` · ${it.occurrence}` : ""}
                              {!it.required && <span className="ml-1 text-xs text-muted-foreground">(opcional)</span>}
                            </button>
                            <span className={cn("block text-xs", late ? "text-bad" : "text-muted-foreground")}>
                              {isDone ? "Completado" : late ? `Vencido · ${fmtShort(it.dueOn)}` : it.dueOn ? `Vence ${fmtShort(it.dueOn)}` : "Sin plazo"}
                              {it.needsAttention && <span className="ml-1 text-warn">· Requiere atención</span>}
                              {it.lock && <span className="ml-1">· {it.lock.label}</span>}
                              {it.evidence.length > 0 && (
                                <span className="ml-1 inline-flex items-center gap-0.5">
                                  · <Paperclip className="h-3 w-3" aria-hidden /> {it.evidence.length}
                                </span>
                              )}
                              {it.evidenceMissing && <span className="ml-1 text-warn">· Falta la evidencia</span>}
                              {it.taskId && (
                                <>
                                  {" · "}
                                  <Link href={`/dashboard/tareas?task=${it.taskId}`} className="text-primary-ink hover:underline">
                                    Tarea
                                  </Link>
                                </>
                              )}
                            </span>
                          </span>
                          <button
                            type="button"
                            disabled={!canToggle || pending || (!isDone && it.lock !== null)}
                            title={!isDone && it.lock ? it.lock.message : undefined}
                            onClick={() => {
                              // A4: sin la evidencia que pide, el tilde abre el paso para adjuntarla.
                              if (!isDone && it.evidenceMissing) return setPanel(it.id);
                              run(() => (isDone ? uncompleteServiceItem(it.id, data.id) : completeServiceItem(it.id, data.id)));
                            }}
                            aria-label={isDone ? `Destildar «${it.name}»` : `Tildar «${it.name}»`}
                            aria-pressed={isDone}
                            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent disabled:opacity-40 md:h-8 md:w-8"
                          >
                            {isDone ? <CheckSquare className="h-4 w-4 text-good" aria-hidden /> : <Square className="h-4 w-4" aria-hidden />}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {can("services.change_phase") && data.status === "active" && (
        <button type="button" onClick={(e) => { rememberRecordOpener(e.currentTarget); setChanging(true); }} className="h-10 w-full rounded-lg border border-dashed border-border text-sm text-muted-foreground hover:bg-accent md:h-9">
          Cambiar de fase a mano…
        </button>
      )}
      {changing && <ServiceActionDialog action="change_phase" serviceId={data.id} phases={data.phases} onClose={() => setChanging(false)} />}
      {panelItem && <ItemPanel item={panelItem} viewerId={data.viewerId} can={can} onClose={() => setPanel(null)} />}
    </div>
  );
}

/** El paso abierto en la ficha (A4): estado, candado, evidencia y su tarea. */
function ItemPanel({ item, viewerId, can, onClose }: { item: ServiceRecordStep; viewerId: string | null; can: (k: string) => boolean; onClose: () => void }) {
  const isDone = item.status === "completed";
  return (
    <SidePanel label={`Paso «${item.name}»`} onClose={onClose} header={<p className="truncate text-sm font-semibold">{item.name}</p>}>
      <div className="space-y-4 p-4 text-sm">
        <p className="text-muted-foreground">
          {isDone ? "Completado" : item.dueOn ? `Vence ${fmtShort(item.dueOn)}` : "Sin plazo"}
          {item.taskId && (
            <>
              {" · "}
              <Link href={`/dashboard/tareas?task=${item.taskId}`} className="text-primary-ink hover:underline">
                Ver la tarea
              </Link>
            </>
          )}
        </p>
        {item.lock && !isDone && (
          <p className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            {item.lock.message}
          </p>
        )}
        <EvidenceBox
          itemId={item.id}
          entries={item.evidence}
          rule={item.evidenceRule}
          itemStatus={item.status}
          viewerId={viewerId}
          canAdd={can("services.items")}
          missing={item.evidenceMissing}
        />
      </div>
    </SidePanel>
  );
}
