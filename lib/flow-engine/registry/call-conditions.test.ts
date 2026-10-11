/**
 * Las condiciones de Llamadas (F32). Lo que mas importa: sin llamada analizada
 * devuelven vacio, asi "el resultado de la ultima llamada es venta" no dice que
 * si por no haber ninguna.
 */
import { describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import "./index";
import { matchConditionField } from "./registry";
import type { FlowExecutionContext } from "../types";

const WS = "ws-1";
const CONTACT = "c-1";
const context = { workspaceId: WS, contactId: CONTACT } as unknown as FlowExecutionContext;

const call = (over: Record<string, unknown>) => ({
  id: `call-${Math.random()}`,
  workspace_id: WS,
  contact_id: CONTACT,
  analysis_status: "analyzed",
  archived_at: null,
  recorded_at: "2026-10-01T00:00:00Z",
  outcome: null,
  lead_score: null,
  call_type: null,
  ...over,
});

async function resolve(prefix: string, db: ReturnType<typeof memoryDb>) {
  const match = matchConditionField(prefix);
  expect(match, `falta el campo ${prefix}`).toBeDefined();
  return match!.definition.resolve({ supabase: db.client, argument: match!.argument, context, contact: {} });
}

describe("las tres condiciones de la ultima llamada analizada", () => {
  const db = () =>
    memoryDb({
      calls: [
        call({ recorded_at: "2026-09-20T00:00:00Z", outcome: "no_venta", lead_score: 30, call_type: "triaje" }),
        call({ recorded_at: "2026-10-05T00:00:00Z", outcome: "venta", lead_score: 88, call_type: "cierre" }),
        // Mas nueva pero sin analizar, de otro contacto y archivada: ninguna cuenta.
        call({ recorded_at: "2026-10-09T00:00:00Z", analysis_status: "pending", outcome: "x" }),
        call({ recorded_at: "2026-10-09T00:00:00Z", contact_id: "otro", outcome: "y" }),
        call({ recorded_at: "2026-10-09T00:00:00Z", archived_at: "2026-10-09T01:00:00Z", outcome: "z" }),
      ],
    });

  it("devuelven el resultado, el puntaje del lead y el tipo de la ULTIMA analizada", async () => {
    expect(await resolve("last_call_outcome:", db())).toBe("venta");
    expect(await resolve("last_call_lead_score:", db())).toBe("88");
    expect(await resolve("last_call_type:", db())).toBe("cierre");
  });

  it("sin ninguna llamada analizada devuelven vacio", async () => {
    const empty = memoryDb({ calls: [call({ analysis_status: "pending", outcome: "venta" })] });
    expect(await resolve("last_call_outcome:", empty)).toBe("");
    expect(await resolve("last_call_lead_score:", empty)).toBe("");
    expect(await resolve("last_call_type:", empty)).toBe("");
  });

  it("una llamada analizada sin puntaje de lead da vacio, no 'null'", async () => {
    const d = memoryDb({ calls: [call({ outcome: "venta", lead_score: null })] });
    expect(await resolve("last_call_lead_score:", d)).toBe("");
  });
});
