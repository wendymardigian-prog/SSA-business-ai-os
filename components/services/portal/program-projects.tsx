"use client";
// @plantilla-quitar(proyectos)

import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { saveProgramSettings } from "@/lib/actions/services";
import { requestPaymentReceipt, saveProjectIdea, saveWorkbench, verifyStudentPayment, type IdeaInput } from "@/lib/actions/projects";
import { fameSettingsProblems } from "@/lib/projects/settings";
import { formatCents, parseAmountToCents } from "@/lib/projects/money";
import { PAYMENTS_TABLE_KEY, PAYMENT_COLUMN_METAS, PROJECTS_TABLE_KEY, PROJECT_COLUMN_METAS } from "@/lib/projects/columns";
import { ColumnsMenu } from "@/components/ui/data-table/columns-menu";
import { DataTable, type DataColumn } from "@/components/ui/data-table/data-table";
import { useTablePrefs } from "@/components/ui/data-table/use-table-prefs";
import { serviceHref } from "@/lib/services/screens/record-url";

export interface PaymentRow {
  id: string;
  contact_id: string;
  name: string;
  kind: "payment" | "adjustment";
  title: string;
  amount_cents: number;
  received_on: string;
  before_program: boolean;
  project_title: string | null;
  state: "verified" | "pending" | "no_receipt";
  has_receipt: boolean;
  receipt_requested_at: string | null;
  entered_by_kind: "student" | "team";
  adjust_reason: string | null;
  service_id: string | null;
}
export interface ProjectRow {
  id: string;
  name: string;
  kind: "real" | "practice" | "challenge";
  title: string;
  status: string | null;
  client: string | null;
  sold_cents: number | null;
  paid_cents: number;
  steps_done: number;
  updated_at: string;
}
export interface FameRow {
  contact_id: string;
  name: string;
  amount_cents: number;
  projects_won: number;
  show_amount: boolean;
}
export interface IdeaRow {
  id: string;
  product_id: string | null;
  industry: string | null;
  title: string;
  description: string | null;
  size: "small" | "medium" | "large";
  active: boolean;
}
interface Step {
  key: string;
  name: string;
  description?: string;
  depends_on?: string[];
  prompt?: { text: string; version: number } | null;
  analysis?: { text: string; version: number } | null;
  tasks?: string[];
}
interface Range {
  size: "small" | "medium" | "large";
  min_cents: number;
  max_cents: number;
}
export interface FameSettings {
  counts?: "paid" | "sold";
  verified_only?: boolean;
  include_before_program?: boolean;
  milestones?: number[];
  first_project_milestone?: boolean;
}

const VIEWS = [
  { key: "pagos", label: "Pagos reportados" },
  { key: "proyectos", label: "Proyectos" },
  { key: "fama", label: "Sala de la fama" },
  { key: "mesa", label: "Mesa de trabajo" },
  { key: "ideas", label: "Ideas" },
] as const;
export type ProjectsView = (typeof VIEWS)[number]["key"];

const STATE_LABEL = { verified: "Verificado", pending: "Por verificar", no_receipt: "Sin comprobante" } as const;
const STATE_CLASS = {
  verified: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  pending: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  no_receipt: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
} as const;
const KIND_LABEL = { real: "Real", practice: "Práctica", challenge: "Reto" } as const;
const STATUS_LABEL: Record<string, string> = { draft: "Borrador", proposal_sent: "Propuesta enviada", won: "Ganado", in_build: "En construcción", delivered: "Entregado", lost: "Perdido" };
const SIZE_LABEL = { small: "Chico", medium: "Mediano", large: "Grande" } as const;
const card = "rounded-xl border border-border bg-card";
const field = "w-full rounded-md border border-border bg-background px-2 py-1 text-sm disabled:opacity-60";
const btn = "rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted disabled:opacity-50";
const pri = "rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50";

/**
 * Portal › programa › Proyectos y facturación (Corrida C, F80, F118, F120). Se ve solo con la extensión de proyectos
 * prendida. Cada vista pide su permiso; la base lo vuelve a pedir (`projects_admin_*`, 00396).
 */
