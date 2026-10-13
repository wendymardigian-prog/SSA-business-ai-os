/**
 * El seguimiento con tarea (R2) dibujado de punta a punta con el anfitrion de tareas real, sin red: el campo «Proximo
 * seguimiento» muestra «Crear tarea», la tarea de esa fecha, o nada, segun corresponda.
 */
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined }),
  usePathname: () => "/dashboard/contacts/c-1",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/actions/contacts", () => ({ updateContact: vi.fn() }));
vi.mock("@/lib/actions/tasks", () => ({
  completeTask: vi.fn(), createTask: vi.fn(), deleteTask: vi.fn(), planCompletion: vi.fn(), setTaskBlockers: vi.fn(), updateTask: vi.fn(),
  loadTaskContext: vi.fn(async () => ({ ok: false, error: "x", code: "server" })),
  createFollowupTask: vi.fn(),
}));
vi.mock("@/components/dashboard-chrome", () => ({ useViewerTimezone: () => "America/Costa_Rica" }));

import { FollowupField } from "@/components/contacts/followup-field";
import { makeTask, taskId } from "@/lib/tasks/fixtures";
import type { TaskRow } from "@/lib/tasks/types";
import { ContactTasksProvider } from "./contact-tasks";

const CID = "c-1";
const STORED = "2026-10-20T18:00:00.000Z"; // 12:00 en Costa Rica

function render(opts: { value: string | null; tasks?: TaskRow[]; canEdit?: boolean; canCreateTask?: boolean }) {
  const child: ReactNode = createElement(FollowupField, { contactId: CID, value: opts.value, canCreateTask: opts.canCreateTask });
  return renderToStaticMarkup(
    createElement(
      ContactTasksProvider,
      {
        contactId: CID,
        contactName: "Ana",
        status: "ready",
        data: { tasks: opts.tasks ?? [], members: [{ id: "u-1", name: "Yo" }], currentUserId: "u-1", today: "2026-10-15", timeZone: "America/Costa_Rica", canEdit: opts.canEdit ?? true, canDelete: false },
      } as never,
      child,
    ),
  );
}

const followup = (date: string, over: Partial<TaskRow> = {}) =>
  makeTask({ id: taskId(1), title: `Seguimiento a Ana ${date}`, contact_id: CID, source_ref: `followup:${date}`, due_date: date, owner_id: "u-1", ...over });

describe("tarea de seguimiento bajo el campo (R2)", () => {
  it("con fecha y sin tarea: el boton «Crear tarea»", () => {
    const out = render({ value: STORED });
    expect(out).toContain(">Crear tarea<");
  });

  it("con la tarea de esa fecha: la tarea, no el boton", () => {
    const out = render({ value: STORED, tasks: [followup("2026-10-20")] });
    expect(out).toContain("Seguimiento a Ana 2026-10-20");
    expect(out).toContain("Cambiar el estado");
    expect(out).not.toContain(">Crear tarea<");
  });

  it("si la fecha cambio, vuelve el boton y la tarea anterior no aparece ni se modifica", () => {
    const old = followup("2026-10-20");
    const snapshot = JSON.stringify(old);
    const out = render({ value: "2026-11-03T18:00:00.000Z", tasks: [old] });
    expect(out).toContain("Crear tarea");
    expect(out).not.toContain("Seguimiento a Ana 2026-10-20");
    expect(JSON.stringify(old)).toBe(snapshot);
  });

  it("sin fecha de seguimiento no hay nada debajo del campo", () => {
    const out = render({ value: null, tasks: [followup("2026-10-20")] });
    expect(out).not.toContain("Crear tarea");
    expect(out).not.toContain("Seguimiento a Ana");
  });

  it("sin permiso de editar: no hay boton, pero la tarea se ve (solo lectura)", () => {
    const withoutTask = render({ value: STORED, canEdit: false });
    expect(withoutTask).not.toContain("Crear tarea");
    const withTask = render({ value: STORED, canEdit: false, tasks: [followup("2026-10-20")] });
    expect(withTask).toContain("Seguimiento a Ana 2026-10-20");
    expect(withTask).toContain("disabled");
  });

  it("canCreateTask=false pisa el permiso del anfitrion", () => {
    expect(render({ value: STORED, canCreateTask: false })).not.toContain("Crear tarea");
  });

  it("una tarea completada de esa fecha tambien cuenta: no se ofrece crear otra", () => {
    const out = render({ value: STORED, tasks: [followup("2026-10-20", { status: "completed" })] });
    expect(out).not.toContain(">Crear tarea<");
  });
});
