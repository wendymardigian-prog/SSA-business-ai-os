/**
 * Los guiones de F56: el agente agendando de punta a punta.
 *
 * No pasa por el modelo: pasa por las herramientas, en el orden en que el
 * modelo las llamaría, contra una base en memoria. Lo que se prueba es lo que
 * el modelo no puede arreglar: que un horario propuesto exista de verdad, que
 * agendar dos veces no cree dos reuniones, que sin permiso de cancelar la
 * herramienta no esté, y que lo que hace el agente quede en el historial con
 * su nombre.
 *
 * Google y el modelo están simulados. No sale nada a la red.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { schedulingWorld, EVENT, WS, HOST } from "@/lib/scheduling/testing/world";
import { resetBusyCache } from "@/lib/scheduling/data/slots-input";
import { toAgentConfig } from "@/lib/agent/config";
import { agentRow } from "@/lib/agent/testing/fixtures";
import { toolsForAgent } from "../index";
import type { AgentToolContext } from "../types";
import { schedulingListEventsTool, schedulingGetSlotsTool, schedulingGetBookingTool } from "./read-tools";
import { schedulingBookTool, schedulingCancelTool, schedulingRescheduleTool, schedulingSendLinkTool } from "./action-tools";
import { buildSchedulingInstructions } from "./instructions";
import { schedulingSkillSchema } from "./config";

const NOW = new Date("2026-09-30T16:00:00.000Z");
const CONTACT = "c-1";

let db: ReturnType<typeof schedulingWorld>;

function agent(config: Record<string, unknown>) {
  return toAgentConfig(agentRow({ id: "agent-1", allowed_tools: [], tools_config: { scheduling: { habilitada: true, event_type_ids: [EVENT], ...config } } }));
}

function ctx(config: Record<string, unknown> = {}): AgentToolContext {
  const memo = new Map<string, unknown>();
  return {
    supabase: db.client,
    agent: agent(config),
    workspaceId: WS,
    conversationId: "cv-1",
    contactId: CONTACT,
    channelId: "ch-1",
    run: { runId: "run-1", step: async () => null } as unknown as AgentToolContext["run"],
    nonce: "n",
    turn: { memo },
  };
}

beforeEach(() => {
  vi.setSystemTime(NOW);
  resetBusyCache();
  db = schedulingWorld({
    contacts: [{ id: CONTACT, workspace_id: WS, display_name: "Ana", email: null, phone: "+5215512345678", timezone: null }],
  });
  db.tables.agents = [{ id: "agent-1", workspace_id: WS }];
});

describe("guion 1: el lead pregunta y el agente agenda", () => {
  it("lista, busca horarios, agenda y queda registrado", async () => {
    const lista = await schedulingListEventsTool.execute({ input: {}, config: {}, ctx: ctx() });
    expect(lista.ok).toBe(true);
    expect(lista.forModel).toContain("Llamada de triaje");

    const horarios = await schedulingGetSlotsTool.execute({ input: { event_type_id: EVENT }, config: {}, ctx: ctx() });
    expect(horarios.ok).toBe(true);
    // Los horarios vienen con su start_utc exacto: el modelo no inventa ninguno.
    const startUtc = /start_utc: (\S+)/.exec(horarios.forModel)?.[1];
    expect(startUtc).toBeTruthy();
    // La zona sale del teléfono mexicano, no de la del negocio.
    expect(horarios.detail).toMatchObject({ timezone: "America/Mexico_City", source: "phone" });

    const agendada = await schedulingBookTool.execute({
      input: { event_type_id: EVENT, start_utc: startUtc!, nombre: "Ana Test", email: "ana@ejemplo.com" },
      config: {},
      ctx: ctx(),
    });
    expect(agendada.ok).toBe(true);
    expect(db.rows("bookings")).toHaveLength(1);
    expect(db.rows("bookings")[0].origin).toBe("agent");

    // Queda en el historial con el nombre del agente: eso es lo que permite
    // ver en Acciones qué hizo y revertirlo.
    const entrada = db.rows("audit_log").find((a) => a.action === "booking.created" && a.performed_by_agent_id === "agent-1");
    expect(entrada).toBeTruthy();
    expect(entrada?.metadata).toMatchObject({ by: "agent", origin: "tool" });
  });

  it("llamar dos veces con el mismo horario agenda una sola vez", async () => {
    const shared = ctx();
    const horarios = await schedulingGetSlotsTool.execute({ input: { event_type_id: EVENT }, config: {}, ctx: shared });
    const startUtc = /start_utc: (\S+)/.exec(horarios.forModel)![1];

    const input = { event_type_id: EVENT, start_utc: startUtc, nombre: "Ana", email: "ana@ejemplo.com" };
    await schedulingBookTool.execute({ input, config: {}, ctx: shared });
    const segunda = await schedulingBookTool.execute({ input, config: {}, ctx: shared });

    expect(segunda.ok).toBe(true);
    expect(db.rows("bookings")).toHaveLength(1);
  });

  it("un evento que no está en la configuración no se ofrece ni se agenda", async () => {
    const otro = "11111111-1111-4111-8111-111111111111";
    const horarios = await schedulingGetSlotsTool.execute({ input: { event_type_id: otro }, config: {}, ctx: ctx() });
    expect(horarios.ok).toBe(false);
    expect(horarios.forModel).toContain("no está entre los que podés ofrecer");
  });
});

describe("guion 2: el horario se ocupó justo antes", () => {
  it("la herramienta lo dice en palabras y no crea nada", async () => {
    const horarios = await schedulingGetSlotsTool.execute({ input: { event_type_id: EVENT }, config: {}, ctx: ctx() });
    const startUtc = /start_utc: (\S+)/.exec(horarios.forModel)![1];

    // Alguien agenda ese mismo horario primero.
    await schedulingBookTool.execute({ input: { event_type_id: EVENT, start_utc: startUtc, nombre: "Otro", email: "otro@ejemplo.com" }, config: {}, ctx: ctx() });

    const segunda = await schedulingBookTool.execute({
      input: { event_type_id: EVENT, start_utc: startUtc, nombre: "Ana", email: "ana@ejemplo.com" },
      config: {},
      ctx: ctx(),
    });
    expect(segunda.ok).toBe(false);
    expect(segunda.forModel).toContain("se ocupó");
    expect(db.rows("bookings")).toHaveLength(1);
  });
});

describe("guion 3: el lead quiere cambiar o cancelar", () => {
  async function conReunion() {
    const horarios = await schedulingGetSlotsTool.execute({ input: { event_type_id: EVENT }, config: {}, ctx: ctx() });
    const startUtc = /start_utc: (\S+)/.exec(horarios.forModel)![1];
    await schedulingBookTool.execute({ input: { event_type_id: EVENT, start_utc: startUtc, nombre: "Ana", email: "ana@ejemplo.com" }, config: {}, ctx: ctx() });
    return startUtc;
  }

  it("sin permiso de cancelar, las herramientas no existen", async () => {
    const sinPermiso = agent({ puede_cancelar: false });
    const nombres = toolsForAgent(sinPermiso).map((t) => t.name);
    expect(nombres).toContain("scheduling_get_slots");
    expect(nombres).not.toContain("scheduling_cancel");
    expect(nombres).not.toContain("scheduling_reschedule");
  });

  it("con permiso, cancela y queda registrado con el nombre del agente", async () => {
    await conReunion();
    const result = await schedulingCancelTool.execute({ input: { motivo: "Le surgió un viaje" }, config: {}, ctx: ctx({ puede_cancelar: true }) });
    expect(result.ok).toBe(true);
    expect(db.rows("bookings")[0].status_group).toBe("cancelled");
    expect(db.rows("audit_log").some((a) => a.action === "booking.cancelled" && a.performed_by_agent_id === "agent-1")).toBe(true);
  });

  it("reagendar mueve la misma reunión", async () => {
    await conReunion();
    const otros = await schedulingGetSlotsTool.execute({ input: { event_type_id: EVENT, desde: "2026-10-02" }, config: {}, ctx: ctx() });
    const nuevo = /start_utc: (\S+)/.exec(otros.forModel)![1];

    const result = await schedulingRescheduleTool.execute({ input: { start_utc: nuevo }, config: {}, ctx: ctx({ puede_cancelar: true }) });
    expect(result.ok).toBe(true);
    expect(db.rows("bookings")).toHaveLength(1);
    expect(db.rows("bookings")[0].start_at).toBe(nuevo);
  });

  it("sin reunión por venir, lo dice y no rompe nada", async () => {
    const result = await schedulingCancelTool.execute({ input: {}, config: {}, ctx: ctx({ puede_cancelar: true }) });
    expect(result.ok).toBe(false);
    expect(result.forModel).toContain("no tiene ninguna reunión");
  });
});

describe("guion 4: el agente solo pasa el link", () => {
  it("con puede_agendar apagado, agendar no está y el link sí", () => {
    const soloLink = agent({ puede_agendar: false });
    const nombres = toolsForAgent(soloLink).map((t) => t.name);
    expect(nombres).not.toContain("scheduling_book");
    expect(nombres).toContain("scheduling_send_link");
  });

  it("el link que devuelve es el público del evento", async () => {
    const result = await schedulingSendLinkTool.execute({ input: { event_type_id: EVENT }, config: {}, ctx: ctx({ puede_agendar: false }) });
    expect(result.ok).toBe(true);
    expect(result.forModel).toContain("/calendario/wendy/llamada-de-triaje");
  });
});

describe("guion 5: qué tiene agendado", () => {
  it("el código público de la reunión NUNCA se le pasa al modelo", async () => {
    const horarios = await schedulingGetSlotsTool.execute({ input: { event_type_id: EVENT }, config: {}, ctx: ctx() });
    const startUtc = /start_utc: (\S+)/.exec(horarios.forModel)![1];
    await schedulingBookTool.execute({ input: { event_type_id: EVENT, start_utc: startUtc, nombre: "Ana", email: "ana@ejemplo.com" }, config: {}, ctx: ctx() });

    const uid = db.rows("bookings")[0].uid as string;
    const result = await schedulingGetBookingTool.execute({ input: {}, config: {}, ctx: ctx() });
    expect(result.ok).toBe(true);
    // Con ese código se cancela sin sesión: no puede terminar en un mensaje.
    expect(result.forModel).not.toContain(uid);
  });
});

describe("las instrucciones cambian con la configuración", () => {
  it("con permiso de agendar, le dice que agende; sin permiso, que pase el link", () => {
    const conPermiso = buildSchedulingInstructions(schedulingSkillSchema.parse({ habilitada: true, puede_agendar: true }));
    expect(conPermiso).toContain("`scheduling_book`");

    const sinPermiso = buildSchedulingInstructions(schedulingSkillSchema.parse({ habilitada: true, puede_agendar: false }));
    expect(sinPermiso).toContain("`scheduling_send_link`");
    expect(sinPermiso).not.toContain("agendalo con");
  });

  it("siempre prohíbe inventar un horario", () => {
    const texto = buildSchedulingInstructions(schedulingSkillSchema.parse({ habilitada: true }));
    expect(texto).toContain("NUNCA inventes un horario");
  });
});
