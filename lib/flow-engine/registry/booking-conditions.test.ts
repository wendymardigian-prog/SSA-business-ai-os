/**
 * Las condiciones de agenda (F45).
 *
 * Lo que más importa acá: "resultado de la última reunión" devuelve vacío
 * mientras nadie cargó el resultado. Si devolviera "Agendada", una comparación
 * con "venta" diría que no sin haber preguntado nunca.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import "./index";
import { matchConditionField } from "./registry";
import type { FlowExecutionContext } from "../types";

const WS = "ws-1";
const CONTACT = "c-1";
const NOW = new Date("2026-10-01T12:00:00.000Z");

function world(bookings: Array<Record<string, unknown>>) {
  return memoryDb({
    bookings: bookings.map((b, i) => ({
      id: `bk-${i}`,
      workspace_id: WS,
      contact_id: CONTACT,
      event_type_id: "ev-1",
      category_snapshot: { area_id: "area-ventas", type_id: "tipo-triaje" },
      ...b,
    })),
  });
}

const context = { workspaceId: WS, contactId: CONTACT } as unknown as FlowExecutionContext;

// "Por venir" se mide contra el reloj: se fija para que el test no cambie de
// resultado con el paso de los dias.
beforeEach(() => vi.setSystemTime(NOW));

async function resolve(prefix: string, argument: string, db: ReturnType<typeof memoryDb>) {
  const match = matchConditionField(`${prefix}${argument}`);
  expect(match, `falta el campo ${prefix}`).toBeDefined();
  return match!.definition.resolve({ supabase: db.client, argument: match!.argument, context, contact: {} });
}

describe("has_upcoming_booking", () => {
  it("una reunión activa y futura cuenta", async () => {
    const db = world([{ status: "scheduled", start_at: "2026-10-05T15:00:00.000Z" }]);
    await expect(resolve("has_upcoming_booking:", "", db)).resolves.toBe("true");
  });

  it("una reunión de ayer que sigue en 'Agendada' NO cuenta como próxima", async () => {
    const db = world([{ status: "scheduled", start_at: "2026-09-30T15:00:00.000Z" }]);
    await expect(resolve("has_upcoming_booking:", "", db)).resolves.toBe("false");
  });

  it("una cancelada futura no cuenta", async () => {
    const db = world([{ status: "cancelled_other", start_at: "2026-10-05T15:00:00.000Z" }]);
    await expect(resolve("has_upcoming_booking:", "", db)).resolves.toBe("false");
  });

  it("el argumento acota por área, tipo o evento", async () => {
    const db = world([{ status: "scheduled", start_at: "2026-10-05T15:00:00.000Z" }]);
    await expect(resolve("has_upcoming_booking:", "area-ventas", db)).resolves.toBe("true");
    await expect(resolve("has_upcoming_booking:", "tipo-triaje", db)).resolves.toBe("true");
    await expect(resolve("has_upcoming_booking:", "ev-1", db)).resolves.toBe("true");
    await expect(resolve("has_upcoming_booking:", "area-servicio", db)).resolves.toBe("false");
  });

  it("sin reuniones, false", async () => {
    await expect(resolve("has_upcoming_booking:", "", world([]))).resolves.toBe("false");
  });
});

describe("last_booking_status", () => {
  it("es el estado de la más reciente", async () => {
    const db = world([
      { status: "sale", start_at: "2026-09-20T15:00:00.000Z" },
      { status: "scheduled", start_at: "2026-10-05T15:00:00.000Z" },
    ]);
    await expect(resolve("last_booking_status:", "", db)).resolves.toBe("scheduled");
  });

  it("sin reuniones, vacío", async () => {
    await expect(resolve("last_booking_status:", "", world([]))).resolves.toBe("");
  });
});

describe("last_booking_result", () => {
  it("una reunión que todavía no tiene resultado devuelve vacío", async () => {
    const db = world([{ status: "scheduled", start_at: "2026-10-05T15:00:00.000Z" }]);
    await expect(resolve("last_booking_result:", "", db)).resolves.toBe("");
  });

  it("devuelve el último resultado cargado, aunque después haya otra agendada", async () => {
    const db = world([
      { status: "sale", start_at: "2026-09-20T15:00:00.000Z" },
      { status: "scheduled", start_at: "2026-10-05T15:00:00.000Z" },
    ]);
    await expect(resolve("last_booking_result:", "", db)).resolves.toBe("sale");
  });

  it("un no-show también es un resultado", async () => {
    const db = world([{ status: "no_show", start_at: "2026-09-20T15:00:00.000Z" }]);
    await expect(resolve("last_booking_result:", "", db)).resolves.toBe("no_show");
  });
});

describe("no_show_count", () => {
  it("cuenta las faltas", async () => {
    const db = world([
      { status: "no_show", start_at: "2026-09-10T15:00:00.000Z" },
      { status: "no_show", start_at: "2026-09-20T15:00:00.000Z" },
      { status: "sale", start_at: "2026-09-25T15:00:00.000Z" },
    ]);
    await expect(resolve("no_show_count:", "", db)).resolves.toBe("2");
  });

  it("sin faltas, cero", async () => {
    await expect(resolve("no_show_count:", "", world([{ status: "sale", start_at: "2026-09-25T15:00:00.000Z" }]))).resolves.toBe("0");
  });
});
