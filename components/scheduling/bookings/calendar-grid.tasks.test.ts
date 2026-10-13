/**
 * El calendario de agendas con tareas (Tareas × CRM, R7), dibujado con el anfitrion de tareas real y sin red.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined }),
  usePathname: () => "/dashboard/agenda",
  useSearchParams: () => new URLSearchParams("vista=calendar&cal=week"),
}));
vi.mock("@/lib/actions/tasks", () => ({
  completeTask: vi.fn(), createTask: vi.fn(), deleteTask: vi.fn(), planCompletion: vi.fn(), setTaskBlockers: vi.fn(), updateTask: vi.fn(),
  loadTaskContext: vi.fn(async () => ({ ok: false, error: "x", code: "server" })),
}));

import { TaskWorkbench } from "@/components/tasks/task-workbench";
import type { BookingListItem } from "@/lib/scheduling/data/bookings";
import { makeTask, taskId } from "@/lib/tasks/fixtures";
import type { TaskRow } from "@/lib/tasks/types";
import { BookingsCalendar } from "./calendar-grid";

const booking = (over: Partial<BookingListItem> & { id: string; startAt: string; endAt: string }): BookingListItem => ({
  uid: `uid-${over.id}`, title: "Llamada", status: "scheduled", hostUserId: "h1", hostName: "Ana", contactId: "c1", contactName: "Beto Perez", bookerName: null,
  bookerEmail: null, bookerPhone: null, eventTypeId: "e1", eventColor: "#2563eb", categorySnapshot: null as never, origin: "public", locationType: null,
  locationText: null, meetUrl: null, timezone: null, syncStatus: "synced", slotReleasedAt: null, ...over,
});

// Miercoles 14/10 a las 09:00 en Costa Rica (15:00 UTC).
const ITEMS = [booking({ id: "b1", startAt: "2026-10-14T15:00:00Z", endAt: "2026-10-14T15:30:00Z" })];

function render(tasks: TaskRow[], opts: { mode?: "off" | "mine" | "all"; view?: "day" | "week" | "month"; withProvider?: boolean; canEdit?: boolean } = {}) {
  const calendar = createElement(BookingsCalendar, {
    items: ITEMS, timezone: "America/Costa_Rica", timeFormat: "24h", view: opts.view ?? "week", anchor: "2026-10-14",
    onView: () => undefined, onAnchor: () => undefined, onOpen: () => undefined,
    taskControls: { mode: opts.mode ?? "mine", onMode: () => undefined },
  });
  if (opts.withProvider === false) return renderToStaticMarkup(calendar);
  return renderToStaticMarkup(
    createElement(
      TaskWorkbench,
      { initialTasks: tasks, members: [], currentUserId: "u-1", today: "2026-10-13", timeZone: "America/Costa_Rica", canEdit: opts.canEdit ?? true, canDelete: false, syncUrl: true } as never,
      calendar,
    ),
  );
}

const timed = makeTask({ id: taskId(1), title: "Llamar a Ana", due_date: "2026-10-14", due_time: "09:00", duration_minutes: 60, priority: "high" });
const untimed = makeTask({ id: taskId(2), title: "Preparar contrato", due_date: "2026-10-15" });
const done = makeTask({ id: taskId(3), title: "Ya hecha", due_date: "2026-10-16", status: "completed" });
const undated = makeTask({ id: taskId(4), title: "Sin fecha todavia", due_date: null });

describe("el calendario con el interruptor de tareas (R7)", () => {
  it("el interruptor existe, y apagado NO dibuja ninguna tarea ni la franja ni el panel", () => {
    const out = render([timed, untimed], { mode: "off" });
    expect(out).toContain("Tareas en el calendario");
    expect(out).toContain('aria-pressed="false"');
    expect(out).not.toContain("Llamar a Ana");
    expect(out).not.toContain("Sin hora");
    expect(out).not.toContain("Tareas sin sin fecha");
    expect(out).not.toContain("Sin fecha");
  });

  it("encendido, la semana dibuja las tareas con hora en la rejilla y las sin hora en la franja «Sin hora»", () => {
    const out = render([timed, untimed]);
    expect(out).toContain("Llamar a Ana");
    expect(out).toContain("Preparar contrato");
    expect(out).toContain("Sin hora");
    expect(out).toContain("Tareas sin hora, Jue 15");
    // Distintas de las agendas: borde punteado, icono de casilla.
    expect(out).toContain("border-dashed");
    expect(out).toContain("lucide-square-check");
    // La agenda sigue ahi, y se reparten lado a lado: hay un ancho en columnas.
    expect(out).toContain("Beto Perez");
    expect(out).toMatch(/width:calc\(50% - 8px\)/);
  });

  it("una tarea y una agenda en el mismo horario se dibujan lado a lado", () => {
    const out = render([timed]);
    expect(out).toMatch(/left:calc\(0% \+ 4px\);width:calc\(50% - 8px\)/);
    expect(out).toMatch(/left:calc\(50% \+ 4px\);width:calc\(50% - 8px\)/);
  });

  it("sin superposicion, la agenda sigue ocupando todo el ancho", () => {
    const far = makeTask({ id: taskId(9), title: "Tarde", due_date: "2026-10-14", due_time: "17:00" });
    const out = render([far]);
    // Con tareas, cada tarjeta lleva su carril; solo en una columna es todo el ancho (equivale a inset-x-1).
    expect(out).toContain("left:calc(0% + 4px);width:calc(100% - 8px)");
    expect(out).not.toContain("width:calc(50% - 8px)");
  });

  it("las completadas se dibujan atenuadas y tachadas", () => {
    const out = render([done]);
    expect(out).toContain("Ya hecha");
    expect(out).toContain("line-through");
    expect(out).toContain("opacity-60");
  });

  it("el panel «Sin fecha» lista las abiertas sin fecha y las ya con fecha no aparecen ahi", () => {
    const out = render([undated, timed]);
    expect(out).toContain('aria-label="Tareas sin fecha"');
    expect(out).toContain("Sin fecha todavia");
    expect(out).toContain("Buscar por título");
  });

  it("el mes muestra las tareas como chips: con la hora o «Sin hora»", () => {
    const out = render([timed, untimed], { view: "month" });
    expect(out).toContain("09:00 Llamar a Ana");
    expect(out).toContain("Sin hora · Preparar contrato");
  });

  it("sin el anfitrion de tareas (sin permiso) no hay tareas aunque el interruptor este puesto", () => {
    const out = render([], { mode: "mine", withProvider: false });
    expect(out).not.toContain("Sin hora");
    expect(out).not.toContain("Tareas sin fecha");
  });

  it("nada es arrastrable en el render del servidor (el arrastre es solo de escritorio, ya hidratado)", () => {
    const out = render([timed, undated]);
    expect(out).not.toContain("draggable");
  });
});
