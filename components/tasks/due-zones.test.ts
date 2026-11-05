/**
 * Lo que ve quien esta en otra zona, dibujado con los componentes reales y sin red: la celda de la tabla, la linea de la ficha
 * y el drawer. Negocio en Costa Rica, quien mira en Tokio: una tarea de las 23:00 del 14 es, para quien mira, las 14:00 del 15.
 */
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined }),
  usePathname: () => "/dashboard/tareas",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/actions/tasks", () => ({
  completeTask: vi.fn(), createTask: vi.fn(), deleteTask: vi.fn(), planCompletion: vi.fn(), setTaskBlockers: vi.fn(), updateTask: vi.fn(),
  loadTaskContext: vi.fn(async () => ({ ok: false, error: "x", code: "server" })),
  createFollowupTask: vi.fn(),
}));
vi.mock("@/components/dashboard-chrome", () => ({ useViewerTimezone: () => "Asia/Tokyo" }));

import { makeTask, taskId } from "@/lib/tasks/fixtures";
import { buildRows } from "@/lib/tasks/table-model";
import { ContactTasks, ContactTasksProvider } from "./contact-tasks";
import { TaskCell, type CellEnv } from "./task-cells";
import { TaskDrawer } from "./task-drawer";
import type { TaskActions } from "./use-task-actions";

const CR = "America/Costa_Rica";
const zones = { workspaceTz: CR, viewerTz: "Asia/Tokyo" };
const TODAY = "2026-10-15"; // Hoy para quien mira, en Tokio.
const CID = "c-1";
const late = makeTask({ id: taskId(1), title: "De noche", contact_id: CID, due_date: "2026-10-14", due_time: "23:00:00" });
const civil = makeTask({ id: taskId(2), title: "Solo fecha", contact_id: CID, due_date: "2026-10-14" });

function cell(editing: boolean, task = late) {
  const env: CellEnv = { members: [], memberNames: new Map(), projects: [], today: TODAY, zones, canEdit: true, source: {} };
  const [view] = buildRows([task], [], { today: TODAY, zones });
  const props = { view, column: "due" as const, env, position: { row: 0, col: 0 }, editing, busy: false, onStartEdit: () => undefined, onEndEdit: () => undefined, onCommit: () => undefined, onOpen: () => undefined };
  return renderToStaticMarkup(createElement("table", null, createElement("tbody", null, createElement("tr", null, createElement(TaskCell, props)))));
}

function line(children: ReactNode) {
  return renderToStaticMarkup(
    createElement(
      ContactTasksProvider,
      {
        contactId: CID,
        status: "ready",
        data: { tasks: [late, civil], members: [], currentUserId: "u-1", today: TODAY, timeZone: CR, timeFormat: "24h", canEdit: true, canDelete: false },
      } as never,
      children,
    ),
  );
}

describe("la celda de la tabla", () => {
  it("muestra el dia y la hora de quien mira, con su «hoy»", () => {
    expect(cell(false)).toContain("Hoy · 14:00");
  });
  it("el editor arranca con el dia y la hora que se ven, no con lo guardado", () => {
    const out = cell(true);
    expect(out).toContain('value="2026-10-15"');
    expect(out).toContain('value="14:00"');
    expect(out).not.toContain('value="2026-10-14"');
  });
  it("una tarea sin hora muestra la fecha civil: el 14 es ayer", () => {
    expect(cell(false, civil)).toContain("Ayer");
    expect(cell(true, civil)).toContain('value="2026-10-14"');
  });
});

describe("la linea de la ficha del contacto", () => {
  it("dice lo mismo que la tabla, y ordena por lo que se ve", () => {
    const out = line(createElement(ContactTasks));
    expect(out).toContain("Hoy · 14:00");
    expect(out).toContain("Ayer");
    expect(out.indexOf("Solo fecha")).toBeLessThan(out.indexOf("De noche"));
  });
});

describe("el drawer", () => {
  function drawer(task: typeof late) {
    return renderToStaticMarkup(
      createElement(TaskDrawer, {
        mode: "view", task, allTasks: [task], members: [], memberNames: new Map(), projects: [], today: TODAY, timeZone: CR, canEdit: true, canDelete: false,
        actions: { busy: new Set<string>() } as unknown as TaskActions, contactName: null, source: {}, currentUserId: "u-1", historyNames: {},
        onClose: () => undefined, onOpenTask: () => undefined, onCreated: () => undefined,
      }),
    );
  }
  it("la pastilla de la fecha muestra el dia que ve quien mira", () => {
    const out = drawer(late);
    expect(out).toContain("jue 15 oct");
    expect(out).toContain('value="2026-10-15"');
  });
  it("una tarea sin hora no se mueve", () => {
    expect(drawer(civil)).toContain("mié 14 oct");
  });
});
