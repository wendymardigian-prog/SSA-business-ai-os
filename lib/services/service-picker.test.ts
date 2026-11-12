// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import { graphUsesServiceKeys, keyLabel, phaseGroups, serviceKeyProblems, servicePickerOptions, staleKeyMessage, stepGroups } from "./service-picker";

const tpl = (phases: Array<{ key: string; name: string; items: Array<{ key: string; name: string }> }>) => ({ v: 1, phases: phases.map((p) => ({ ...p, items: p.items.map((i) => ({ ...i, kind: "checkbox" })) })) });

const o = servicePickerOptions([
  {
    id: "p2",
    name: "Programa",
    variants: [
      { id: "v1", name: "3 meses", journeyTemplate: tpl([{ key: "ph_aaaaaa", name: "Onboarding", items: [{ key: "it_aaaaaa", name: "Llamada de bienvenida" }] }, { key: "ph_bbbbbb", name: "Implementación", items: [{ key: "it_bbbbbb", name: "Revisión" }] }]) },
      { id: "v2", name: "6 meses", journeyTemplate: tpl([{ key: "ph_cccccc", name: "Onboarding", items: [{ key: "it_cccccc", name: "Llamada de bienvenida" }] }]) },
      { id: "v3", name: "Vieja", archived: true, journeyTemplate: tpl([{ key: "ph_dddddd", name: "X", items: [] }]) },
      { id: "v4", name: "Sin camino", journeyTemplate: null },
    ],
  },
  { id: "p1", name: "Asesoría", variants: [{ id: "v5", name: "Única", journeyTemplate: { phases: [{ key: "mala", name: "rota" }, { key: "ph_eeeeee", name: "Sesiones", items: [{ key: "it_eeeeee", name: "Sesión 1" }, { key: "x", name: "rota" }] }] } }] },
  { id: "p3", name: "Sin variantes con camino", variants: [{ id: "v6", name: "A", journeyTemplate: { phases: [] } }] },
]);

describe("servicePickerOptions", () => {
  it("producto › variante › fases › pasos, sin archivadas, caminos vacíos ni claves rotas", () => {
    expect(o.products.map((p) => p.name)).toEqual(["Asesoría", "Programa"]);
    expect(o.products[1].variants.map((v) => v.name)).toEqual(["3 meses", "6 meses"]);
    expect(o.products[0].variants[0].phases).toEqual([{ key: "ph_eeeeee", name: "Sesiones", steps: [{ key: "it_eeeeee", name: "Sesión 1", kind: "checkbox" }] }]);
  });
});

describe("las listas", () => {
  it("las fases de una variante o de todas las del producto, con su nombre", () => {
    expect(phaseGroups(o, { productId: "p2", variantId: "v1" })).toEqual([{ label: "Programa · 3 meses", options: [{ key: "ph_aaaaaa", label: "Onboarding" }, { key: "ph_bbbbbb", label: "Implementación" }] }]);
    expect(phaseGroups(o, { productId: "p2" }).map((g) => g.label)).toEqual(["Programa · 3 meses", "Programa · 6 meses"]);
    expect(phaseGroups(o, {}).length).toBe(3);
  });
  it("los pasos con su fase; filtrados por fase si se eligió una", () => {
    expect(stepGroups(o, { productId: "p2", variantId: "v1" })[0].options).toEqual([
      { key: "it_aaaaaa", label: "Onboarding › Llamada de bienvenida" },
      { key: "it_bbbbbb", label: "Implementación › Revisión" },
    ]);
    expect(stepGroups(o, { productId: "p2", variantId: "v1", phaseKey: "ph_bbbbbb" })[0].options.map((x) => x.key)).toEqual(["it_bbbbbb"]);
  });
  it("el nombre de una clave guardada", () => {
    expect(keyLabel(o, "it_bbbbbb")).toBe("Implementación › Revisión");
    expect(keyLabel(o, "ph_cccccc")).toBe("Onboarding");
    expect(keyLabel(o, "it_zzzzzz")).toBeNull();
  });
});

describe("una clave que ya no existe", () => {
  it("se avisa con el nombre de la variante", () => {
    expect(staleKeyMessage(o, { productId: "p2", variantId: "v1", itemKey: "it_zzzzzz" })).toBe("Este paso ya no existe en el camino de 3 meses · Elegí otro");
    expect(staleKeyMessage(o, { productId: "p2", variantId: "v1", phaseKey: "ph_cccccc" })).toBe("Esta fase ya no existe en el camino de 3 meses · Elegí otra");
    expect(staleKeyMessage(o, { productId: "p2", itemKey: "it_cccccc" })).toBeNull();
    expect(staleKeyMessage(o, { itemKey: "it_eeeeee" })).toBeNull();
    expect(staleKeyMessage(o, { productId: "p2", itemKey: "it_eeeeee" })).toBe("Este paso ya no existe en el camino de Programa · Elegí otro");
  });
  it("frena la publicación de los pasos y de los disparadores de Servicios", () => {
    const nodes = [
      { type: "svc_complete_step", data: { productId: "p2", itemKey: "it_zzzzzz" } },
      { type: "action", data: { actionType: "svc_change_phase", productId: "p2", phaseKey: "ph_aaaaaa" } },
      { type: "trigger", data: { triggerType: "service_item_completed", config: { variant_id: "v2", item_key: "it_aaaaaa" }, variant_id: "v2", item_key: "it_aaaaaa" } },
      { type: "trigger", data: { triggerType: "service_created" } },
      { type: "message", data: { text: "hola" } },
    ];
    expect(serviceKeyProblems(nodes, o)).toEqual(["«Completar un paso»: Este paso ya no existe en el camino de Programa · Elegí otro.", "El disparador: Este paso ya no existe en el camino de 6 meses · Elegí otro."]);
  });
  it("un paso sin elegir también frena; un flujo sin Servicios no pide nada", () => {
    expect(serviceKeyProblems([{ type: "svc_complete_step", data: {} }], o)).toEqual(["«Completar un paso»: elegí el paso de la lista."]);
    expect(graphUsesServiceKeys([{ type: "message", data: {} }, { type: "trigger", data: { triggerType: "service_created" } }])).toBe(false);
    expect(graphUsesServiceKeys([{ type: "svc_change_phase", data: {} }])).toBe(true);
  });
});

describe("serviceTriggerFilters", () => {
  it("fase en los de fase, paso en los de paso, días en «está por terminar»", async () => {
    const { serviceTriggerFilters } = await import("./service-picker");
    expect(serviceTriggerFilters("service_phase_started")).toEqual({ phase: true, step: false, days: false });
    expect(serviceTriggerFilters("service_item_overdue")).toEqual({ phase: false, step: true, days: false });
    expect(serviceTriggerFilters("service_ending_soon")).toEqual({ phase: false, step: false, days: true });
    expect(serviceTriggerFilters("service_created")).toEqual({ phase: false, step: false, days: false });
  });
});
