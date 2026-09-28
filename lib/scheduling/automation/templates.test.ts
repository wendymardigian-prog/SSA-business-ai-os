import { describe, expect, it } from "vitest";
import { FLOW_TEMPLATES, flowNameFor, templateByKey, templateGraph } from "./templates";

describe("plantillas de flujo del evento (F49)", () => {
  it("son exactamente las 7 del plano, con su trigger", () => {
    expect(FLOW_TEMPLATES.map((t) => t.key)).toEqual([
      "confirmation",
      "reminder_24h",
      "reminder_1h",
      "rescheduled",
      "cancelled",
      "no_show",
      "thank_you",
    ]);
    expect(FLOW_TEMPLATES.map((t) => t.trigger.type)).toEqual([
      "booking_created",
      "booking_before_start",
      "booking_before_start",
      "booking_rescheduled",
      "booking_cancelled",
      "booking_status_changed",
      "booking_status_changed",
    ]);
    expect(templateByKey("reminder_24h")?.trigger.config).toEqual({ offset_minutes: 1440 });
    expect(templateByKey("reminder_1h")?.trigger.config).toEqual({ offset_minutes: 60 });
    expect(templateByKey("no_show")?.trigger.config).toEqual({ to_status: ["no_show"] });
    expect(templateByKey("thank_you")?.trigger.config).toMatchObject({ to_status: ["followup_warm", "followup_cold", "sale", "not_qualified"] });
  });

  it("todas tienen asunto y cuerpo con variables, en español", () => {
    for (const t of FLOW_TEMPLATES) {
      expect(t.subject && t.subject.length).toBeGreaterThan(3);
      expect(t.body).toContain("{{");
      expect(t.body.length).toBeGreaterThan(40);
    }
  });

  it("el grafo lleva el trigger filtrado a su evento y termina en el email", () => {
    const g = templateGraph(FLOW_TEMPLATES[0], "ev-1");
    expect(g.nodes[0].type).toBe("trigger");
    expect(g.nodes[0].data).toMatchObject({ triggerType: "booking_created", event_type_ids: ["ev-1"] });
    expect(g.nodes.at(-1)?.data).toMatchObject({ actionType: "send_email", to: "contact" });
    expect(g.edges).toEqual([{ id: "trigger-email", source: "trigger", target: "email" }]);
  });

  it("el recordatorio de 1 h suma el WhatsApp y el agradecimiento, la espera de 2 h", () => {
    const uno = templateGraph(templateByKey("reminder_1h")!, "ev-1");
    expect(uno.nodes.map((n) => n.id)).toEqual(["trigger", "email", "whatsapp"]);
    const gracias = templateGraph(templateByKey("thank_you")!, "ev-1");
    expect(gracias.nodes.map((n) => n.id)).toEqual(["trigger", "delay", "email"]);
    expect(gracias.nodes[1].data).toEqual({ duration: 2, unit: "hours" });
  });

  it("el nombre lleva el titulo del evento adelante", () => {
    expect(flowNameFor("Llamada de triaje", FLOW_TEMPLATES[0])).toBe("Llamada de triaje · Confirmación con tu marca");
  });
});

describe("las plantillas usan tipos que el motor conoce", () => {
  it("cada nodo de cada plantilla resuelve en el registro", async () => {
    // Una plantilla con un actionType mal escrito se guarda igual, se ve bien
    // en el canvas y no hace nada al correr. Esto lo ataja.
    const { resolveNodeType } = await import("@/lib/flow-engine/registry");
    for (const template of FLOW_TEMPLATES) {
      const { nodes } = templateGraph(template, "ev-1");
      for (const node of nodes) {
        if (node.type === "trigger") continue;
        expect(resolveNodeType(node as never), `${template.key}: el nodo ${node.id} no existe en el registro`).toBeTruthy();
      }
    }
  });

  it("cada plantilla usa un trigger registrado", async () => {
    const { getTrigger } = await import("@/lib/flow-engine/registry");
    for (const template of FLOW_TEMPLATES) {
      expect(getTrigger(template.trigger.type), `${template.key}: el trigger ${template.trigger.type} no existe`).toBeDefined();
    }
  });
});
