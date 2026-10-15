import { describe, it, expect } from "vitest";
import { clearFilters, clearPanelFilters, countActiveFilters, countPanelFilters, DEFAULT_VIEW_STATE, parseViewState, serializeViewState, toggleMine, type TasksViewState } from "./view-state";

const ID = "00000000-0000-4000-8000-000000000009";

const roundTrip = (s: TasksViewState) => parseViewState(serializeViewState(s));

describe("estado de la vista en la URL (F14)", () => {
  it("sin parametros: el estado por defecto, y el por defecto no escribe nada", () => {
    expect(parseViewState(new URLSearchParams(""))).toEqual(DEFAULT_VIEW_STATE);
    expect(serializeViewState(DEFAULT_VIEW_STATE).toString()).toBe("");
  });

  it("ida y vuelta identica con todo puesto", () => {
    const state: TasksViewState = {
      view: "board",
      status: ["pending", "in_progress"],
      owner: ["me", "none", ID],
      follower: ["me"],
      project: ["lanzamiento q4", "diseno, final"],
      priority: ["high", "urgent"],
      overdue: true,
      blocked: true,
      source: ["flow", "agent"],
      q: "propuesta cliente",
      sort: { column: "due", dir: "desc" },
      group: "project",
      mine: true,
      task: ID,
    };
    expect(roundTrip(state)).toEqual(state);
  });

  it("ida y vuelta de cada campo por separado", () => {
    const cases: Array<Partial<TasksViewState>> = [
      { view: "board" }, { status: ["completed"] }, { owner: ["none"] }, { project: ["a b"] }, { overdue: true },
      { q: "hola" }, { sort: { column: "title", dir: "asc" } }, { group: "status" }, { mine: true }, { task: ID },
    ];
    for (const c of cases) {
      const s = { ...DEFAULT_VIEW_STATE, ...c };
      expect(roundTrip(s), JSON.stringify(c)).toEqual(s);
    }
  });

  it("los valores invalidos se ignoran", () => {
    const p = new URLSearchParams(
      "view=cuadros&status=hecho&status=pending&owner=juan&owner=me&priority=maxima&source=magia&sort=nada:asc&sort2=x&group=otro&overdue=si&task=../../etc&mine=0",
    );
    expect(parseViewState(p)).toEqual({ ...DEFAULT_VIEW_STATE, status: ["pending"], owner: ["me"] });
  });

  it("sort con direccion invalida se ignora", () => {
    expect(parseViewState(new URLSearchParams("sort=due:arriba")).sort).toBeNull();
    expect(parseViewState(new URLSearchParams("sort=due:asc")).sort).toEqual({ column: "due", dir: "asc" });
  });

  it("no duplica valores repetidos y recorta la busqueda", () => {
    const s = parseViewState(new URLSearchParams(`status=pending&status=pending&q=${"x".repeat(300)}`));
    expect(s.status).toEqual(["pending"]);
    expect(s.q.length).toBe(100);
  });

  it("acepta un objeto plano (searchParams del servidor)", () => {
    expect(parseViewState({ status: ["pending", "completed"], view: "board", q: undefined })).toEqual({
      ...DEFAULT_VIEW_STATE, view: "board", status: ["pending", "completed"],
    });
  });

  it("cuenta filtros activos; la vista, el orden y la agrupacion no cuentan", () => {
    expect(countActiveFilters(DEFAULT_VIEW_STATE)).toBe(0);
    expect(countActiveFilters({ ...DEFAULT_VIEW_STATE, view: "board", group: "status", sort: { column: "due", dir: "asc" } })).toBe(0);
    expect(countActiveFilters({ ...DEFAULT_VIEW_STATE, status: ["pending", "completed"], owner: ["me"], overdue: true, q: "x" })).toBe(4);
  });

  it("limpiar filtros conserva la vista, el orden, la agrupacion y la tarea abierta", () => {
    const s: TasksViewState = { ...DEFAULT_VIEW_STATE, view: "board", status: ["pending"], q: "x", mine: true, group: "project", task: ID, sort: { column: "title", dir: "asc" } };
    expect(clearFilters(s)).toEqual({ ...DEFAULT_VIEW_STATE, view: "board", group: "project", task: ID, sort: { column: "title", dir: "asc" } });
  });

  it("«Mis tareas» se prende y se apaga", () => {
    expect(toggleMine(DEFAULT_VIEW_STATE).mine).toBe(true);
    expect(toggleMine(toggleMine(DEFAULT_VIEW_STATE)).mine).toBe(false);
  });
});

describe("los filtros del boton «Filtros» de la barra", () => {
  it("la insignia no cuenta la busqueda ni «Mis tareas», que tienen su propio lugar", () => {
    expect(countPanelFilters({ ...DEFAULT_VIEW_STATE, q: "ana", mine: true })).toBe(0);
    expect(countPanelFilters({ ...DEFAULT_VIEW_STATE, q: "ana", mine: true, status: ["pending"], overdue: true })).toBe(2);
  });
  it("limpiar el panel deja la busqueda y «Mis tareas» como estaban", () => {
    const state: TasksViewState = { ...DEFAULT_VIEW_STATE, q: "ana", mine: true, status: ["pending"], blocked: true, group: "project" };
    expect(clearPanelFilters(state)).toEqual({ ...DEFAULT_VIEW_STATE, q: "ana", mine: true, group: "project" });
    expect(countPanelFilters(clearPanelFilters(state))).toBe(0);
  });
});
