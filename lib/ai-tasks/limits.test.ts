import { describe, expect, it } from "vitest";
import { capStatus, parseCapInput, taskLimitsOf } from "./limits";

describe("tope mensual por tarea", () => {
  it("lee lo guardado y cualquier cosa rara es «sin tope», nunca 0", () => {
    expect(taskLimitsOf({ call_analysis: { monthly_cap_usd: 30 } }, "call_analysis")).toEqual({ monthlyCapUsd: 30 });
    expect(taskLimitsOf({ call_analysis: { monthly_cap_usd: "12.5" } }, "call_analysis")).toEqual({ monthlyCapUsd: 12.5 });
    expect(taskLimitsOf({ call_analysis: { monthly_cap_usd: -1 } }, "call_analysis")).toEqual({ monthlyCapUsd: null });
    expect(taskLimitsOf({}, "call_analysis")).toEqual({ monthlyCapUsd: null });
    expect(taskLimitsOf(null, "call_analysis")).toEqual({ monthlyCapUsd: null });
    expect(taskLimitsOf([], "call_analysis")).toEqual({ monthlyCapUsd: null });
  });

  it("el semáforo: verde, amarillo desde el 80 % y rojo al llegar", () => {
    expect(capStatus(null, 5).light).toBeNull();
    expect(capStatus(10, null).light).toBeNull();
    expect(capStatus(10, 7.9).light).toBe("green");
    expect(capStatus(10, 8).light).toBe("yellow");
    expect(capStatus(10, 10).light).toBe("red");
    expect(capStatus(0, 0).light).toBe("green");
    expect(capStatus(0, 0.01).light).toBe("red");
  });

  it("el formulario: vacío quita el tope, admite coma y rechaza lo que no es un monto", () => {
    expect(parseCapInput("")).toEqual({ ok: true, monthlyCapUsd: null });
    expect(parseCapInput("12,345")).toEqual({ ok: true, monthlyCapUsd: 12.35 });
    expect(parseCapInput("-3").ok).toBe(false);
    expect(parseCapInput("abc").ok).toBe(false);
    expect(parseCapInput("100001").ok).toBe(false);
  });
});
