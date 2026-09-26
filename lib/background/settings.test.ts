import { describe, it, expect } from "vitest";
import { resolveBackgroundSettings, validateBackgroundSettings, DEFAULT_BACKGROUND_SETTINGS } from "./settings";

describe("configuración de tareas en segundo plano (F23)", () => {
  it("sin entrada usa los defaults (§13.1)", () => {
    expect(resolveBackgroundSettings({})).toEqual(DEFAULT_BACKGROUND_SETTINGS);
    expect(resolveBackgroundSettings(null).message_classification).toEqual({ mode: "batch", frequency: "daily", hour: "03:00", model: null });
  });
  it("mezcla lo guardado con los defaults", () => {
    const r = resolveBackgroundSettings({ conversation_summary: { mode: "batch", frequency: "hourly" } });
    expect(r.conversation_summary).toEqual({ mode: "batch", frequency: "hourly" });
    expect(r.close_classification).toEqual({ mode: "now" });
  });
  it("la indexación nunca queda apagada al resolver", () => {
    expect(resolveBackgroundSettings({ knowledge_indexing: { mode: "off" } }).knowledge_indexing).toEqual({ mode: "now" });
  });
  it("validar: la indexación no se puede apagar", () => {
    expect(validateBackgroundSettings({ knowledge_indexing: { mode: "off" } }).ok).toBe(false);
    expect(validateBackgroundSettings({ knowledge_indexing: { mode: "batch", frequency: "daily" } }).ok).toBe(false);
  });
  it("validar: modo económico exige frecuencia", () => {
    expect(validateBackgroundSettings({ message_classification: { mode: "batch" } }).ok).toBe(false);
    expect(validateBackgroundSettings({ message_classification: { mode: "batch", frequency: "daily", hour: "03:00" } }).ok).toBe(true);
  });
  it("validar: hora inválida", () => {
    expect(validateBackgroundSettings({ message_classification: { mode: "batch", frequency: "daily", hour: "25:99" } }).ok).toBe(false);
  });
});
