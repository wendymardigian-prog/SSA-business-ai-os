// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import {
  addItem,
  addPhase,
  duplicateItem,
  duplicatePhase,
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

describe("el botón del paso (F125)", () => {
  it("en un paso nuevo de formulario o agenda arranca prendido; en una casilla, apagado", async () => {
    const { addItem: add } = await import("./journey-editor");
    const base = { v: 1 as const, phases: [{ key: "ph_aaaaaa", name: "F", items: [] }] } as never;
    const f = add(base, "ph_aaaaaa", "form", "Diagnóstico", () => 0.1);
    expect(f.template.phases[0].items[0].portal_button).toBe(true);
    const c = add(base, "ph_aaaaaa", "checkbox", "Leer", () => 0.1);
    expect(c.template.phases[0].items[0].portal_button).toBeUndefined();
  });
  it("el estado del editor: apagado y con motivo si el cliente no ve el paso", async () => {
    const { buttonEditorState } = await import("./journey-editor");
    expect(buttonEditorState({ key: "it_aaaaaa", kind: "checkbox", name: "x", portal_button: true, visible_to_client: false } as never)).toMatchObject({ on: false, disabledReason: "Para mostrar el botón, el cliente tiene que ver el paso", needsUrl: true, hasShowResponse: false });
    expect(buttonEditorState({ key: "it_aaaaaa", kind: "contract", name: "x", portal_button: true, ref: { button: { label: "Firmar" }, show_response: false } } as never)).toMatchObject({ on: true, label: "Firmar", needsUrl: false, hasShowResponse: true, showResponse: false });
  });
  it("guardar el texto y el link conserva el resto de ref; vacíos se sacan", async () => {
    const { withButton, visibilityPatch } = await import("./journey-editor");
    const item = { key: "it_aaaaaa", kind: "checkbox", name: "x", ref: { form_id: "f" } } as never;
    expect(withButton(item, { label: "Abrir\nla guía", url: " https://ejemplo.com " })).toEqual({ form_id: "f", button: { label: "Abrir la guía", url: "https://ejemplo.com" } });
    expect(withButton({ ...(item as object), ref: { button: { label: "x" } } } as never, { label: "" })).toEqual({});
    expect(visibilityPatch(false)).toEqual({ visible_to_client: false, portal_button: false });
  });
});

describe("defaultButtonLabel y buttonDestination", () => {
  it("un texto por tipo y la línea de a dónde lleva", async () => {
    const { defaultButtonLabel, buttonDestination } = await import("../journey-template");
    expect(defaultButtonLabel("form")).toBe("Completar el formulario");
    expect(defaultButtonLabel("booking", "attended")).toBe("Agendar la llamada");
    expect(defaultButtonLabel("open_module")).toBe("Ver el módulo");
    expect(defaultButtonLabel("team_task")).toBe("Abrir");
    expect(buttonDestination("checkbox")).toMatch(/pestaña nueva/);
    expect(buttonDestination("booking", "attended")).toMatch(/Entrar a la llamada/);
  });
});

describe("duplicar (A4, F149)", () => {
  const base = (): JourneyTemplate => ({
    v: 1,
    phases: [
      {
        key: "ph_aaaaaa",
        name: "Arranque",
        advance: "auto",
        items: [
          { key: "it_aaaaaa", kind: "checkbox", name: "Uno" },
          { key: "it_bbbbbb", kind: "team_task", name: "Dos", due_rule: { from: "item_completed", item_key: "it_aaaaaa", days: 2 }, ref: { lock: { after_item_key: "it_aaaaaa" }, checklist: ["a"] } },
        ],
      },
    ],
  } as JourneyTemplate);
  let seed = 0;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);

  it("un paso: copia justo después, clave nueva y nombre con (copia)", () => {
    const r = duplicateItem(base(), "it_bbbbbb", rnd);
    const items = r.template.phases[0].items;
    expect(items.map((i) => i.key)).toEqual(["it_aaaaaa", "it_bbbbbb", r.key]);
    expect(items[2].name).toBe("Dos (copia)");
    expect(items[2].ref).toEqual(items[1].ref);
    expect(r.keyMap).toEqual({ it_bbbbbb: r.key });
  });

  it("una fase: claves nuevas y las referencias internas apuntan a la copia", () => {
    const r = duplicatePhase(base(), "ph_aaaaaa", rnd);
    expect(r.template.phases).toHaveLength(2);
    const copy = r.template.phases[1];
    expect(copy.key).toBe(r.key);
    expect(copy.name).toBe("Arranque (copia)");
    const [a, b] = copy.items;
    expect(a.key).toBe(r.keyMap.it_aaaaaa);
    expect(b.due_rule?.item_key).toBe(a.key);
    expect((b.ref as { lock: { after_item_key: string } }).lock.after_item_key).toBe(a.key);
    const all = r.template.phases.flatMap((p) => [p.key, ...p.items.map((i) => i.key)]);
    expect(new Set(all).size).toBe(all.length);
    // El original no cambió.
    expect(r.template.phases[0]).toEqual(base().phases[0]);
  });

  it("borrar el paso del que depende un bloqueo saca el bloqueo", () => {
    const r = removeItem(base(), "it_aaaaaa");
    const it = r.template.phases[0].items[0];
    expect((it.ref as Record<string, unknown>).lock).toBeUndefined();
    expect(r.clearedDue).toContain("Dos");
  });
});
