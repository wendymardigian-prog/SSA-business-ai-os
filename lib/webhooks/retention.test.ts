import { describe, expect, it } from "vitest";
import { FINISHED_JOB_STATUSES, FINISHED_SESSION_STATUSES, retentionAction, retentionCutoffs, stripJobPayloadCopies, stripWebhookCopies } from "./retention";

const NOW = new Date("2026-10-12T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

describe("retentionAction", () => {
  it("bordes: 89 conserva, 90 vacia, 365 vacia, 366 borra", () => {
    expect(retentionAction(daysAgo(89), NOW)).toBe("keep");
    expect(retentionAction(daysAgo(90), NOW)).toBe("clear_payload");
    expect(retentionAction(daysAgo(365), NOW)).toBe("clear_payload");
    expect(retentionAction(daysAgo(366), NOW)).toBe("delete");
  });
  it("una fecha ilegible se conserva", () => {
    expect(retentionAction("nada", NOW)).toBe("keep");
  });
  it("los cortes de las consultas coinciden con los bordes", () => {
    const { clearBefore, deleteBefore } = retentionCutoffs(NOW);
    expect(new Date(clearBefore).getTime()).toBe(daysAgo(90).getTime());
    expect(new Date(deleteBefore).getTime()).toBe(daysAgo(366).getTime());
  });
});

describe("stripWebhookCopies (la copia del envío en las variables de la sesión)", () => {
  const variables = {
    message: "hola",
    contact_result: "created",
    webhook: { id: "in-1", endpoint_id: "ep-1", endpoint_name: "Typeform", received_at: "2026-07-01T10:00:00Z", reprocess_count: 2, payload: { email: "ana@example.com", data: { name: "Ana" } }, query: { utm_source: "fb" } },
  };

  it("vacía payload y query y deja todo lo demás del envío y de las variables", () => {
    const out = stripWebhookCopies(variables);
    expect(out.changed).toBe(true);
    expect(out.value).toEqual({
      message: "hola",
      contact_result: "created",
      webhook: { id: "in-1", endpoint_id: "ep-1", endpoint_name: "Typeform", received_at: "2026-07-01T10:00:00Z", reprocess_count: 2, payload: {}, query: {} },
    });
  });

  it("no muta lo que recibe", () => {
    const copy = JSON.parse(JSON.stringify(variables));
    stripWebhookCopies(variables);
    expect(variables).toEqual(copy);
  });

  it("si solo la query tiene datos (un envío por GET), también la vacía", () => {
    const out = stripWebhookCopies({ webhook: { payload: {}, query: { email: "a@b.com" } } });
    expect(out).toEqual({ value: { webhook: { payload: {}, query: {} } }, changed: true });
  });

  it("lo que ya está vacío, o no es de un webhook, no se toca (no hace falta escribir)", () => {
    expect(stripWebhookCopies({ webhook: { payload: {}, query: {} } }).changed).toBe(false);
    expect(stripWebhookCopies({ webhook: { id: "in-1" } }).changed).toBe(false);
    expect(stripWebhookCopies({ message: "hola" }).changed).toBe(false);
    expect(stripWebhookCopies(null).changed).toBe(false);
    expect(stripWebhookCopies("texto").changed).toBe(false);
    expect(stripWebhookCopies({ webhook: "no es un objeto" }).changed).toBe(false);
  });

  it("una copia con una forma rara (lista o texto) también se vacía: nunca queda un dato personal", () => {
    expect(stripWebhookCopies({ webhook: { payload: ["a@b.com"], query: {} } }).changed).toBe(true);
    expect(stripWebhookCopies({ webhook: { payload: "a@b.com", query: {} } }).changed).toBe(true);
  });
});

describe("stripJobPayloadCopies (la copia del envío en un job resume_flow)", () => {
  const payload = { sessionId: "s-1", nodeId: "n-1", contactId: null, variables: { webhook: { id: "in-1", payload: { email: "a@b.com" }, query: { q: "1" } } } };

  it("vacía la copia dentro de variables y conserva el resto del job", () => {
    const out = stripJobPayloadCopies(payload);
    expect(out.changed).toBe(true);
    expect(out.value).toEqual({ sessionId: "s-1", nodeId: "n-1", contactId: null, variables: { webhook: { id: "in-1", payload: {}, query: {} } } });
  });

  it("un job sin variables o sin copia queda igual", () => {
    expect(stripJobPayloadCopies({ sessionId: "s-1" }).changed).toBe(false);
    expect(stripJobPayloadCopies({ variables: {} }).changed).toBe(false);
    expect(stripJobPayloadCopies({ variables: { webhook: { payload: {}, query: {} } } }).changed).toBe(false);
    expect(stripJobPayloadCopies(null).changed).toBe(false);
  });

  it("los estados terminados no incluyen lo que sigue vivo", () => {
    expect(FINISHED_SESSION_STATUSES).not.toContain("active");
    expect(FINISHED_JOB_STATUSES).not.toContain("pending");
    expect(FINISHED_JOB_STATUSES).not.toContain("processing");
  });
});
