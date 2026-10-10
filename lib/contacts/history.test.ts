import { describe, expect, it } from "vitest";
import { buildContactHistory, describeHistoryItem, type BuildHistoryInput, type EmailHistoryItem, type FlowHistoryItem, type SequenceHistoryItem } from "./history";

const base = (over: Partial<BuildHistoryInput> = {}): BuildHistoryInput => ({
  audit: [],
  flowEvents: [],
  enrollments: [],
  emails: [],
  flowNames: new Map([["f-1", "Bienvenida"]]),
  ...over,
});

const audit = (id: string, at: string, action = "update", metadata: Record<string, unknown> | null = null) => ({
  id, action: action as never, changes: null, metadata: metadata as never, performedAt: at, actorLabel: "Ana",
});

describe("buildContactHistory", () => {
  it("junta todas las fuentes en un solo orden, lo mas nuevo primero", () => {
    const items = buildContactHistory(
      base({
        audit: [audit("a1", "2026-10-09T10:00:00Z")],
        flowEvents: [{ id: "e1", eventType: "flow_completed", flowId: "f-1", createdAt: "2026-10-09T12:00:00Z" }],
        enrollments: [{ id: "n1", sequenceName: "Nurturing", enrolledAt: "2026-10-09T11:00:00Z", completedAt: null }],
        emails: [{ id: "m1", toEmail: "a@x.com", subject: "Tu reunión", status: "sent", relatedEntityType: "flow", relatedEntityId: "f-1", createdAt: "2026-10-09T09:00:00Z" }],
      }),
    );
    expect(items.map((i) => i.source)).toEqual(["flow", "sequence", "audit", "email"]);
  });

  it("una automatizacion se cuenta una sola vez: el audit y el motor la anotan con segundos de diferencia", () => {
    const items = buildContactHistory(
      base({
        audit: [audit("a1", "2026-10-09T10:00:02Z", "automation_triggered", { flow_id: "f-1", trigger_id: "t-1" })],
        flowEvents: [{ id: "e1", eventType: "flow_started", flowId: "f-1", createdAt: "2026-10-09T10:00:00Z" }],
      }),
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ source: "flow", phase: "started", flowName: "Bienvenida" });
  });

  it("si el motor no la anoto, el audit se queda, ahora con el NOMBRE de la automatizacion", () => {
    const items = buildContactHistory(
      base({ audit: [audit("a1", "2026-10-09T10:00:00Z", "automation_triggered", { flow_id: "f-1" })] }),
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ source: "audit", flowName: "Bienvenida" });
  });

  it("la misma automatizacion otro dia es otra ejecucion: no se descarta", () => {
    const items = buildContactHistory(
      base({
        audit: [audit("a1", "2026-10-08T10:00:00Z", "automation_triggered", { flow_id: "f-1" })],
        flowEvents: [{ id: "e1", eventType: "flow_started", flowId: "f-1", createdAt: "2026-10-09T10:00:00Z" }],
      }),
    );
    expect(items).toHaveLength(2);
  });

  it("de los eventos del motor solo cuentan empezar y terminar (node_executed seria ruido)", () => {
    const items = buildContactHistory(
      base({
        flowEvents: [
          { id: "e1", eventType: "node_executed", flowId: "f-1", createdAt: "2026-10-09T10:00:00Z" },
          { id: "e2", eventType: "contact_created", flowId: null, createdAt: "2026-10-09T10:00:00Z" },
          { id: "e3", eventType: "flow_started", flowId: "f-1", createdAt: "2026-10-09T10:00:00Z" },
        ],
      }),
    );
    expect(items.map((i) => (i as FlowHistoryItem).phase)).toEqual(["started"]);
  });

  it("una secuencia deja dos entradas si ya termino: se inscribio y completo", () => {
    const items = buildContactHistory(
      base({ enrollments: [{ id: "n1", sequenceName: "Nurturing", enrolledAt: "2026-10-01T10:00:00Z", completedAt: "2026-10-05T10:00:00Z" }] }),
    );
    expect(items.map((i) => (i as SequenceHistoryItem).phase)).toEqual(["completed", "enrolled"]);
  });

  it("un flow borrado no rompe: queda sin nombre", () => {
    const items = buildContactHistory(
      base({ flowEvents: [{ id: "e1", eventType: "flow_started", flowId: "f-borrado", createdAt: "2026-10-09T10:00:00Z" }] }),
    );
    expect(items[0]).toMatchObject({ flowName: null });
    expect(describeHistoryItem(items[0] as FlowHistoryItem).text).toContain("(borrada)");
  });

  it("el limite corta lo mas viejo, no lo mas nuevo", () => {
    const items = buildContactHistory(
      base({ audit: [audit("a1", "2026-10-01T00:00:00Z"), audit("a2", "2026-10-03T00:00:00Z"), audit("a3", "2026-10-02T00:00:00Z")], limit: 2 }),
    );
    expect(items.map((i) => i.id)).toEqual(["audit:a2", "audit:a3"]);
  });

  it("un estado de email raro no rompe: cuenta como fallido", () => {
    const items = buildContactHistory(
      base({ emails: [{ id: "m1", toEmail: "a@x.com", subject: "S", status: "otra-cosa", relatedEntityType: null, relatedEntityId: null, createdAt: "2026-10-09T10:00:00Z" }] }),
    );
    expect((items[0] as EmailHistoryItem).status).toBe("failed");
  });
});

describe("describeHistoryItem", () => {
  const email = (status: EmailHistoryItem["status"], flowName: string | null = "Confirmación"): EmailHistoryItem => ({
    source: "email", id: "e", at: "x", to: "ana@x.com", subject: "Tu reunión", status, flowName,
  });

  it("un email que salio dice a quien, el asunto y que automatizacion lo mando", () => {
    expect(describeHistoryItem(email("sent"))).toEqual({
      actor: "El sistema",
      text: "mandó el email «Tu reunión» a ana@x.com (automatización «Confirmación»)",
    });
  });

  it("un email que no salio lo dice, y por que", () => {
    expect(describeHistoryItem(email("failed")).text).toContain("no pudo mandar el email");
    expect(describeHistoryItem(email("skipped_not_configured")).text).toContain("el correo no está conectado");
  });

  it("sin saber que flow lo mando, no inventa uno", () => {
    expect(describeHistoryItem(email("sent", null)).text).toBe("mandó el email «Tu reunión» a ana@x.com");
  });

  it("las secuencias y las automatizaciones, en castellano", () => {
    expect(describeHistoryItem({ source: "sequence", id: "s", at: "x", phase: "enrolled", sequenceName: "Nurturing" }).text).toBe("lo inscribió en la secuencia «Nurturing»");
    expect(describeHistoryItem({ source: "flow", id: "f", at: "x", phase: "started", flowName: "Bienvenida" }).text).toBe("ejecutó la automatización «Bienvenida»");
    expect(describeHistoryItem({ source: "flow", id: "f", at: "x", phase: "completed", flowName: "Bienvenida" }).text).toBe("terminó la automatización «Bienvenida»");
  });
});
