// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import { assistantCreditsView, attendanceRateView, classroomProgressView, elapsedView, nextPaymentView, type ClassroomItem } from "./record-figures";

describe("nextPaymentView", () => {
  const p = (status: string, due: string | null, amount = 800, type = "installment") => ({ status, type, amount, due_date: due });
  it("sin cuotas no hay cifra", () => {
    expect(nextPaymentView([], "2026-11-10")).toBeNull();
    expect(nextPaymentView(null, "2026-11-10")).toBeNull();
  });
  it("todo cobrado es Pagado", () => {
    expect(nextPaymentView([p("paid", "2026-10-01"), p("paid", "2026-11-01")], "2026-11-10")).toEqual({ kind: "paid", label: "Pagado" });
  });
  it("la próxima cuota con su número, fecha y monto", () => {
    expect(nextPaymentView([p("paid", "2026-11-03"), p("paid", "2026-11-17"), p("scheduled", "2026-12-03")], "2026-11-10")).toEqual({ kind: "next", dueOn: "2026-12-03", amountCents: 80000, index: 3, total: 3 });
  });
  it("una vencida dice hace cuántos días, aunque la marca no haya pasado todavía", () => {
    expect(nextPaymentView([p("paid", "2026-10-01"), p("scheduled", "2026-11-05")], "2026-11-10")).toMatchObject({ kind: "overdue", daysLate: 5, index: 2 });
    expect(nextPaymentView([p("overdue", "2026-11-10")], "2026-11-10")).toMatchObject({ kind: "overdue", daysLate: 1 });
  });
  it("los reembolsos y las canceladas no son cuotas", () => {
    expect(nextPaymentView([p("paid", "2026-10-01"), p("paid", "2026-10-02", -100, "refund"), p("cancelled", "2026-12-01")], "2026-11-10")).toEqual({ kind: "paid", label: "Pagado" });
  });
  it("un incobrable no es Pagado ni próximo", () => {
    expect(nextPaymentView([p("paid", "2026-10-01"), p("uncollectible", "2026-11-01")], "2026-11-10")).toBeNull();
  });
});

describe("attendanceRateView", () => {
  const o = (on: string, attended: boolean) => ({ live_session_id: "s", title: "Clase en vivo", occurs_on: on, starts_at: `${on}T22:00:00Z`, attended, source: attended ? "team" : null });
  it("sin clases pasadas no hay cifra", () => expect(attendanceRateView([])).toBeNull());
  it("cuenta N de M y redondea el %", () => {
    const v = attendanceRateView([o("2026-11-04", true), o("2026-11-11", false), o("2026-11-18", true)]);
    expect(v).toMatchObject({ attended: 2, total: 3, pct: 67 });
    expect(v?.recent[0].occurs_on).toBe("2026-11-18");
  });
  it("las últimas, como mucho las pedidas", () => {
    const rows = Array.from({ length: 8 }, (_, i) => o(`2026-10-${String(10 + i).padStart(2, "0")}`, i % 2 === 0));
    expect(attendanceRateView(rows, 4)?.recent).toHaveLength(4);
  });
});

