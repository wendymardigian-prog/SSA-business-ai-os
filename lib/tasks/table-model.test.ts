import { describe, it, expect } from "vitest";
import { makeTask, taskId } from "./fixtures";
import { ariaSortOf, buildRows, groupRows, INITIAL_PAGE, isBlocked, isOverdue, nextSort, remainingToLoad, sortRows, visibleLimit } from "./table-model";

const TODAY = "2026-10-13";
const members = [{ id: "u1", name: "Ana" }, { id: "u2", name: "Bruno" }];

describe("isOverdue / isBlocked (F10)", () => {
  it("vencida = antes de hoy y sin completar", () => {
    expect(isOverdue({ due_date: "2026-10-12", status: "pending" }, TODAY)).toBe(true);
    expect(isOverdue({ due_date: "2026-10-13", status: "pending" }, TODAY)).toBe(false);
    expect(isOverdue({ due_date: "2026-10-01", status: "completed" }, TODAY)).toBe(false);
    expect(isOverdue({ due_date: null, status: "pending" }, TODAY)).toBe(false);
  });
  it("bloqueada = algun bloqueante conocido sin completar", () => {
    const byId = new Map([["a", { status: "completed" as const }], ["b", { status: "pending" as const }]]);
    expect(isBlocked({ blocked_by: [{ task_id: "a", gap_days: 0 }] }, byId)).toBe(false);
    expect(isBlocked({ blocked_by: [{ task_id: "a", gap_days: 0 }, { task_id: "b", gap_days: 0 }] }, byId)).toBe(true);
    expect(isBlocked({ blocked_by: [{ task_id: "desconocido", gap_days: 0 }] }, byId)).toBe(false);
    expect(isBlocked({ blocked_by: [] }, byId)).toBe(false);
  });
});

describe("buildRows", () => {
  it("una fila por tarea con responsable, seguidores, proyecto, vencida y bloqueada", () => {
    const a = makeTask({ id: taskId(1), title: "A", owner_id: "u1", follower_ids: ["u2", "x"], project: "Q4", project_key: "q4", due_date: "2026-10-01" });
    const b = makeTask({ id: taskId(2), title: "B", blocked_by: [{ task_id: taskId(1), gap_days: 1 }], source: "flow" });
    const rows = buildRows([a, b], members, { today: TODAY });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ title: "A", ownerName: "Ana", followerCount: 2, project: "Q4", overdue: true, blocked: false });
    expect(rows[1]).toMatchObject({ ownerName: null, blocked: true, blockedCount: 1, source: "flow" });
  });
});

describe("sortRows (F10)", () => {
  const rows = buildRows(
    [
      makeTask({ id: taskId(1), title: "sin fecha", due_date: null, priority: "urgent" }),
      makeTask({ id: taskId(2), title: "Zeta", due_date: "2026-10-20", priority: "low", owner_id: "u2", project: "B", project_key: "b" }),
      makeTask({ id: taskId(3), title: "alfa", due_date: "2026-10-15", priority: "normal", owner_id: "u1", project: "A", project_key: "a" }),
      makeTask({ id: taskId(4), title: "otra 15", due_date: "2026-10-15", priority: "urgent" }),
    ],
    members,
    { today: TODAY },
  );
  const titles = (sort: Parameters<typeof sortRows>[1]) => sortRows(rows, sort).map((r) => r.title);

  it("por defecto: vencimiento ascendente, vacias al final, y a igual fecha la mas urgente primero", () => {
    expect(titles(null)).toEqual(["otra 15", "alfa", "Zeta", "sin fecha"]);
  });
  it("por vencimiento descendente: las sin fecha siguen al final", () => {
    expect(titles({ column: "due", dir: "desc" })).toEqual(["Zeta", "otra 15", "alfa", "sin fecha"]);
  });
  it("por titulo, sin distinguir mayusculas", () => {
    expect(titles({ column: "title", dir: "asc" })).toEqual(["alfa", "otra 15", "sin fecha", "Zeta"]);
    expect(titles({ column: "title", dir: "desc" })).toEqual(["Zeta", "sin fecha", "otra 15", "alfa"]);
  });
  it("por prioridad: la mas urgente primero en desc", () => {
    expect(titles({ column: "priority", dir: "desc" }).slice(0, 2)).toEqual(["otra 15", "sin fecha"]);
  });
  it("por responsable y por proyecto: los vacios al final en los dos sentidos", () => {
    expect(titles({ column: "owner", dir: "asc" }).slice(0, 2)).toEqual(["alfa", "Zeta"]);
    expect(titles({ column: "owner", dir: "desc" }).slice(0, 2)).toEqual(["Zeta", "alfa"]);
    expect(titles({ column: "project", dir: "desc" }).slice(0, 2)).toEqual(["Zeta", "alfa"]);
  });
  it("es estable y no muta la entrada", () => {
    const copy = [...rows];
    sortRows(rows, { column: "status", dir: "asc" });
    expect(rows).toEqual(copy);
    expect(titles({ column: "status", dir: "asc" })).toEqual(titles({ column: "status", dir: "asc" }));
  });
});

