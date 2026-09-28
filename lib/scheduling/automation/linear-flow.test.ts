/**
 * El flujo como lista (F57).
 *
 * La regla que importa: si el flujo tiene ramas, `flowToLinear` devuelve null
 * y la pantalla pasa a solo lectura. Mostrar una versión simplificada haría
 * que guardar borre la rama que no se veía.
 */

import { describe, expect, it } from "vitest";
import { describeStep, flowToLinear, linearToFlow, type CanvasEdge, type CanvasNode } from "./linear-flow";
import { FLOW_TEMPLATES, templateGraph } from "./templates";

const trigger: CanvasNode = { id: "trigger", type: "trigger", data: { triggerType: "booking_created", event_type_ids: ["ev-1"] } };

describe("flowToLinear", () => {
  it("una línea de trigger, espera y email se lee entera", () => {
    const nodes: CanvasNode[] = [
      trigger,
      { id: "d", type: "delay", data: { duration: 2, unit: "hours" } },
      { id: "e", type: "action", data: { actionType: "send_email", to: "contact", subject: "Hola", body: "Cuerpo" } },
    ];
    const edges: CanvasEdge[] = [
      { id: "1", source: "trigger", target: "d" },
      { id: "2", source: "d", target: "e" },
    ];
    const linear = flowToLinear(nodes, edges);
    expect(linear?.trigger.type).toBe("booking_created");
    expect(linear?.steps).toEqual([
      { kind: "delay", duration: 2, unit: "hours" },
      { kind: "email", to: "contact", subject: "Hola", body: "Cuerpo" },
    ]);
  });

  it("un Condition con una sola salida entra como condición, no como rama", () => {
    const nodes: CanvasNode[] = [
      trigger,
      { id: "c", type: "condition", data: { conditions: ["has_upcoming_booking:"] } },
      { id: "e", type: "action", data: { actionType: "send_email" } },
    ];
    const edges: CanvasEdge[] = [
      { id: "1", source: "trigger", target: "c" },
      { id: "2", source: "c", target: "e" },
    ];
    expect(flowToLinear(nodes, edges)?.conditions).toEqual(["has_upcoming_booking:"]);
  });

  it("un Condition con dos salidas es una rama: null", () => {
    const nodes: CanvasNode[] = [
      trigger,
      { id: "c", type: "condition", data: {} },
      { id: "a", type: "action", data: { actionType: "send_email" } },
      { id: "b", type: "action", data: { actionType: "addTag" } },
    ];
    const edges: CanvasEdge[] = [
      { id: "1", source: "trigger", target: "c" },
      { id: "2", source: "c", target: "a", sourceHandle: "true" },
      { id: "3", source: "c", target: "b", sourceHandle: "false" },
    ];
    expect(flowToLinear(nodes, edges)).toBeNull();
  });

  it("un A/B es una rama: null", () => {
    const nodes: CanvasNode[] = [trigger, { id: "ab", type: "abSplit", data: {} }];
    expect(flowToLinear(nodes, [{ id: "1", source: "trigger", target: "ab" }])).toBeNull();
  });

  it("un nodo suelto también: null", () => {
    const nodes: CanvasNode[] = [trigger, { id: "e", type: "action", data: { actionType: "send_email" } }, { id: "suelto", type: "delay", data: {} }];
    expect(flowToLinear(nodes, [{ id: "1", source: "trigger", target: "e" }])).toBeNull();
  });

  it("un ciclo: null", () => {
    const nodes: CanvasNode[] = [trigger, { id: "a", type: "delay", data: {} }, { id: "b", type: "delay", data: {} }];
    const edges: CanvasEdge[] = [
      { id: "1", source: "trigger", target: "a" },
      { id: "2", source: "a", target: "b" },
      { id: "3", source: "b", target: "a" },
    ];
    expect(flowToLinear(nodes, edges)).toBeNull();
  });

  it("sin trigger no hay flujo", () => {
    expect(flowToLinear([{ id: "a", type: "delay", data: {} }], [])).toBeNull();
  });
});

describe("las siete plantillas son lineales y vuelven iguales", () => {
  it.each(FLOW_TEMPLATES.map((t) => [t.key, t] as const))("%s", (_key, template) => {
    const { nodes, edges } = templateGraph(template, "ev-1");
    const linear = flowToLinear(nodes, edges);
    expect(linear, "la plantilla tiene que poder verse como lista").not.toBeNull();

    // Ida y vuelta: los pasos son los mismos.
    const back = linearToFlow(linear!);
    expect(flowToLinear(back.nodes, back.edges)?.steps).toEqual(linear!.steps);
    expect(flowToLinear(back.nodes, back.edges)?.trigger.type).toBe(template.trigger.type);
  });
});

describe("describeStep", () => {
  it("dice cada paso en palabras", () => {
    expect(describeStep({ kind: "email", to: "contact", subject: "", body: "" })).toBe("Email al contacto");
    expect(describeStep({ kind: "email", to: "host", subject: "", body: "" })).toBe("Email al anfitrión");
    expect(describeStep({ kind: "delay", duration: 2, unit: "hours" })).toBe("Esperar 2 horas");
    expect(describeStep({ kind: "tag", action: "add", tagName: "vip" })).toBe('Poner el tag "vip"');
    expect(describeStep({ kind: "cancel_booking", status: "cancelled_other" })).toBe("Cancelar la reunión");
  });
});