describe("classroomProgressView", () => {
  const item = (over: Partial<ClassroomItem> & Pick<ClassroomItem, "id" | "kind" | "title">): ClassroomItem => ({
    parent_id: null, lesson_type: null, position: 0, viewed_at: null, completed_at: null, submission: null, unlock: null, ...over,
  });
  const items: ClassroomItem[] = [
    item({ id: "m1", kind: "module", title: "Fundamentos", position: 1, unlock: { unlocked: true } }),
    item({ id: "l1", kind: "lesson", parent_id: "m1", title: "Bienvenida", lesson_type: "video", position: 1, viewed_at: "2026-11-04T10:00:00Z" }),
    item({ id: "a1", kind: "lesson", parent_id: "m1", title: "Actividad", lesson_type: "activity", position: 2, submission: { created_at: "2026-11-05T10:00:00Z", review_status: "reviewed" } }),
    item({ id: "m2", kind: "module", title: "Oferta", position: 2, unlock: { unlocked: true } }),
    item({ id: "s2", kind: "submodule", parent_id: "m2", title: "Precio", position: 1 }),
    item({ id: "l2", kind: "lesson", parent_id: "s2", title: "Cómo poner precio", lesson_type: "video", position: 1 }),
    item({ id: "q2", kind: "lesson", parent_id: "m2", title: "Evaluación", lesson_type: "quiz", position: 2, submission: { created_at: "2026-11-08T10:00:00Z", review_status: "needs_changes" } }),
    item({ id: "m3", kind: "module", title: "Ventas", position: 3, unlock: { unlocked: false, reason: "Se abre el 9 dic" } }),
    item({ id: "l3", kind: "lesson", parent_id: "m3", title: "Guion", lesson_type: "video", position: 1 }),
    item({ id: "a3", kind: "lesson", parent_id: "m3", title: "Entrega", lesson_type: "activity", position: 2 }),
  ];
  it("sin contenido no hay cifra", () => {
    expect(classroomProgressView([])).toBeNull();
    expect(classroomProgressView([item({ id: "l", kind: "lesson", title: "suelta" })])).toBeNull();
  });
  it("todos los módulos con su N de M, y las clases de un submódulo cuentan para su módulo", () => {
    const v = classroomProgressView(items)!;
    expect(v.modules.map((m) => [m.title, m.done, m.total])).toEqual([["Fundamentos", 2, 2], ["Oferta", 0, 2], ["Ventas", 0, 2]]);
    expect(v).toMatchObject({ done: 2, total: 6, pct: 33, lessonsViewed: 1, tasksDone: 1, tasksTotal: 3 });
  });
  it("cada clase con su estado y su fecha", () => {
    const v = classroomProgressView(items)!;
    expect(v.modules[0].lessons.map((l) => l.state)).toEqual([{ kind: "viewed", on: "2026-11-04" }, { kind: "approved", on: "2026-11-05" }]);
    expect(v.modules[1].lessons.map((l) => l.state.kind)).toEqual(["not_viewed", "to_fix"]);
  });
  it("un módulo bloqueado dice cuándo se abre y sus clases están bloqueadas", () => {
    const m = classroomProgressView(items)!.modules[2];
    expect(m).toMatchObject({ locked: true, opensText: "Se abre el 9 dic" });
    expect(m.lessons.map((l) => l.state.kind)).toEqual(["locked", "locked"]);
  });
  it("una entrega sin revisar cuenta como entregada", () => {
    const v = classroomProgressView([items[0], { ...items[2], submission: { created_at: "2026-11-05T10:00:00Z", review_status: "pending" } }])!;
    expect(v.modules[0].lessons[0].state).toEqual({ kind: "submitted", on: "2026-11-05" });
  });
});

describe("assistantCreditsView", () => {
  it("% de los créditos del mes", () => {
    expect(assistantCreditsView({ limitUsd: 10, credits: 280, spentUsd: 7.2, reached: false }, 100)).toEqual({ used: 720, total: 1000, pct: 72, reached: false });
  });
  it("sin límite o sin datos no hay cifra", () => {
    expect(assistantCreditsView(null, 100)).toBeNull();
    expect(assistantCreditsView({ limitUsd: 0, credits: 0, spentUsd: 0, reached: false }, 100)).toBeNull();
  });
  it("sin créditos es llegó al límite", () => {
    expect(assistantCreditsView({ limitUsd: 10, credits: 0, spentUsd: 10, reached: false }, 100)).toMatchObject({ pct: 100, reached: true });
  });
});

describe("elapsedView", () => {
  it("38 días de 84", () => expect(elapsedView("2026-11-03", "2027-01-25", "2026-12-10")).toEqual({ day: 38, total: 84 }));
  it("antes de empezar es el día 0", () => expect(elapsedView("2026-12-01", "2027-01-25", "2026-11-10")).toEqual({ day: 0, total: 56 }));
  it("después del fin no pasa del plazo", () => expect(elapsedView("2026-11-03", "2026-11-10", "2026-12-10")).toEqual({ day: 8, total: 8 }));
  it("sin fin solo los días; sin inicio nada", () => {
    expect(elapsedView("2026-11-03", null, "2026-11-04")).toEqual({ day: 2, total: null });
    expect(elapsedView(null, null, "2026-11-04")).toBeNull();
  });
});