export function ProgramProjects(props: {
  productId: string;
  view: ProjectsView;
  filter: "all" | "unverified" | "no_receipt";
  period: "all" | "month";
  payments: { counts: { unverified: number; no_receipt: number }; rows: PaymentRow[] } | null;
  projects: ProjectRow[] | null;
  fame: FameRow[] | null;
  fameSettings: FameSettings;
  ideas: IdeaRow[] | null;
  workbench: { steps: Step[]; budget_ranges: Range[] };
  rev: number;
  can: { manageRevenue: boolean; fame: boolean; templates: boolean };
}) {
  const base = `/dashboard/portal/${props.productId}?tab=proyectos`;
  const views = VIEWS.filter((v) => (v.key === "mesa" || v.key === "ideas" ? props.can.templates : true));
  return (
    <div className="space-y-4">
      <nav aria-label="Vistas de Proyectos y facturación" className="flex flex-wrap gap-1">
        {views.map((v) => (
          <Link
            key={v.key}
            href={`${base}&vista=${v.key}`}
            aria-current={props.view === v.key ? "page" : undefined}
            className={`rounded-full px-3 py-1 text-sm ${props.view === v.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
          >
            {v.label}
            {v.key === "pagos" && props.payments && props.payments.counts.no_receipt + props.payments.counts.unverified > 0 ? (
              <span className="ml-1.5 rounded-full bg-amber-500/20 px-1.5 text-xs tabular-nums">{props.payments.counts.no_receipt + props.payments.counts.unverified}</span>
            ) : null}
          </Link>
        ))}
      </nav>
      {props.view === "pagos" ? <Payments {...props} base={base} /> : null}
      {props.view === "proyectos" ? <Projects rows={props.projects} /> : null}
      {props.view === "fama" ? <Fame {...props} base={base} /> : null}
      {props.view === "mesa" ? <Workbench productId={props.productId} initial={props.workbench} rev={props.rev} canEdit={props.can.templates} /> : null}
      {props.view === "ideas" ? <Ideas productId={props.productId} rows={props.ideas ?? []} canEdit={props.can.templates} /> : null}
    </div>
  );
}

function Msg({ msg }: { msg: { kind: "ok" | "error"; text: string } | null }) {
  if (!msg) return null;
  return (
    <p role={msg.kind === "error" ? "alert" : "status"} className={`text-sm ${msg.kind === "error" ? "text-destructive" : "text-emerald-700 dark:text-emerald-300"}`}>
      {msg.text}
    </p>
  );
}

// ─── Pagos reportados ─────────────────────────────────────────────────────────
function Payments({ payments, filter, can, base }: { payments: { counts: { unverified: number; no_receipt: number }; rows: PaymentRow[] } | null; filter: "all" | "unverified" | "no_receipt"; can: { manageRevenue: boolean }; base: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const prefs = useTablePrefs(PAYMENTS_TABLE_KEY, "base", PAYMENT_COLUMN_METAS, null);
  if (!payments) return <p className="text-sm text-muted-foreground">No pudimos cargar los pagos.</p>;
  const filters = [
    { key: "all", label: "Todos" },
    { key: "unverified", label: `Sin verificar (${payments.counts.unverified})` },
    { key: "no_receipt", label: `Sin comprobante (${payments.counts.no_receipt})` },
  ] as const;
  const total = payments.rows.reduce((s, r) => s + r.amount_cents, 0);
  const run = (f: () => Promise<{ ok: boolean; error?: { message: string } }>, ok: string) =>
    start(async () => {
      setMsg(null);
      const r = await f();
      if (!r.ok) return setMsg({ kind: "error", text: r.error?.message ?? "No se pudo" });
      setMsg({ kind: "ok", text: ok });
      router.refresh();
    });
  const csv = () => {
    const head = ["Fecha", "Estudiante", "Título", "Proyecto", "Monto", "Estado", "Cargó"];
    const lines = payments.rows.map((r) => [r.received_on, r.name, r.title, r.project_title ?? "", (r.amount_cents / 100).toFixed(2), STATE_LABEL[r.state], r.entered_by_kind === "team" ? "Equipo" : "Estudiante"]);
    const text = [head, ...lines].map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
    a.download = "pagos-reportados.csv";
    a.click();
  };
  const render: Record<string, (r: PaymentRow) => ReactNode> = {
    date: (r) => <span className="tabular-nums">{r.received_on}</span>,
    student: (r) => (r.service_id ? <Link href={serviceHref(r.service_id)} className="hover:underline">{r.name}</Link> : r.name),
    payment: (r) => (
      <div>
        <div>{r.title}</div>
        <div className="text-xs text-muted-foreground">{[r.project_title, r.before_program ? "Antes del programa" : null, r.entered_by_kind === "team" ? "Lo cargó el equipo" : null, r.adjust_reason].filter(Boolean).join(" · ")}</div>
      </div>
    ),
    amount: (r) => <span className="tabular-nums">{formatCents(r.amount_cents)}</span>,
    state: (r) => (
      <div>
        <span className={`rounded-full px-2 py-0.5 text-xs ${STATE_CLASS[r.state]}`}>{STATE_LABEL[r.state]}</span>
        {r.receipt_requested_at ? <div className="mt-1 text-xs text-muted-foreground">Comprobante pedido</div> : null}
      </div>
    ),
    actions: (r) =>
      can.manageRevenue && r.kind === "payment" ? (
        <span className="inline-flex gap-1">
          {r.state === "no_receipt" ? (
            <button type="button" className={btn} disabled={pending} onClick={() => run(async () => { const res = await requestPaymentReceipt(r.id); return res.ok ? { ok: true } : { ok: false, error: res.error }; }, "Listo: le pedimos el comprobante.")}>
              Pedir comprobante
            </button>
          ) : null}
          <button type="button" className={btn} disabled={pending} onClick={() => run(() => verifyStudentPayment(r.id, r.state !== "verified"), r.state === "verified" ? "Le quitamos la verificación." : "Pago verificado.")}>
            {r.state === "verified" ? "Quitar verificación" : "Verificar"}
          </button>
        </span>
      ) : null,
  };
  const paymentColumns: DataColumn<PaymentRow>[] = PAYMENT_COLUMN_METAS.map((m) => ({ ...m, align: m.key === "amount" ? ("right" as const) : undefined, render: render[m.key] }));
  return (
    <section aria-label="Pagos reportados" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {filters.map((f) => (
          <Link key={f.key} href={`${base}&vista=pagos&filtro=${f.key}`} aria-current={filter === f.key ? "page" : undefined} className={`${btn} ${filter === f.key ? "bg-muted font-medium" : ""}`}>
            {f.label}
          </Link>
        ))}
        <span className="ml-auto" />
        <ColumnsMenu state={prefs} />
        <button type="button" className={btn} onClick={csv} disabled={!payments.rows.length}>
          Exportar
        </button>
      </div>
      <Msg msg={msg} />
      {payments.rows.length === 0 ? (
        <p className={`${card} p-6 text-center text-sm text-muted-foreground`}>{filter === "all" ? "Todavía no hay pagos reportados." : "No hay pagos con este filtro."}</p>
      ) : (
        <DataTable columns={paymentColumns} rows={payments.rows} rowKey={(r) => r.id} state={prefs} caption="Pagos reportados" totals={{ amount: formatCents(total) }} />
      )}
      <p className="text-xs text-muted-foreground">Sin comprobante, el pago queda sin verificar y no cuenta en la Sala de la fama si el programa cuenta solo verificados. Cargar un pago o ajustar el total se hace desde la ficha del servicio.</p>
    </section>
  );
}

// ─── Proyectos ───────────────────────────────────────────────────────────────
function Projects({ rows }: { rows: ProjectRow[] | null }) {
  const prefs = useTablePrefs(PROJECTS_TABLE_KEY, "base", PROJECT_COLUMN_METAS, null);
  if (!rows) return <p className="text-sm text-muted-foreground">No pudimos cargar los proyectos.</p>;
  if (!rows.length) return <p className={`${card} p-6 text-center text-sm text-muted-foreground`}>Todavía nadie cargó un proyecto.</p>;
  const render: Record<string, (p: ProjectRow) => ReactNode> = {
    project: (p) => (
      <div>
        <div>{p.title}</div>
        {p.client ? <div className="text-xs text-muted-foreground">{p.client}</div> : null}
      </div>
    ),
    student: (p) => p.name,
    kind: (p) => `${KIND_LABEL[p.kind]}${p.status ? ` · ${STATUS_LABEL[p.status] ?? p.status}` : ""}`,
    sold: (p) => <span className="tabular-nums">{p.sold_cents !== null ? formatCents(p.sold_cents) : "—"}</span>,
    paid: (p) => <span className="tabular-nums">{p.kind === "practice" ? "—" : formatCents(p.paid_cents)}</span>,
    steps: (p) => <span className="tabular-nums">{p.steps_done}</span>,
  };
  const columns: DataColumn<ProjectRow>[] = PROJECT_COLUMN_METAS.map((m) => ({ ...m, align: ["sold", "paid", "steps"].includes(m.key) ? ("right" as const) : undefined, render: render[m.key] }));
  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <ColumnsMenu state={prefs} />
      </div>
      <DataTable columns={columns} rows={rows} rowKey={(p) => p.id} state={prefs} caption="Proyectos del programa" />
    </div>
  );
}

// ─── Sala de la fama ─────────────────────────────────────────────────────────
function Fame({ productId, fame, fameSettings, rev: initialRev, period, can, base }: { productId: string; fame: FameRow[] | null; fameSettings: FameSettings; rev: number; period: "all" | "month"; can: { fame: boolean }; base: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [rev, setRev] = useState(initialRev);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [s, setS] = useState({
    counts: fameSettings.counts ?? "paid",
    verified_only: fameSettings.verified_only ?? true,
    include_before_program: fameSettings.include_before_program ?? false,
    first_project_milestone: fameSettings.first_project_milestone ?? true,
    milestones: (fameSettings.milestones ?? []).map((m) => String(m / 100)).join(", "),
  });
  const save = () => {
    setMsg(null);
    const milestones = s.milestones.split(",").map((x) => x.trim()).filter(Boolean).map(parseAmountToCents);
    if (milestones.some((m) => !Number.isFinite(m))) return setMsg({ kind: "error", text: "Los hitos son montos separados por coma" });
    const next: FameSettings = { counts: s.counts, verified_only: s.verified_only, include_before_program: s.include_before_program, first_project_milestone: s.first_project_milestone, milestones };
    const problems = fameSettingsProblems(next);
    if (problems.length) return setMsg({ kind: "error", text: problems.join(". ") });
    start(async () => {
      const res = await saveProgramSettings(productId, { fame: next }, rev);
      if (!res.ok) return setMsg({ kind: "error", text: res.error.message });
      const d = res.data as { status: string; rev?: number; problems?: string[] };
      if (d.status === "ok") {
        setRev(d.rev ?? rev + 1);
        setMsg({ kind: "ok", text: "Guardado." });
        router.refresh();
      } else setMsg({ kind: "error", text: d.status === "conflict" ? "Alguien cambió el programa mientras editabas. Recargá la página." : (d.problems ?? []).join(". ") });
    });
  };
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <section aria-label="Ranking" className="space-y-3">
        <div className="flex gap-1">
          {(["all", "month"] as const).map((p) => (
            <Link key={p} href={`${base}&vista=fama&periodo=${p}`} aria-current={period === p ? "page" : undefined} className={`${btn} ${period === p ? "bg-muted font-medium" : ""}`}>
              {p === "all" ? "Histórico" : "Este mes"}
            </Link>
          ))}
        </div>
        {!fame || !fame.length ? (
          <p className={`${card} p-6 text-center text-sm text-muted-foreground`}>Todavía no hay nadie en la Sala de la fama.</p>
        ) : (
          <ol className={`${card} divide-y divide-border`}>
            {fame.map((f, i) => (
              <li key={f.contact_id} className="flex items-center gap-3 px-4 py-2 text-sm">
                <span className="w-6 tabular-nums text-muted-foreground">{i + 1}</span>
                <span className="flex-1">{f.name}</span>
                <span className="text-xs text-muted-foreground">{f.projects_won ? `${f.projects_won} proyecto${f.projects_won === 1 ? "" : "s"}` : ""}</span>
                <span className="tabular-nums">{formatCents(f.amount_cents)}</span>
                {!f.show_amount ? <span className="text-xs text-muted-foreground" title="El estudiante eligió no mostrar el monto en el portal">oculto en el portal</span> : null}
              </li>
            ))}
          </ol>
        )}
        <p className="text-xs text-muted-foreground">Los servicios de prueba no cuentan. Cada estudiante elige en el portal si se ve su monto.</p>
      </section>
      <section aria-labelledby="fame-cfg" className={`${card} space-y-3 p-4`}>
        <h2 id="fame-cfg" className="text-sm font-semibold">
          Qué cuenta
        </h2>
        <fieldset disabled={!can.fame || pending} className="space-y-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" name="counts" checked={s.counts === "paid"} onChange={() => setS({ ...s, counts: "paid" })} />
            Lo cobrado (la suma de los pagos)
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="counts" checked={s.counts === "sold"} onChange={() => setS({ ...s, counts: "sold" })} />
            Lo vendido (proyectos desde Ganado)
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={s.verified_only} onChange={(e) => setS({ ...s, verified_only: e.target.checked })} />
            Solo pagos verificados
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={s.include_before_program} onChange={(e) => setS({ ...s, include_before_program: e.target.checked })} />
            Sumar lo de antes del programa
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={s.first_project_milestone} onChange={(e) => setS({ ...s, first_project_milestone: e.target.checked })} />
            Festejar el primer proyecto
          </label>
          <label className="block">
            <span className="text-xs text-muted-foreground">Hitos (montos separados por coma)</span>
            <input className={field} value={s.milestones} placeholder="1000, 5000, 10000" onChange={(e) => setS({ ...s, milestones: e.target.value })} />
          </label>
        </fieldset>
        {can.fame ? (
          <button type="button" className={pri} disabled={pending} onClick={save}>
            Guardar
          </button>
        ) : null}
        <Msg msg={msg} />
      </section>
    </div>
  );
}

// ─── Mesa de trabajo ─────────────────────────────────────────────────────────
function Workbench({ productId, initial, rev: initialRev, canEdit }: { productId: string; initial: { steps: Step[]; budget_ranges: Range[] }; rev: number; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [rev, setRev] = useState(initialRev);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [steps, setSteps] = useState<Step[]>(initial.steps);
  // Las claves guardadas no cambian: los proyectos de los estudiantes guardan lo suyo con esa clave.
  const savedKeys = new Set(initial.steps.map((s) => s.key));
  const [open, setOpen] = useState<number | null>(initial.steps.length ? 0 : null);
  const rangeText = (size: Range["size"]) => {
    const r = initial.budget_ranges.find((x) => x.size === size);
    return { min: r ? String(r.min_cents / 100) : "", max: r ? String(r.max_cents / 100) : "" };
  };
  const [ranges, setRanges] = useState({ small: rangeText("small"), medium: rangeText("medium"), large: rangeText("large") });
  const disabled = !canEdit || pending;
  const upd = (i: number, patch: Partial<Step>) => setSteps((ss) => ss.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, d: -1 | 1) =>
    setSteps((ss) => {
      const j = i + d;
      if (j < 0 || j >= ss.length) return ss;
      const n = [...ss];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
  const add = () => {
    let k = steps.length + 1;
    while (steps.some((s) => s.key === `paso_${k}`)) k++;
    setSteps((ss) => [...ss, { key: `paso_${k}`, name: "Paso nuevo", depends_on: [], prompt: { text: "", version: 1 }, tasks: [] }]);
    setOpen(steps.length);
  };
  const save = () => {
    setMsg(null);
    const budget_ranges: Range[] = [];
    for (const size of ["small", "medium", "large"] as const) {
      const r = ranges[size];
      if (!r.min.trim() && !r.max.trim()) continue;
      const min_cents = parseAmountToCents(r.min);
      const max_cents = parseAmountToCents(r.max);
      if (!Number.isFinite(min_cents) || !Number.isFinite(max_cents)) return setMsg({ kind: "error", text: `Completá el mínimo y el máximo del rango ${SIZE_LABEL[size].toLowerCase()}` });
      budget_ranges.push({ size, min_cents, max_cents });
    }
    start(async () => {
      const res = await saveWorkbench(productId, { steps, budget_ranges }, rev);
      if (!res.ok) return setMsg({ kind: "error", text: res.error.message });
      const d = res.data;
      if (d.status === "ok") {
        setRev(d.rev);
        setSteps(((d.current as { steps?: Step[] }).steps ?? steps) as Step[]);
        setMsg({ kind: "ok", text: "Guardado. Las instrucciones que cambiaste quedaron con una versión nueva." });
        router.refresh();
      } else if (d.status === "conflict") setMsg({ kind: "error", text: "Alguien guardó la Mesa de trabajo mientras editabas. Recargá la página." });
      else setMsg({ kind: "error", text: d.problems.join(". ") });
    });
  };
  return (
    <div className="max-w-4xl space-y-6">
      <section aria-labelledby="wb-steps" className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 id="wb-steps" className="text-sm font-semibold">
            Los pasos del método
          </h2>
          {canEdit ? (
            <button type="button" className={btn} disabled={pending} onClick={add}>
              + Paso
            </button>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          Las claves proyecto, brief1, guion, llamada, brief2, invest, propuesta, diseno, roadmap y constr activan su pantalla propia en el portal (datos del
          proyecto, campos, transcripción, links, roadmap y construcción). Cada paso arma un prompt con sus instrucciones, los datos del proyecto y los documentos de los pasos que usa. El estudiante lo usa en su IA y pega el
          resultado. Variables: {"{{proyecto}}"}, {"{{brief_inicial}}"}, {"{{transcripcion}}"}, {"{{rango_presupuesto}}"}, {"{{montos}}"}, {"{{parte}}"}, {"{{modo}}"}.
        </p>
        {!steps.length ? <p className={`${card} p-6 text-center text-sm text-muted-foreground`}>Todavía no hay pasos. Sumá el primero.</p> : null}
        <ol className="space-y-2">
          {steps.map((s, i) => (
            <li key={i} className={card}>
              <div className="flex items-center gap-2 px-4 py-2">
                <span className="w-6 text-xs tabular-nums text-muted-foreground">{i}</span>
                <button type="button" className="flex-1 text-left text-sm font-medium" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}>
                  {s.name || "Sin nombre"}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {[s.prompt ? `prompt v${s.prompt.version}` : null, s.analysis ? `análisis v${s.analysis.version}` : null].filter(Boolean).join(" · ")}
                  </span>
                </button>
                {canEdit ? (
                  <span className="flex gap-1">
                    <button type="button" className={btn} aria-label={`Subir ${s.name}`} disabled={disabled || i === 0} onClick={() => move(i, -1)}>
                      ↑
                    </button>
                    <button type="button" className={btn} aria-label={`Bajar ${s.name}`} disabled={disabled || i === steps.length - 1} onClick={() => move(i, 1)}>
                      ↓
                    </button>
                    <button type="button" className={btn} disabled={disabled} onClick={() => confirm(`¿Sacar el paso «${s.name}»?`) && setSteps((ss) => ss.filter((_, j) => j !== i))}>
                      Sacar
                    </button>
                  </span>
                ) : null}
              </div>
              {open === i ? (
                <fieldset disabled={disabled} className="space-y-3 border-t border-border px-4 py-3">
                  <div className="grid gap-3 sm:grid-cols-[1fr_200px]">
                    <label className="block text-sm">
                      <span className="text-xs text-muted-foreground">Nombre</span>
                      <input className={field} maxLength={80} value={s.name} onChange={(e) => upd(i, { name: e.target.value })} />
                    </label>
                    <label className="block text-sm">
                      <span className="text-xs text-muted-foreground">{savedKeys.has(s.key) ? "Clave (no cambia)" : "Clave (solo antes de guardar)"}</span>
                      <input
                        className={field}
                        value={s.key}
                        readOnly={savedKeys.has(s.key)}
                        maxLength={40}
                        onChange={(e) => {
                          const k = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "");
                          if (k && !steps.some((x, j) => j !== i && x.key === k)) upd(i, { key: k });
                        }}
                      />
                    </label>
                  </div>
                  <label className="block text-sm">
                    <span className="text-xs text-muted-foreground">Qué es (dos líneas para el estudiante)</span>
                    <textarea className={field} rows={2} maxLength={400} value={s.description ?? ""} onChange={(e) => upd(i, { description: e.target.value })} />
                  </label>
                  {i > 0 ? (
                    <div className="text-sm">
                      <span className="text-xs text-muted-foreground">Usa los documentos de</span>
                      <div className="mt-1 flex flex-wrap gap-3">
                        {steps.slice(0, i).map((p) => (
                          <label key={p.key} className="flex items-center gap-1.5">
                            <input
                              type="checkbox"
                              checked={(s.depends_on ?? []).includes(p.key)}
                              onChange={(e) => upd(i, { depends_on: e.target.checked ? [...(s.depends_on ?? []), p.key] : (s.depends_on ?? []).filter((x) => x !== p.key) })}
                            />
                            {p.name}
                          </label>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <label className="block text-sm">
                    <span className="text-xs text-muted-foreground">Instrucciones del prompt {s.prompt ? `(versión ${s.prompt.version})` : ""}</span>
                    <textarea className={`${field} font-mono text-xs`} rows={8} value={s.prompt?.text ?? ""} onChange={(e) => upd(i, { prompt: { text: e.target.value, version: s.prompt?.version ?? 1 } })} />
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={!!s.analysis} onChange={(e) => upd(i, { analysis: e.target.checked ? { text: "", version: 1 } : null })} />
                    Con análisis con IA
                  </label>
                  {s.analysis ? (
                    <label className="block text-sm">
                      <span className="text-xs text-muted-foreground">Instrucciones del análisis (versión {s.analysis.version})</span>
                      <textarea className={`${field} font-mono text-xs`} rows={6} value={s.analysis.text} onChange={(e) => upd(i, { analysis: { text: e.target.value, version: s.analysis?.version ?? 1 } })} />
                    </label>
                  ) : null}
                  <label className="block text-sm">
                    <span className="text-xs text-muted-foreground">Tareas típicas (una por línea)</span>
                    <textarea className={field} rows={3} value={(s.tasks ?? []).join("\n")} onChange={(e) => upd(i, { tasks: e.target.value.split("\n").map((t) => t.trim()).filter(Boolean).slice(0, 20) })} />
                  </label>
                </fieldset>
              ) : null}
            </li>
          ))}
        </ol>
      </section>
      <section aria-labelledby="wb-ranges" className="space-y-2">
        <h2 id="wb-ranges" className="text-sm font-semibold">
          Presupuesto por tamaño de proyecto
        </h2>
        <p className="text-xs text-muted-foreground">La IA sugiere el tamaño según el brief y el estudiante lo ajusta. Vacío = ese tamaño no se ofrece.</p>
        <ul className={`${card} divide-y divide-border`}>
          {(["small", "medium", "large"] as const).map((size) => (
            <li key={size} className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm">
              <span className="w-20">{SIZE_LABEL[size]}</span>
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                desde
                <input inputMode="decimal" className={`${field} w-28 text-right`} disabled={disabled} value={ranges[size].min} onChange={(e) => setRanges((r) => ({ ...r, [size]: { ...r[size], min: e.target.value } }))} />
              </label>
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                hasta
                <input inputMode="decimal" className={`${field} w-28 text-right`} disabled={disabled} value={ranges[size].max} onChange={(e) => setRanges((r) => ({ ...r, [size]: { ...r[size], max: e.target.value } }))} />
              </label>
            </li>
          ))}
        </ul>
      </section>
      {canEdit ? (
        <button type="button" className={pri} disabled={pending} onClick={save}>
          Guardar la Mesa de trabajo
        </button>
      ) : null}
      <Msg msg={msg} />
    </div>
  );
}

// ─── Ideas ───────────────────────────────────────────────────────────────────
function Ideas({ productId, rows, canEdit }: { productId: string; rows: IdeaRow[]; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const empty: IdeaInput = { title: "", description: "", industry: "", size: "medium", active: true, all_programs: false };
  const [form, setForm] = useState<IdeaInput>(empty);
  const [editing, setEditing] = useState<string | null>(null);
  const submit = (id: string | null, input: IdeaInput, done: string) =>
    start(async () => {
      setMsg(null);
      const res = await saveProjectIdea(productId, id, input);
      if (!res.ok) return setMsg({ kind: "error", text: res.error.message });
      setMsg({ kind: "ok", text: done });
      setForm(empty);
      setEditing(null);
      router.refresh();
    });
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <section aria-label="Banco de ideas" className="space-y-2">
        <p className="text-xs text-muted-foreground">El sorteador de Mis proyectos saca una idea activa del rubro y el tamaño que elige el estudiante para un proyecto de práctica.</p>
        {!rows.length ? (
          <p className={`${card} p-6 text-center text-sm text-muted-foreground`}>Todavía no hay ideas.</p>
        ) : (
          <ul className={`${card} divide-y divide-border`}>
            {rows.map((r) => (
              <li key={r.id} className={`flex items-start gap-3 px-4 py-2 text-sm ${r.active ? "" : "opacity-60"}`}>
                <div className="flex-1">
                  <div className="font-medium">{r.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {[r.industry, SIZE_LABEL[r.size], r.product_id ? null : "Todos los programas", r.active ? null : "Inactiva"].filter(Boolean).join(" · ")}
                  </div>
                  {r.description ? <p className="mt-1 text-xs text-muted-foreground">{r.description}</p> : null}
                </div>
                {canEdit ? (
                  <span className="flex gap-1">
                    <button type="button" className={btn} disabled={pending} onClick={() => { setEditing(r.id); setForm({ title: r.title, description: r.description ?? "", industry: r.industry ?? "", size: r.size, active: r.active }); }}>
                      Editar
                    </button>
                    <button type="button" className={btn} disabled={pending} onClick={() => submit(r.id, { title: r.title, description: r.description ?? "", industry: r.industry ?? "", size: r.size, active: !r.active }, r.active ? "Idea desactivada." : "Idea activada.")}>
                      {r.active ? "Desactivar" : "Activar"}
                    </button>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
      {canEdit ? (
        <section aria-labelledby="idea-form" className={`${card} space-y-2 p-4`}>
          <h2 id="idea-form" className="text-sm font-semibold">
            {editing ? "Editar la idea" : "Nueva idea"}
          </h2>
          <fieldset disabled={pending} className="space-y-2 text-sm">
            <input className={field} placeholder="La idea (ej. CRM para una veterinaria)" maxLength={200} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <input className={field} placeholder="Rubro (opcional)" maxLength={80} value={form.industry ?? ""} onChange={(e) => setForm({ ...form, industry: e.target.value })} />
            <textarea className={field} rows={3} placeholder="Descripción (opcional)" maxLength={4000} value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <select className={field} value={form.size} onChange={(e) => setForm({ ...form, size: e.target.value as IdeaInput["size"] })}>
              {(["small", "medium", "large"] as const).map((s) => (
                <option key={s} value={s}>
                  {SIZE_LABEL[s]}
                </option>
              ))}
            </select>
            {!editing ? (
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.all_programs === true} onChange={(e) => setForm({ ...form, all_programs: e.target.checked })} />
                Para todos los programas
              </label>
            ) : null}
          </fieldset>
          <div className="flex gap-2">
            <button type="button" className={pri} disabled={pending || !form.title.trim()} onClick={() => submit(editing, form, editing ? "Idea guardada." : "Idea sumada.")}>
              {editing ? "Guardar" : "Sumar idea"}
            </button>
            {editing ? (
              <button type="button" className={btn} onClick={() => { setEditing(null); setForm(empty); }}>
                Cancelar
              </button>
            ) : null}
          </div>
          <Msg msg={msg} />
        </section>
      ) : null}
    </div>
  );
}
