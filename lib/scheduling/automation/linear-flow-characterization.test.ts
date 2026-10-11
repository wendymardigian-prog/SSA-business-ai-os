/**
 * Caracterización de los 7 flujos precreados de la Agenda y del editor lineal
 * ANTES de que Formularios extraiga el editor a `components/automations/`
 * (F21) y arregle que `linearToFlow` pierda `fixedEmail`.
 *
 * Lo que fija: el flujo precreado de cada plantilla pasa del canvas a lineal y
 * de vuelta sin cambiar, con los mismos pasos y el mismo trigger.
 */
import { describe, it, expect } from "vitest";
import { FLOW_TEMPLATES, templateGraph } from "./templates";
import { flowToLinear, linearToFlow } from "./linear-flow";

const STEPS: Record<string, string[]> = {
  confirmation: ["email"],
  reminder_24h: ["email"],
  reminder_1h: ["email", "whatsapp"],
  rescheduled: ["email"],
  cancelled: ["email"],
  no_show: ["email"],
  thank_you: ["delay", "email"],
};

describe("flujos precreados de la Agenda: ida y vuelta canvas ↔ lineal", () => {
  it.each(FLOW_TEMPLATES.map((t) => [t.key, t] as const))("%s", (key, template) => {
    const graph = templateGraph(template, "ev-1");
    const linear = flowToLinear(graph.nodes, graph.edges);
    expect(linear).not.toBeNull();
    expect(linear!.trigger.type).toBe(template.trigger.type);
    expect(linear!.steps.map((s) => s.kind)).toEqual(STEPS[key]);

    const back = linearToFlow(linear!);
    expect(flowToLinear(back.nodes, back.edges)).toEqual(linear);
  });

  it("el trigger conserva el filtro por evento en su config", () => {
    const graph = templateGraph(FLOW_TEMPLATES[0], "ev-1");
    const linear = flowToLinear(graph.nodes, graph.edges)!;
    expect(linear.trigger.config).toMatchObject({ event_type_ids: ["ev-1"] });
  });
});
