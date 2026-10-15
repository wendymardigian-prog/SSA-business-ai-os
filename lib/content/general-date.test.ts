import { describe, expect, it } from "vitest";
import { applyGeneralDate, generalDateOf, inheritGeneralDate } from "./general-date";
import type { NetworkEntry } from "./redistribution";

const T1 = "2026-10-20T15:00:00.000Z";
const T2 = "2026-10-21T15:00:00.000Z";

const net = (platform: string, planned_at: string | null = null): NetworkEntry =>
  ({ platform, planned_at, options: {} }) as unknown as NetworkEntry;

describe("fecha general de la pieza", () => {
  it("sin redes no hay donde guardarla", () => {
    expect(generalDateOf([])).toEqual({ mode: "none", at: null });
  });

  it("ninguna red con fecha: la general esta libre", () => {
    expect(generalDateOf([net("instagram"), net("tiktok")])).toEqual({ mode: "general", at: null });
  });

  it("todas con la misma fecha: esa es la general", () => {
    expect(generalDateOf([net("instagram", T1), net("tiktok", T1)])).toEqual({ mode: "general", at: T1 });
  });

  it("dos textos del mismo instante son la misma fecha", () => {
    expect(
      generalDateOf([net("instagram", "2026-10-20T15:00:00.000Z"), net("tiktok", "2026-10-20T15:00:00Z")]).mode,
    ).toBe("general");
  });

  it("una red con su propia fecha apaga la general", () => {
    expect(generalDateOf([net("instagram", T1), net("tiktok", T2)]).mode).toBe("per_network");
  });

  it("una red con fecha y otra sin ella: la fecha se asigna en cada red", () => {
    expect(generalDateOf([net("instagram", T1), net("tiktok")]).mode).toBe("per_network");
  });

  it("una red ya publicada no cuenta: su fecha es un hecho", () => {
    const closed = new Set(["instagram"]);
    expect(generalDateOf([net("instagram", T1), net("tiktok", T2)], closed)).toEqual({ mode: "general", at: T2 });
    expect(generalDateOf([net("instagram", T1)], closed).mode).toBe("none");
  });

  it("poner la general la escribe en todas las abiertas y no toca las cerradas", () => {
    const next = applyGeneralDate([net("instagram", T1), net("tiktok"), net("youtube", T2)], T2, new Set(["instagram"]));
    expect(next.map((n) => n.planned_at)).toEqual([T1, T2, T2]);
  });

  it("borrar la general deja las abiertas sin fecha", () => {
    expect(applyGeneralDate([net("instagram", T1), net("tiktok", T1)], null).map((n) => n.planned_at)).toEqual([
      null,
      null,
    ]);
  });

  it("no muta lo que recibe", () => {
    const input = [net("instagram", T1)];
    applyGeneralDate(input, T2);
    expect(input[0].planned_at).toBe(T1);
  });

  it("una red nueva hereda la general si hay una", () => {
    const current = [net("instagram", T1), net("tiktok", T1)];
    expect(inheritGeneralDate(net("threads"), current).planned_at).toBe(T1);
  });

  it("una red nueva no hereda nada si la fecha se asigna en cada red o no hay ninguna", () => {
    expect(inheritGeneralDate(net("threads"), [net("instagram", T1), net("tiktok", T2)]).planned_at).toBeNull();
    expect(inheritGeneralDate(net("threads"), [net("instagram")]).planned_at).toBeNull();
    expect(inheritGeneralDate(net("threads"), []).planned_at).toBeNull();
  });
});
