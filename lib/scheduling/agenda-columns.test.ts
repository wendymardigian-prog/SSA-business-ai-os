import { describe, expect, it } from "vitest";
import { basePrefsFor, visibleColumns } from "@/lib/ui/data-table/prefs";
import { agendaColumnMetas } from "./agenda-columns";

describe("columnas de la lista de Agenda", () => {
  it("las claves no se repiten y el contacto arranca fijo", () => {
    const metas = agendaColumnMetas();
    expect(new Set(metas.map((m) => m.key)).size).toBe(metas.length);
    expect(basePrefsFor(metas).pinned).toEqual(["contact"]);
  });

  it("de entrada se ven las de la reunión y el último click, no todas las de atribución", () => {
    const metas = agendaColumnMetas();
    const keys = visibleColumns(metas, basePrefsFor(metas)).map((m) => m.key);
    expect(keys).toEqual(expect.arrayContaining(["when", "contact", "event", "status", "touch:last", "attr:utm_source"]));
    expect(keys.length).toBeLessThan(metas.length);
  });
});