describe("groupRows (F10)", () => {
  const rows = buildRows(
    [
      makeTask({ id: taskId(1), title: "a", project: "Beta", project_key: "beta" }),
      makeTask({ id: taskId(2), title: "b" }),
      makeTask({ id: taskId(3), title: "c", project: "alfa", project_key: "alfa", status: "completed" }),
      makeTask({ id: taskId(4), title: "d", project: "Beta", project_key: "beta", status: "in_progress" }),
    ],
    members,
    { today: TODAY },
  );
  it("sin agrupar: un grupo con todo", () => {
    expect(groupRows(rows, "none")).toHaveLength(1);
  });
  it("por proyecto: alfabetico y «Sin proyecto» ultimo", () => {
    const g = groupRows(rows, "project");
    expect(g.map((x) => x.label)).toEqual(["alfa", "Beta", "Sin proyecto"]);
    expect(g[1].rows.map((r) => r.title)).toEqual(["a", "d"]);
    expect(g[1].project).toBe("Beta");
    expect(g[2].project).toBeNull();
  });
  it("por estado: en el orden del flujo, sin grupos vacios", () => {
    expect(groupRows(rows, "status").map((x) => x.label)).toEqual(["Pendiente", "En progreso", "Completada"]);
    expect(groupRows(rows.filter((r) => r.status === "pending"), "status").map((x) => x.label)).toEqual(["Pendiente"]);
  });
});

describe("paginacion", () => {
  it("hasta 500 sin paginar; despues de a 100", () => {
    expect(visibleLimit(300, 0)).toBe(300);
    expect(visibleLimit(500, 0)).toBe(500);
    expect(visibleLimit(900, 0)).toBe(INITIAL_PAGE);
    expect(visibleLimit(900, 2)).toBe(700);
    expect(visibleLimit(900, 10)).toBe(900);
    expect(remainingToLoad(900, 0)).toBe(400);
    expect(remainingToLoad(900, 4)).toBe(0);
    expect(remainingToLoad(300, 0)).toBe(0);
  });
});

describe("encabezados ordenables", () => {
  it("asc -> desc -> orden por defecto; otra columna arranca en asc", () => {
    expect(nextSort(null, "due")).toEqual({ column: "due", dir: "asc" });
    expect(nextSort({ column: "due", dir: "asc" }, "due")).toEqual({ column: "due", dir: "desc" });
    expect(nextSort({ column: "due", dir: "desc" }, "due")).toBeNull();
    expect(nextSort({ column: "due", dir: "desc" }, "title")).toEqual({ column: "title", dir: "asc" });
  });
  it("aria-sort", () => {
    expect(ariaSortOf({ column: "due", dir: "asc" }, "due")).toBe("ascending");
    expect(ariaSortOf({ column: "due", dir: "desc" }, "due")).toBe("descending");
    expect(ariaSortOf({ column: "due", dir: "desc" }, "title")).toBe("none");
    expect(ariaSortOf(null, "title")).toBe("none");
  });
});

describe("orden por fecha y hora (R6)", () => {
  const mk = (n: number, due: string | null, time: string | null) => makeTask({ id: taskId(n), title: `t${n}`, due_date: due, due_time: time });
  const order = (rows: ReturnType<typeof makeTask>[], sort: Parameters<typeof sortRows>[1] = null) =>
    sortRows(buildRows(rows, members, { today: TODAY }), sort).map((r) => r.title);

  it("por defecto: el dia y, en el mismo dia, la hora; las sin hora despues de las que tienen", () => {
    const rows = [mk(1, "2026-10-20", null), mk(2, "2026-10-20", "16:00:00"), mk(3, "2026-10-19", "23:00"), mk(4, "2026-10-20", "09:30"), mk(5, null, null)];
    expect(order(rows)).toEqual(["t3", "t4", "t2", "t1", "t5"]);
  });
  it("descendente por vencimiento: los dias al reves, pero las sin hora siguen despues de las con hora de su dia", () => {
    const rows = [mk(1, "2026-10-20", null), mk(2, "2026-10-20", "16:00"), mk(3, "2026-10-19", "23:00"), mk(4, "2026-10-20", "09:30")];
    expect(order(rows, { column: "due", dir: "desc" })).toEqual(["t2", "t4", "t1", "t3"]);
  });
  it("la fila trae la hora normalizada (HH:MM)", () => {
    expect(buildRows([mk(1, "2026-10-20", "14:30:00")], members, { today: TODAY })[0].dueTime).toBe("14:30");
    expect(buildRows([mk(2, "2026-10-20", null)], members, { today: TODAY })[0].dueTime).toBeNull();
  });
});
