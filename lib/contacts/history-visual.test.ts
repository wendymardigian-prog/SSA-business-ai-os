import { describe, expect, it } from "vitest";
import type { HistoryItem } from "./history";
import { auditCategory, deliveryTone, historyVisual } from "./history-visual";

const base = { id: "x", at: "2026-11-10T00:00:00Z" };

describe("historyVisual", () => {
  it("una categoria por cada origen que no es del audit", () => {
    const items: Array<[HistoryItem, string, string]> = [
      [{ ...base, source: "flow", phase: "started", flowName: "A", pathLabel: null } as HistoryItem, "flow", "orange"],
      [{ ...base, source: "sequence", phase: "enrolled", sequenceName: "S" } as HistoryItem, "sequence", "green"],
      [
        { ...base, source: "email", to: "a@b.c", subject: "s", status: "sent", flowName: null, delivery: [] } as HistoryItem,
        "email",
        "sky",
      ],
      [
        { ...base, source: "status", role: "setter", oldLabel: null, newLabel: "x", actorLabel: "a", reason: null } as HistoryItem,
        "status",
        "amber",
      ],
      [
        { ...base, source: "qualification", oldLabel: null, newLabel: "4", actorLabel: "a", reason: null } as HistoryItem,
        "qualification",
        "amber",
      ],
    ];
    for (const [item, category, tone] of items) {
      expect(historyVisual(item)).toEqual({ category, tone });
    }
  });

  it("las acciones del audit salen del prefijo", () => {
    expect(auditCategory("booking.created")).toBe("booking");
    expect(auditCategory("booking.status_changed")).toBe("booking");
    expect(auditCategory("sale.paid")).toBe("sale");
    expect(auditCategory("payment.received")).toBe("sale");
    expect(auditCategory("call.analyzed")).toBe("call");
    expect(auditCategory("form.submitted")).toBe("form");
    expect(auditCategory("task.completed")).toBe("task");
    expect(auditCategory("design.created")).toBe("design");
    expect(auditCategory("design_template.created")).toBe("design");
    expect(auditCategory("contact.created")).toBe("contact");
    expect(auditCategory("assign")).toBe("assign");
    expect(auditCategory("automation_triggered")).toBe("flow");
    expect(auditCategory("agent_paused")).toBe("agent");
    expect(auditCategory("tag")).toBe("tag");
    expect(auditCategory("tag_effect")).toBe("tag");
    expect(auditCategory("email_status")).toBe("email");
    expect(auditCategory("setter_status")).toBe("status");
    expect(auditCategory("do_not_contact")).toBe("flag");
  });

  it("una accion que no se conoce no rompe: cae en other", () => {
    expect(auditCategory("algo_nuevo_que_nadie_vio")).toBe("other");
    expect(auditCategory("")).toBe("other");
  });
});

describe("deliveryTone", () => {
  it("colorea las marcas de entrega de un email", () => {
    expect(deliveryTone("Entregado")).toBe("good");
    expect(deliveryTone("Abrió (3)")).toBe("good");
    expect(deliveryTone("Clic")).toBe("good");
    expect(deliveryTone("Rebotó")).toBe("bad");
    expect(deliveryTone("Marcó spam")).toBe("bad");
    expect(deliveryTone("Se dio de baja")).toBe("warn");
    expect(deliveryTone("otra cosa")).toBe("neutral");
  });
});
