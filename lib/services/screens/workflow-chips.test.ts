// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import { chipsFor, completedItemKeys, newCompleterWorkflow, remapWorkflowNodes, newPathWorkflowNodes, orphanWorkflows, slotOf, slotTrigger, triggerOf, workflowStatsLabel } from "./workflow-chips";
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

describe("Lo completan (A4, F150)", () => {
  it("lee los pasos que completa un flujo y arma uno nuevo", () => {
    expect(completedItemKeys([{ id: "t", type: "trigger" }, { id: "a", type: "svc_complete_step", data: { itemKey: "it_aaaaaa" } }, { id: "b", type: "svc_complete_step", data: { itemKey: "it_aaaaaa" } }, { id: "c", type: "svc_complete_step", data: {} }])).toEqual(["it_aaaaaa"]);
    const w = newCompleterWorkflow("it_bbbbbb", "p1");
    expect(w.nodes[0]).toMatchObject({ type: "trigger", data: { triggerType: null } });
    expect(w.nodes[1]).toMatchObject({ type: "svc_complete_step", data: { itemKey: "it_bbbbbb", productId: "p1" } });
    expect(w.edges).toEqual([{ id: "e-trigger-complete", source: "trigger", target: "complete" }]);
  });
  it("un flujo que completa un paso borrado no se pausa (no es un lugar del camino)", () => {
    expect(orphanWorkflows([{ id: "f", slot: "completes:it_zzzzzz" }], { phases: [] })).toEqual([]);
  });
});

describe("copiar workflows al duplicar (A4, F149)", () => {
  it("cambia las claves del disparador y de «Completar paso»; sin claves copiadas, null", () => {
    const nodes = [
      { id: "trigger", type: "trigger", data: { triggerType: "service_item_completed", item_key: "it_a", config: { variant_id: "v", item_key: "it_a" } } },
      { id: "x", type: "svc_complete_step", data: { itemKey: "it_b" } },
    ];
    const out = remapWorkflowNodes(nodes, { it_a: "it_c", it_b: "it_d" })!;
    expect(out[0].data).toMatchObject({ item_key: "it_c", config: { variant_id: "v", item_key: "it_c" } });
    expect(out[1].data).toEqual({ itemKey: "it_d" });
    expect(nodes[0].data.item_key).toBe("it_a");
    expect(remapWorkflowNodes(nodes, { it_z: "it_y" })).toBeNull();
  });
});

describe("disparadores relativos y el arreglo de «por terminar» (A4, F158)", () => {
  it("un evento de un disparador pasa solo para ese disparador", () => {
    expect(serviceEventMatches({}, { trigger_id: "t1", service_id: "s" }, "t1")).toBe(true);
    expect(serviceEventMatches({}, { trigger_id: "t1", service_id: "s" }, "t2")).toBe(false);
    expect(serviceEventMatches({}, { trigger_id: "t1" }, null)).toBe(false);
  });
  it("«Termina en N días» compara con days_before o con days (lo que emitía el barrido viejo)", () => {
    expect(serviceEventMatches({ days_before: 7 }, { days: 7 })).toBe(true);
    expect(serviceEventMatches({ days_before: 7 }, { days: 3 })).toBe(false);
    expect(serviceEventMatches({ days_before: 7 }, { days_before: 7, days: 7 })).toBe(true);
  });
});
