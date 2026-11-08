// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import { chipsFor, newPathWorkflowNodes, orphanWorkflows, slotOf, slotTrigger, triggerOf, workflowStatsLabel } from "./workflow-chips";
import { serviceEventMatches } from "../automation";

const V = "11111111-1111-4111-8111-111111111111";

describe("los workflows del camino", () => {
  it("cada lugar arma su disparador y se reconoce de vuelta", () => {
    for (const slot of ["start", "ending", "item:it_aaaaa1", "phase_start:ph_aaaaa1", "phase_end:ph_aaaaa1"] as const) {
      const nodes = newPathWorkflowNodes(slotTrigger(V, slot));
      expect(slotOf(V, triggerOf(nodes))).toBe(slot);
    }
  });

  it("el disparador filtra por la variante y el paso, igual que el motor", () => {
    const { config } = slotTrigger(V, "item:it_aaaaa1");
    expect(serviceEventMatches(config, { variant_id: V, item_key: "it_aaaaa1" })).toBe(true);
    expect(serviceEventMatches(config, { variant_id: V, item_key: "it_bbbbbb" })).toBe(false);
    expect(serviceEventMatches(config, { variant_id: "otra", item_key: "it_aaaaa1" })).toBe(false);
  });

  it("una automatizacion de otra variante no es de este camino", () => {
    expect(slotOf(V, triggerOf(newPathWorkflowNodes(slotTrigger("otra", "start"))))).toBeNull();
    expect(slotOf(V, { triggerType: "form_submitted", config: { variant_id: V } })).toBeNull();
  });

  it("la linea de chips: el disparador y los pasos en orden, con el nombre del nodo si tiene", () => {
    const nodes = [
      ...newPathWorkflowNodes(slotTrigger(V, "start")),
      { id: "a", type: "sendMessage", data: {} },
      { id: "b", type: "action", data: { actionType: "send_email", label: "Bienvenida" } },
    ];
    const edges = [
      { source: "trigger", target: "a" },
      { source: "a", target: "b" },
    ];
    expect(chipsFor(nodes, edges, (t) => (t === "sendMessage" ? "Enviar mensaje" : t))).toEqual(["Empezó un servicio", "Enviar mensaje", "Bienvenida"]);
  });

  it("borrar un paso o una fase deja huerfanos sus workflows", () => {
    const tpl = { phases: [{ key: "ph_aaaaa1", items: [{ key: "it_aaaaa1" }] }] };
    const ws = [
      { id: "1", slot: "item:it_aaaaa1" as const },
      { id: "2", slot: "item:it_zzzzzz" as const },
      { id: "3", slot: "phase_end:ph_zzzzzz" as const },
      { id: "4", slot: "start" as const },
    ];
    expect(orphanWorkflows(ws, tpl)).toEqual(["2", "3"]);
  });

  it("las cuentas, sin mostrar los ceros", () => {
    expect(workflowStatsLabel({ runs30d: 12, failed30d: 2, waiting: 0 })).toBe("12 ejecuciones en 30 días · 2 con error");
    expect(workflowStatsLabel({ runs30d: 1, failed30d: 0, waiting: 1 })).toBe("1 ejecución en 30 días · 1 esperando");
  });
});
