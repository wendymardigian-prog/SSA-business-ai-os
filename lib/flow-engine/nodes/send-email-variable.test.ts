/**
 * D4: «Enviar email» a la dirección de una variable (`{{webhook.body.email}}`). No necesita contacto; se valida al
 * correr; una dirección inválida o de un contacto «no contactar» se saltea con el motivo.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";
import type { FlowExecutionContext } from "../types";
import { nodeNeedsContact } from "../contact-requirement";

const { sendTransactionalEmail } = vi.hoisted(() => ({ sendTransactionalEmail: vi.fn(async (..._args: unknown[]) => ({ ok: true as const, id: "msg-1" })) }));
vi.mock("@/lib/email/send", () => ({ sendTransactionalEmail }));
vi.mock("@/lib/notifications/create", () => ({ createNotification: vi.fn(async () => true) }));

import { sendEmailNode, EMAIL_ADDRESS_RE } from "./send-email";

const WS = "ws-1";
let db: MemoryDb;
let skipped: string[] = [];

const ctx = (over: Partial<FlowExecutionContext> = {}): FlowExecutionContext => ({
  triggerId: "t",
  flowId: "flow-1",
  channelId: "",
  contactId: null,
  conversationId: "",
  workspaceId: WS,
  incomingMessage: {},
  variables: { webhook: { body: { email: "Lead@Ejemplo.com", otro: "no-es-un-email" } } },
  onStepSkipped: (s) => skipped.push(s.label),
  ...over,
});

const run = (data: Record<string, unknown>, context = ctx()) =>
  sendEmailNode.execute({
    supabase: db.client,
    node: { id: "n1", type: "action", position: { x: 0, y: 0 }, data: {} } as never,
    data: { subject: "Gracias", body: "Hola", ...data },
    context,
    sessionId: "s",
    runtime: { executeFlow: async () => {} },
  } as never);

const events = () => db.rows("analytics_events").filter((e) => e.event_type === "node_skipped");

beforeEach(() => {
  sendTransactionalEmail.mockClear();
  skipped = [];
  db = memoryDb({
    contacts: [
      { id: "c-ok", workspace_id: WS, email: "ok@ejemplo.com", secondary_email: null, do_not_contact: false, deleted_at: null },
      { id: "c-dnc", workspace_id: WS, email: "baja@ejemplo.com", secondary_email: null, do_not_contact: true, deleted_at: null },
      { id: "c-dnc2", workspace_id: WS, email: "otro@ejemplo.com", secondary_email: "Segundo@Ejemplo.com", do_not_contact: true, deleted_at: null },
      { id: "c-dnc-otro-ws", workspace_id: "ws-otro", email: "lead@ejemplo.com", secondary_email: null, do_not_contact: true, deleted_at: null },
    ],
    email_log: [],
    analytics_events: [],
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("Enviar email a una dirección de una variable", () => {
  it("manda a la dirección de la variable, sin contacto en el flujo", async () => {
    await run({ to: "variable", toVariable: "{{webhook.body.email}}" });
    expect(sendTransactionalEmail).toHaveBeenCalledTimes(1);
    expect(sendTransactionalEmail.mock.calls[0][0]).toMatchObject({ workspaceId: WS, to: "Lead@Ejemplo.com", kind: "flow", contactId: null });
  });

  it("acepta la variable sin las llaves", async () => {
    await run({ to: "variable", toVariable: "webhook.body.email" });
    expect(sendTransactionalEmail).toHaveBeenCalledTimes(1);
  });

  it("no necesita contacto (el editor no pide «Crear o actualizar contacto» antes)", () => {
    expect(sendEmailNode.needsContact).toBe(false);
    expect(nodeNeedsContact({ type: "action", data: { actionType: "send_email", to: "variable", toVariable: "webhook.body.email" } })).toBe(false);
    // Lo de siempre sigue igual: sin `to` el email va al contacto.
    expect(nodeNeedsContact({ type: "action", data: { actionType: "send_email" } })).toBe(true);
  });

  it("variable vacía, inexistente o sin elegir: se saltea con el motivo y avisa", async () => {
    for (const toVariable of ["{{webhook.body.no_existe}}", "", undefined]) {
      sendTransactionalEmail.mockClear();
      skipped = [];
      db.tables.analytics_events.length = 0;
      await run({ to: "variable", toVariable });
      expect(sendTransactionalEmail, String(toVariable)).not.toHaveBeenCalled();
      expect(events(), String(toVariable)).toHaveLength(1);
      expect(events()[0].metadata).toMatchObject({ nodeId: "n1", nodeType: "send_email", reason: expect.any(String) });
      expect(skipped).toEqual(["Enviar email"]);
    }
  });

  it("si no es un email válido, se saltea con el motivo", async () => {
    await run({ to: "variable", toVariable: "{{webhook.body.otro}}" });
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
    expect(events()[0].metadata).toMatchObject({ reason: expect.stringContaining("no tiene un email válido") });
  });

  it("la dirección de un contacto «no contactar» no recibe el email (principal o segundo, sin importar mayúsculas)", async () => {
    await run({ to: "variable", toVariable: "{{d}}" }, ctx({ variables: { d: "BAJA@ejemplo.com" } }));
    await run({ to: "variable", toVariable: "{{d}}" }, ctx({ variables: { d: "segundo@ejemplo.com" } }));
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
    expect(events()).toHaveLength(2);
    expect(events()[0].metadata).toMatchObject({ reason: expect.stringContaining("no contactar") });
  });

  it("un contacto sin la marca, o «no contactar» de OTRO workspace, no frena el envío", async () => {
    await run({ to: "variable", toVariable: "{{d}}" }, ctx({ variables: { d: "ok@ejemplo.com" } }));
    await run({ to: "variable", toVariable: "{{webhook.body.email}}" }); // lead@ejemplo.com: solo es «no contactar» en ws-otro
    expect(sendTransactionalEmail).toHaveBeenCalledTimes(2);
  });

  it("un error de la base al comprobar «no contactar» NO se toma como «no es de nadie»: no se manda", async () => {
    const real = db.client;
    const failing = {
      ...real,
      from: (table: string) => {
        if (table !== "contacts") return real.from(table as never);
        const chain: Record<string, unknown> = {};
        for (const m of ["select", "eq", "is", "limit", "ilike"]) chain[m] = () => chain;
        chain.then = (resolve: (v: unknown) => void) => resolve({ data: null, error: { code: "XX000", message: "db caida" } });
        return chain;
      },
    };
    db = { ...db, client: failing as never };
    await run({ to: "variable", toVariable: "{{webhook.body.email}}" });
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
    expect(events()[0].metadata).toMatchObject({ reason: expect.stringContaining("No pude comprobar") });
  });

  it("los demás destinos no cambian (dirección fija sigue mandando igual)", async () => {
    await run({ to: "fixed", fixedEmail: "equipo@negocio.com" });
    expect(sendTransactionalEmail.mock.calls[0][0]).toMatchObject({ to: "equipo@negocio.com" });
  });
});

describe("EMAIL_ADDRESS_RE", () => {
  it("acepta direcciones normales y rechaza lo que podría romper un filtro o no es un email", () => {
    for (const ok of ["a@b.co", "ana.perez+x@mi-negocio.com.ar"]) expect(EMAIL_ADDRESS_RE.test(ok), ok).toBe(true);
    for (const bad of ["", "sin-arroba", "a@b", "a b@c.com", "a@b.com,id.eq.1", "a@b.com;x", "<a@b.com>", "a@(b).com", 'a"@b.com']) expect(EMAIL_ADDRESS_RE.test(bad), bad).toBe(false);
  });
});
