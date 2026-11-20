// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import { parseTargetValue, staleTargetLabel, targetValueOf, unlockTargetOptions } from "./unlock-targets";
import type { ProgramRow } from "./tree";
import type { PickerVariant } from "@/lib/services/service-picker";

const row = (id: string, parent_id: string | null, title: string, position: number, status: ProgramRow["status"] = "active"): ProgramRow => ({
  id,
  parent_id,
  kind: parent_id ? "lesson" : "module",
  lesson_type: parent_id ? "video" : null,
  title,
  position,
  status,
});

const rows: ProgramRow[] = [
  row("m1", null, "Empezá acá", 0),
  row("l1", "m1", "Tarea", 1),
  row("l0", "m1", "Bienvenida", 0),
  row("m2", null, "Claude desde 0", 1),
  row("l2", "m2", "Clase 2.1", 0),
  row("m9", null, "Viejo", 9, "archived"),
];

const variants: PickerVariant[] = [
  { id: "v1", name: "SSA 6 meses", phases: [{ key: "ph_fase10", name: "Formación", steps: [{ key: "it_plan90", name: "Entregar tu Plan de 90 días", kind: "activity" }] }] },
  { id: "v2", name: "Lite", phases: [{ key: "ph_progrm", name: "Programa", steps: [{ key: "it_plan90", name: "Entregar tu Plan de 90 días", kind: "activity" }, { key: "it_metodo", name: "Método Builder", kind: "checkbox" }] }] },
];

describe("qué se puede elegir en «Se abre al completar algo»", () => {
  const o = unlockTargetOptions({ rows, variants, selfId: "m2" });

  it("un paso que tienen varias variantes aparece una vez, con sus variantes", () => {
    expect(o.journey).toEqual([
      { value: "journey_item:it_plan90", target: "journey_item", id: "it_plan90", label: "Entregar tu Plan de 90 días · SSA 6 meses, Lite" },
      { value: "journey_item:it_metodo", target: "journey_item", id: "it_metodo", label: "Método Builder · Lite" },
    ]);
  });

  it("las clases y módulos van en el orden del árbol, sin el propio, sus hijos ni lo archivado", () => {
    expect(o.program.map((x) => x.label)).toEqual(["Empezá acá", "Empezá acá › Bienvenida", "Empezá acá › Tarea"]);
  });

  it("sin variantes con camino, no hay pasos para elegir", () => {
    expect(unlockTargetOptions({ rows, variants: [], selfId: "m2" }).journey).toEqual([]);
  });
});

describe("el valor guardado", () => {
  it("una regla sin `target` se resuelve por el id", () => {
    expect(targetValueOf({ type: "after_complete", id: "it_plan90" }, rows)).toBe("journey_item:it_plan90");
    expect(targetValueOf({ type: "after_complete", id: "l1" }, rows)).toBe("program_item:l1");
    expect(targetValueOf({ type: "after_complete", target: "journey_item", id: "it_plan90" }, rows)).toBe("journey_item:it_plan90");
  });

  it("otra regla, o sin id, no tiene valor", () => {
    expect(targetValueOf({ type: "fixed_date" }, rows)).toBe("");
    expect(targetValueOf({ type: "after_complete" }, rows)).toBe("");
    expect(targetValueOf(null, rows)).toBe("");
  });

  it("se lee de vuelta", () => {
    expect(parseTargetValue("journey_item:it_plan90")).toEqual({ target: "journey_item", id: "it_plan90" });
    expect(parseTargetValue("program_item:l1")).toEqual({ target: "program_item", id: "l1" });
    expect(parseTargetValue("")).toBeNull();
    expect(parseTargetValue("otra:x")).toBeNull();
  });

  it("lo que ya no está en la lista se avisa", () => {
    const o = unlockTargetOptions({ rows, variants, selfId: "m2" });
    expect(staleTargetLabel("journey_item:it_plan90", o)).toBeNull();
    expect(staleTargetLabel("journey_item:it_borrad", o)).toBe("Un paso que ya no está en el camino · elegí otro");
    expect(staleTargetLabel("program_item:m9", o)).toBe("Una clase o un módulo que ya no existe · elegí otro");
    expect(staleTargetLabel("", o)).toBeNull();
  });
});
