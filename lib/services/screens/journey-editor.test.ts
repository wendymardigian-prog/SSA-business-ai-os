// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import {
  addItem,
  addPhase,
  itemLightForm,
  journeyEditorIssues,
  journeySummaryText,
  moveItem,
  movePhase,
  nudgeItem,
  nudgePhase,
  removeItem,
  removePhase,
  toItemLight,
  updateItem,
  updatePhase,
} from "./journey-editor";
import { EMPTY_TEMPLATE, type JourneyTemplate } from "../journey-template";

// Un generador fijo: las claves de la prueba son siempre las mismas.
function seq() {
  let n = 0;
  return () => ((n++ * 7) % 36) / 36;
}

function base(): JourneyTemplate {
  return {
    v: 1,
    phases: [
      { key: "ph_aaaaa1", name: "Onboarding", duration_days: 14, advance: "auto", items: [
        { key: "it_aaaaa1", kind: "checkbox", name: "Bienvenida" },
        { key: "it_aaaaa2", kind: "checkbox", name: "Diagnostico", due_rule: { from: "item_completed", item_key: "it_aaaaa1", days: 3 } },
      ] },
      { key: "ph_aaaaa2", name: "Trabajo", duration_days: 70, advance: "manual", items: [{ key: "it_aaaaa3", kind: "checkbox", name: "Sesion" }] },
    ],
  };
}

describe("el editor del camino", () => {
  it("agregar fases y pasos da claves validas, nuevas y estables", () => {
    const r = seq();
    const a = addPhase(EMPTY_TEMPLATE, "Inicio", r);
    expect(a.key).toMatch(/^ph_[a-z0-9]{6}$/);
    const b = addItem(a.template, a.key, "checkbox", "Paso 1", r);
    expect(b.key).toMatch(/^it_[a-z0-9]{6}$/);
    const c = addItem(b.template, a.key, "checkbox", "Paso 2", r);
    expect(c.key).not.toBe(b.key);
    expect(journeyEditorIssues(c.template)).toEqual([]);
    expect(EMPTY_TEMPLATE.phases).toEqual([]); // no cambia lo que recibe
  });

  it("mover una fase conserva sus claves y sus pasos", () => {
    const t = movePhase(base(), "ph_aaaaa2", 0);
    expect(t.phases.map((p) => p.key)).toEqual(["ph_aaaaa2", "ph_aaaaa1"]);
    expect(t.phases[1].items.map((i) => i.key)).toEqual(["it_aaaaa1", "it_aaaaa2"]);
  });

  it("mover un paso a otra fase lo saca de la suya", () => {
    const t = moveItem(base(), "it_aaaaa3", "ph_aaaaa1", 0);
    expect(t.phases[0].items.map((i) => i.key)).toEqual(["it_aaaaa3", "it_aaaaa1", "it_aaaaa2"]);
    expect(t.phases[1].items).toEqual([]);
  });

  it("subir y bajar (la alternativa a arrastrar) cruza a la fase vecina en el borde", () => {
    const down = nudgeItem(base(), "it_aaaaa2", 1);
    expect(down.phases[1].items.map((i) => i.key)).toEqual(["it_aaaaa2", "it_aaaaa3"]);
    const up = nudgeItem(base(), "it_aaaaa3", -1);
    expect(up.phases[0].items.map((i) => i.key)).toEqual(["it_aaaaa1", "it_aaaaa2", "it_aaaaa3"]);
    expect(nudgeItem(base(), "it_aaaaa1", -1)).toEqual(base());
    expect(nudgePhase(base(), "ph_aaaaa1", -1)).toEqual(base());
  });

  it("borrar un paso quita los plazos que dependian de el y lo avisa", () => {
    const r = removeItem(base(), "it_aaaaa1");
    expect(r.clearedDue).toEqual(["Diagnostico"]);
    expect(r.template.phases[0].items[0].due_rule).toBeNull();
    expect(journeyEditorIssues(r.template)).toEqual([]);
  });

  it("borrar una fase borra sus pasos", () => {
    const r = removePhase(base(), "ph_aaaaa1");
    expect(r.template.phases.map((p) => p.key)).toEqual(["ph_aaaaa2"]);
  });

  it("renombrar no cambia la clave", () => {
    const t = updateItem(updatePhase(base(), "ph_aaaaa1", { name: "Arranque" }), "it_aaaaa1", { name: "Hola" });
    expect(t.phases[0].key).toBe("ph_aaaaa1");
    expect(t.phases[0].items[0]).toMatchObject({ key: "it_aaaaa1", name: "Hola" });
  });

  it("el semaforo del paso va y vuelve", () => {
    const item = { key: "it_aaaaa1", kind: "checkbox" as const, name: "x", light: { yellow_after_days: 0, red_after_days: 2 } };
    expect(toItemLight(itemLightForm(item))).toEqual(item.light);
    expect(toItemLight({ yellow: "", red: "" })).toBeNull();
    expect(toItemLight({ yellow: "", red: "3" })).toEqual({ yellow_after_days: null, red_after_days: 3 });
  });

  it("muestra el rojo antes que el amarillo como problema, antes de guardar", () => {
    const t = updateItem(base(), "it_aaaaa2", { light: { yellow_after_days: 5, red_after_days: 2 } });
    expect(journeyEditorIssues(t).some((p) => p.includes("rojo tiene que ser igual o mayor"))).toBe(true);
  });

  it("el resumen de la fila de la variante", () => {
    expect(journeySummaryText(base())).toBe("2 fases · 3 pasos · 84 días");
    expect(journeySummaryText(EMPTY_TEMPLATE)).toBe("Sin camino");
  });
});
