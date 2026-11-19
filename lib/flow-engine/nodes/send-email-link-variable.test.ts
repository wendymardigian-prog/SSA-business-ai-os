/**
 * Un enlace cuyo destino es una variable (`<a href="{{design.link}}">`): se completa al enviar y DESPUÉS la lista
 * blanca decide. Lo que no quedó como una dirección segura pierde el enlace y conserva el texto.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";
import type { FlowExecutionContext } from "../types";

const { sendTransactionalEmail } = vi.hoisted(() => ({ sendTransactionalEmail: vi.fn(async (..._args: unknown[]) => ({ ok: true as const, id: "msg-1" })) }));
vi.mock("@/lib/email/send", () => ({ sendTransactionalEmail }));
vi.mock("@/lib/notifications/create", () => ({ createNotification: vi.fn(async () => true) }));

import { sendEmailNode } from "./send-email";

const WS = "ws-1";
let db: MemoryDb;

const ctx = (variables: Record<string, unknown>): FlowExecutionContext => ({
  triggerId: "t",
  flowId: "flow-1",
  channelId: "",
  contactId: null,
  conversationId: "",
  workspaceId: WS,
  incomingMessage: {},
  variables,
});

const run = (body: string, variables: Record<string, unknown>) =>
  sendEmailNode.execute({
    supabase: db.client,
    node: { id: "n1", type: "action", position: { x: 0, y: 0 }, data: {} } as never,
    data: { subject: "Hola", body, to: "fixed", fixedEmail: "ana@ejemplo.com", category: "transactional" },
    context: ctx(variables),
    sessionId: "s",
    runtime: { executeFlow: async () => {} },
  } as never);

const sentHtml = () => String((sendTransactionalEmail.mock.calls.at(-1)?.[0] as { html?: string } | undefined)?.html ?? "");

beforeEach(() => {
  sendTransactionalEmail.mockClear();
  db = memoryDb({ contacts: [], email_log: [], analytics_events: [] });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("send_email: enlace a una variable", () => {
  it("una variable que es una dirección https queda como enlace con el texto elegido", async () => {
    await run('<p><a href="{{design.link}}">REVISAR Y FIRMAR MI CONTRATO</a></p>', { design: { link: "https://alma.example/d/ABC?x=1&y=2" } });
    const html = sentHtml();
    expect(html).toMatch(/href="https:\/\/alma\.example\/d\/ABC\?x=1&(amp;)?y=2"/);
    expect(html).toContain("REVISAR Y FIRMAR MI CONTRATO");
  });

  it("una variable que no es una dirección segura pierde el enlace y conserva el texto", async () => {
    await run('<p><a href="{{datos.destino}}">Ver</a></p>', { datos: { destino: "javascript:alert(1)" } });
    const html = sentHtml();
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("href=");
    expect(html).toContain("Ver");
  });

  it("una variable que no existe no deja un enlace roto", async () => {
    await run('<p><a href="{{no.existe}}">Ver</a></p>', {});
    const html = sentHtml();
    expect(html).not.toContain("href=");
    expect(html).toContain("Ver");
  });
});
