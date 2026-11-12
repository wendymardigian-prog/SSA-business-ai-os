// @plantilla-quitar(servicios)
/**
 * Las cifras de la cabecera y los bloques de la ficha del servicio (Servicios A2, F130.3). Puro: la pantalla las
 * compone. Regla de todo el modulo: si un dato no existe, la cifra no sale (`null`); nunca un cero inventado.
 */

// ── Pago ────────────────────────────────────────────────────────────────────
export interface FigurePayment {
  status: string;
  type: string | null;
  amount: number | string | null;
  due_date: string | null;
}

export type NextPaymentView =
  | { kind: "paid"; label: "Pagado" }
  | { kind: "next"; dueOn: string; amountCents: number; index: number; total: number }
  | { kind: "overdue"; dueOn: string; daysLate: number; amountCents: number; index: number; total: number };

const cents = (v: unknown) => Math.round((Number(v) || 0) * 100);
const dayDiff = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/**
 * El pago de la cabecera, de las cuotas de la venta (y de sus extensiones): «Pagado», «Próximo pago» con la fecha, la
 * cuota y el monto, o «Pago vencido hace N días». Sin cuotas (o sin venta) no hay cifra. Los reembolsos y las
 * canceladas no cuentan como cuota.
 */
export function nextPaymentView(payments: readonly FigurePayment[] | null | undefined, today: string): NextPaymentView | null {
  if (!payments || payments.length === 0) return null;
  const plan = payments
    .filter((p) => p.type !== "refund" && cents(p.amount) > 0 && !["cancelled", "refunded"].includes(p.status))
    .sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"));
  if (plan.length === 0) return null;
  const open = plan.filter((p) => p.status === "scheduled" || p.status === "overdue");
  if (open.length === 0) return plan.every((p) => p.status === "paid") ? { kind: "paid", label: "Pagado" } : null;
  const first = open.find((p) => p.due_date) ?? open[0];
  const index = plan.indexOf(first) + 1;
  if (!first.due_date) return null;
  const late = dayDiff(first.due_date, today);
  if (first.status === "overdue" || late > 0) return { kind: "overdue", dueOn: first.due_date, daysLate: Math.max(1, late), amountCents: cents(first.amount), index, total: plan.length };
  return { kind: "next", dueOn: first.due_date, amountCents: cents(first.amount), index, total: plan.length };
}

// ── Asistencia ──────────────────────────────────────────────────────────────
export interface AttendanceOccurrence {
  live_session_id: string;
  title: string;
  occurs_on: string;
  starts_at: string;
  attended: boolean;
  source: string | null;
}

export interface AttendanceRateView {
  attended: number;
  total: number;
  pct: number;
  /** Las ultimas clases, de la mas nueva a la mas vieja. */
  recent: AttendanceOccurrence[];
}

/**
 * Asistencia a clases: % y «N de M», contando las clases que ya pasaron desde que empezó el servicio y en las que esa
 * persona estaba en la base (lo arma `service_attendance`). Sin clases pasadas, no hay cifra.
 */
export function attendanceRateView(rows: readonly AttendanceOccurrence[] | null | undefined, recent = 5): AttendanceRateView | null {
  if (!rows || rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => b.starts_at.localeCompare(a.starts_at));
  const attended = sorted.filter((r) => r.attended).length;
  return { attended, total: sorted.length, pct: Math.round((attended / sorted.length) * 100), recent: sorted.slice(0, recent) };
}

// ── Classroom ───────────────────────────────────────────────────────────────
export interface ClassroomItem {
  id: string;
  parent_id: string | null;
  kind: "module" | "submodule" | "lesson";
  lesson_type: string | null;
  title: string;
  position: number;
  required?: boolean | null;
  viewed_at: string | null;
  completed_at: string | null;
  submission: { created_at: string; review_status: string | null } | null;
  unlock: { unlocked?: boolean; visible?: boolean; reason?: string | null; opensOn?: string | null } | null;
}

export type LessonState =
  | { kind: "approved"; on: string }
  | { kind: "submitted"; on: string }
  | { kind: "to_fix"; on: string }
  | { kind: "viewed"; on: string }
  | { kind: "not_submitted" }
  | { kind: "not_viewed" }
  | { kind: "locked" };

export interface ClassroomLessonView {
  id: string;
  title: string;
  isTask: boolean;
  state: LessonState;
  done: boolean;
}

export interface ClassroomModuleView {
  id: string;
  title: string;
  done: number;
  total: number;
  pct: number;
  locked: boolean;
  /** «Se abre el 9 dic» (lo que dice el portal) para un modulo que todavia no se abrio. */
  opensText: string | null;
  lessons: ClassroomLessonView[];
}

export interface ClassroomProgressView {
  modules: ClassroomModuleView[];
  done: number;
  total: number;
  pct: number;
  lessonsViewed: number;
  tasksDone: number;
  tasksTotal: number;
}

