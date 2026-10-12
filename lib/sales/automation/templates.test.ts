import { describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { resolveNodeType } from "@/lib/flow-engine/registry";
import { SALES_FLOW_TEMPLATES, SALES_TEMPLATE_KEYS, salesTemplateGraph } from "./templates";
import { ensureSalesTemplateFlows } from "./templates-run";
import { validateSalesTriggerConfig } from "./triggers";
import { presetFor } from "./presets";

describe("las cuatro plantillas", () => {
  it("son las cuatro del plano, con sus triggers", () => {
    expect(SALES_TEMPLATE_KEYS).toEqual(["payment_reminder_3d", "payment_due_today", "payment_overdue_3d", "sale_settled_thanks"]);
    const by = Object.fromEntries(SALES_FLOW_TEMPLATES.map((t) => [t.key, t.trigger]));
    expect(by.payment_reminder_3d).toEqual({ type: "payment_before_due", config: { offset_days: 3, at_time: "09:00" } });
    expect(by.payment_due_today).toEqual({ type: "payment_before_due", config: { offset_days: 0, at_time: "09:00" } });
    expect(by.payment_overdue_3d.type).toBe("payment_after_due");
  });

  it("«Venta saldada» se guarda como sale_status_changed con to_status ['paid'] (no existe un tipo sale_settled)", () => {
    const thanks = SALES_FLOW_TEMPLATES.find((t) => t.key === "sale_settled_thanks")!;
    expect(thanks.trigger).toEqual({ type: "sale_status_changed", config: { to_status: ["paid"] } });
    expect(presetFor(thanks.trigger.type, thanks.trigger.config)?.label).toBe("Venta saldada");
  });

  it("todas las configuraciones de trigger son válidas (el 0 solo está permitido en «antes»)", () => {
    for (const t of SALES_FLOW_TEMPLATES) expect(validateSalesTriggerConfig(t.trigger.type, t.trigger.config).ok, t.key).toBe(true);
  });

  it("sin link de pago, con voseo y con las variables del registro", () => {
    for (const t of SALES_FLOW_TEMPLATES) {
      expect(t.body, t.key).not.toMatch(/https?:\/\/|\{\{\s*payment\.link/i);
      expect(t.body, t.key).toMatch(/\{\{contact\.first_name\}\}/);
      expect(`${t.subject} ${t.body}`, t.key).toMatch(/\{\{sale\.product_name\}\}/);
      expect(t.body, t.key).not.toMatch(/\btenés\b.*\btienes\b/);
    }
    expect(SALES_FLOW_TEMPLATES[0].body).toContain("ignorá este mensaje; si tenés dudas, respondé este email");
  });

  it("el grafo usa el alias exacto del registro y pasa por la puerta «no contactar»", () => {
    for (const t of SALES_FLOW_TEMPLATES) {
      const g = salesTemplateGraph(t);
      const email = g.nodes.find((n) => n.id === "email")!;
      expect(resolveNodeType({ type: email.type, data: email.data }), t.key).toBe("send_email");
      const gate = g.nodes.find((n) => n.id === "gate")!;
      expect(gate.data.conditions).toEqual([{ field: "do_not_contact", operator: "equals", value: "false" }]);
      expect(g.edges.find((e) => e.target === "email")?.sourceHandle).toBe("true");
      const trigger = g.nodes.find((n) => n.id === "trigger")!;
      expect(trigger.data.triggerType).toBe(t.trigger.type);
    }
    const overdue = salesTemplateGraph(SALES_FLOW_TEMPLATES.find((t) => t.key === "payment_overdue_3d")!);
    expect(overdue.nodes.find((n) => n.id === "whatsapp")?.data).toMatchObject({ onlyIfPhone: true });
  });
});

describe("ensureSalesTemplateFlows", () => {
  const ws = "ws-1";
  const make = (autoCreate: boolean | undefined) => memoryDb({ workspaces: [{ id: ws, sales_auto_create_flows: autoCreate }], flows: [] });

  it("con la opción activa crea los 4, todos apagados; correrla dos veces no duplica", async () => {
    const db = make(true);
    expect(await ensureSalesTemplateFlows(db.client, ws)).toBe(4);
    expect(await ensureSalesTemplateFlows(db.client, ws)).toBe(0);
    const flows = db.rows("flows");
    expect(flows).toHaveLength(4);
    expect(flows.every((f) => f.status === "draft")).toBe(true);
    expect(flows.map((f) => f.template_key).sort()).toEqual([...SALES_TEMPLATE_KEYS].sort());
    expect(db.rows("triggers")).toHaveLength(0); // sin fila de triggers: no pueden disparar
  });

  it("con la opción apagada no crea ninguno (salvo que se fuerce al prenderla)", async () => {
    const db = make(false);
    expect(await ensureSalesTemplateFlows(db.client, ws)).toBe(0);
    expect(db.rows("flows")).toHaveLength(0);
    expect(await ensureSalesTemplateFlows(db.client, ws, { force: true })).toBe(4);
  });

  it("repone solo los que faltan", async () => {
    const db = make(true);
    await ensureSalesTemplateFlows(db.client, ws);
    db.tables.flows = db.rows("flows").filter((f) => f.template_key !== "payment_due_today");
    expect(await ensureSalesTemplateFlows(db.client, ws)).toBe(1);
    expect(db.rows("flows")).toHaveLength(4);
  });
});
