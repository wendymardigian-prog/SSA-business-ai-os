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
  no_show: false,
  category_snapshot: null,
  ...over,
});

async function resolve(prefix: string, db: ReturnType<typeof memoryDb>) {
  const match = matchConditionField(prefix);
  expect(match, `falta el campo ${prefix}`).toBeDefined();
  return match!.definition.resolve({ supabase: db.client, argument: match!.argument, context, contact: {} });
}

describe("area y tipo de la ultima llamada", () => {
  const snapshot = { area_id: "a1", area_name: "Servicio", type_id: "t1", type_name: "Onboarding" };
  const dbWith = (category_snapshot: unknown) => memoryDb({ calls: [call({ category_snapshot })] });
  it("salen de la clasificacion, por su nombre", async () => {
    expect(await resolve("last_call_area:", dbWith(snapshot))).toBe("Servicio");
    expect(await resolve("last_call_meeting_type:", dbWith(snapshot))).toBe("Onboarding");
  });
  it("sin clasificar o sin tipo devuelven vacio", async () => {
    const soloArea = { ...snapshot, type_id: null, type_name: null };
    expect(await resolve("last_call_area:", dbWith(soloArea))).toBe("Servicio");
    expect(await resolve("last_call_meeting_type:", dbWith(soloArea))).toBe("");
    expect(await resolve("last_call_area:", dbWith(null))).toBe("");
  });
});

describe("las tres condiciones de la ultima llamada analizada", () => {
  const db = () =>
    memoryDb({
      booking_categories: [
        { id: "a-v", workspace_id: WS, system_key: "ventas" },
        { id: "t-t", workspace_id: WS, system_key: "ventas.triaje" },
        { id: "t-c", workspace_id: WS, system_key: "ventas.cierre" },
      ],
      calls: [
        call({ recorded_at: "2026-09-20T00:00:00Z", outcome: "no_venta", lead_score: 30, category_snapshot: { area_id: "a-v", area_name: "Ventas", type_id: "t-t", type_name: "Triaje" } }),
        call({ recorded_at: "2026-10-05T00:00:00Z", outcome: "venta", lead_score: 88, category_snapshot: { area_id: "a-v", area_name: "Ventas", type_id: "t-c", type_name: "Cierre" } }),
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
