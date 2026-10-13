import { describe, it, expect } from "vitest";
import { parseTaskParam, withoutTaskParam, withTaskParam } from "./drawer-url";

const ID = "00000000-0000-4000-8000-000000000009";

describe("drawer en la URL (F12)", () => {
  it("lee ?task= de URLSearchParams y de un objeto", () => {
    expect(parseTaskParam(new URLSearchParams(`task=${ID}`))).toBe(ID);
    expect(parseTaskParam({ task: ID })).toBe(ID);
    expect(parseTaskParam({ task: [ID, "otra"] })).toBe(ID);
  });
  it("ignora lo que no tiene forma de id", () => {
    expect(parseTaskParam(new URLSearchParams("task=../../x"))).toBeNull();
    expect(parseTaskParam(new URLSearchParams("task="))).toBeNull();
    expect(parseTaskParam({})).toBeNull();
  });
  it("abrir conserva los demas parametros", () => {
    expect(withTaskParam("view=board&status=pending&status=completed", ID)).toBe(`/dashboard/tareas?view=board&status=pending&status=completed&task=${ID}`);
  });
  it("cambiar de tarea reemplaza, no duplica", () => {
    const first = withTaskParam("q=hola", ID);
    const url = new URLSearchParams(first.split("?")[1]);
    const other = "00000000-0000-4000-8000-0000000000aa";
    expect(withTaskParam(url, other)).toBe(`/dashboard/tareas?q=hola&task=${other}`);
  });
  it("cerrar quita solo task; sin otros parametros queda la ruta limpia", () => {
    expect(withoutTaskParam(`view=board&task=${ID}&q=x`)).toBe("/dashboard/tareas?view=board&q=x");
    expect(withoutTaskParam(`task=${ID}`)).toBe("/dashboard/tareas");
    expect(withoutTaskParam("")).toBe("/dashboard/tareas");
  });
  it("no repite parametros", () => {
    const out = withTaskParam(`task=${ID}&task=${ID}`, ID);
    expect(out.match(/task=/g)).toHaveLength(1);
  });
});

describe("drawer en otra pagina (R1)", () => {
  it("usa la ruta que se le pasa y conserva los demas parametros", () => {
    expect(withTaskParam("vista=calendar&cal=week", ID, "/dashboard/agenda")).toBe(`/dashboard/agenda?vista=calendar&cal=week&task=${ID}`);
    expect(withoutTaskParam(`vista=calendar&task=${ID}`, "/dashboard/agenda")).toBe("/dashboard/agenda?vista=calendar");
    expect(withoutTaskParam(`task=${ID}`, "/dashboard/contacts/abc")).toBe("/dashboard/contacts/abc");
  });
});