const isTaskType = (t: string | null) => t === "activity" || t === "quiz";
const date10 = (iso: string) => iso.slice(0, 10);

function lessonState(l: ClassroomItem, locked: boolean): LessonState {
  if (isTaskType(l.lesson_type)) {
    const sub = l.submission;
    if (sub) {
      const on = date10(sub.created_at);
      if (sub.review_status === "reviewed" || sub.review_status === "graded" || l.completed_at) return { kind: "approved", on: date10(l.completed_at ?? sub.created_at) };
      if (sub.review_status === "needs_changes") return { kind: "to_fix", on };
      return { kind: "submitted", on };
    }
    if (l.completed_at) return { kind: "approved", on: date10(l.completed_at) };
    return locked ? { kind: "locked" } : { kind: "not_submitted" };
  }
  if (l.completed_at || l.viewed_at) return { kind: "viewed", on: date10((l.completed_at ?? l.viewed_at) as string) };
  return locked ? { kind: "locked" } : { kind: "not_viewed" };
}

const lessonDone = (s: LessonState) => s.kind === "approved" || s.kind === "viewed" || s.kind === "submitted";

/**
 * El avance en el classroom: todos los modulos del programa con su barra y «N de M», y adentro cada clase o actividad
 * con su estado (vista, entregada o aprobada con la fecha, sin ver, sin entregar o bloqueada). Un modulo que no se
 * abrio dice cuando se abre. Las clases de un submodulo cuentan para su modulo. Sin contenido, no hay cifra.
 */
export function classroomProgressView(items: readonly ClassroomItem[] | null | undefined): ClassroomProgressView | null {
  if (!items || items.length === 0) return null;
  const byParent = new Map<string | null, ClassroomItem[]>();
  for (const i of items) byParent.set(i.parent_id, [...(byParent.get(i.parent_id) ?? []), i]);
  const order = (a: ClassroomItem, b: ClassroomItem) => a.position - b.position || a.title.localeCompare(b.title);
  const lessonsUnder = (id: string): ClassroomItem[] =>
    (byParent.get(id) ?? []).sort(order).flatMap((c) => (c.kind === "lesson" ? [c] : lessonsUnder(c.id)));
  const modules = items.filter((i) => i.kind === "module").sort(order);
  if (modules.length === 0) return null;
  const views: ClassroomModuleView[] = modules.map((m) => {
    const locked = m.unlock ? m.unlock.unlocked === false : false;
    const lessons = lessonsUnder(m.id).map((l) => {
      const state = lessonState(l, locked);
      return { id: l.id, title: l.title, isTask: isTaskType(l.lesson_type), state, done: lessonDone(state) };
    });
    const done = lessons.filter((l) => l.done).length;
    return {
      id: m.id,
      title: m.title,
      done,
      total: lessons.length,
      pct: lessons.length ? Math.round((done / lessons.length) * 100) : 0,
      locked,
      opensText: locked ? m.unlock?.reason ?? null : null,
      lessons,
    };
  });
  const all = views.flatMap((v) => v.lessons);
  const done = all.filter((l) => l.done).length;
  const tasks = all.filter((l) => l.isTask);
  return {
    modules: views,
    done,
    total: all.length,
    pct: all.length ? Math.round((done / all.length) * 100) : 0,
    lessonsViewed: all.filter((l) => !l.isTask && l.done).length,
    tasksDone: tasks.filter((l) => l.done).length,
    tasksTotal: tasks.length,
  };
}

// ── Asistente IA ────────────────────────────────────────────────────────────
export interface AssistantCreditsInput {
  limitUsd: number;
  credits: number;
  spentUsd: number;
  reached: boolean;
}

export interface AssistantCreditsView {
  used: number;
  total: number;
  pct: number;
  reached: boolean;
}

/** «Asistente IA: % de los créditos del mes». Sin límite (o sin datos), no hay cifra. */
export function assistantCreditsView(d: AssistantCreditsInput | null | undefined, creditsPerUsd: number): AssistantCreditsView | null {
  if (!d || !(d.limitUsd > 0) || !(creditsPerUsd > 0)) return null;
  const total = Math.round(d.limitUsd * creditsPerUsd);
  const left = Math.max(0, Math.min(total, Math.round(d.credits)));
  const used = total - left;
  return { used, total, pct: Math.min(100, Math.round((used / total) * 100)), reached: d.reached || left === 0 };
}

// ── Plazo ───────────────────────────────────────────────────────────────────
/** «38 días de 84»: cuantos dias lleva y el plazo (los dos dias incluidos). Sin inicio, nada; sin fin, solo los dias. */
export function elapsedView(startsOn: string | null, endsOn: string | null, today: string): { day: number; total: number | null } | null {
  if (!startsOn) return null;
  const total = endsOn ? dayDiff(startsOn, endsOn) + 1 : null;
  const raw = dayDiff(startsOn, today) + 1;
  if (raw < 1) return { day: 0, total };
  return { day: total ? Math.min(raw, total) : raw, total };
}
