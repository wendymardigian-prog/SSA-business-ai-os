import { describe, it, expect } from "vitest";
import { evaluateDrop, needsCancelModal, isDraggable, DEFAULT_COLLAPSED_COLUMNS, isHistoryColumn } from "./kanban";

const now = new Date("2026-10-06T16:00:00.000Z");
const futura = { status: "scheduled" as const, start_at: "2026-10-08T15:00:00.000Z" };
const pasada = { status: "scheduled" as const, start_at: "2026-10-06T14:00:00.000Z" };

describe("reglas de arrastre (F34)", () => {
  it("arrastrar a Venta una agenda que no empezó se revierte con el motivo", () => {
    expect(evaluateDrop(futura, "sale", now)).toEqual({ ok: false, reason: "El resultado se carga después de la hora de inicio" });
  });

  it("de Agendada a No-show una agenda que ya pasó: ok, sin modal", () => {
    expect(evaluateDrop(pasada, "no_show", now)).toEqual({ ok: true, opensCancelModal: false });
  });

  it("soltar en Cancelada – no contesta abre el modal de cancelar", () => {
    expect(evaluateDrop(futura, "cancelled_no_response", now)).toEqual({ ok: true, opensCancelModal: true });
    expect(needsCancelModal("cancelled_other")).toBe(true);
    expect(needsCancelModal("confirmed")).toBe(false);
  });

  it("una tarjeta de una columna de cancelación no se mueve", () => {
    expect(isDraggable({ status: "cancelled_other" })).toBe(false);
    expect(isDraggable({ status: "sale" })).toBe(true);
    expect(evaluateDrop({ status: "cancelled_other", start_at: pasada.start_at }, "confirmed", now)).toMatchObject({ ok: false });
  });

  it("las 3 de cancelación arrancan contraídas y son columnas de historial", () => {
    expect(DEFAULT_COLLAPSED_COLUMNS).toEqual(["cancelled_not_qualified", "cancelled_no_response", "cancelled_other"]);
    expect(isHistoryColumn("sale")).toBe(true);
    expect(isHistoryColumn("scheduled")).toBe(false);
  });
});
