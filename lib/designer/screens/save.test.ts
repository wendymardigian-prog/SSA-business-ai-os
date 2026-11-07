import { describe, expect, it } from "vitest";
import { AUTOSAVE_DELAY_MS, hasUnsavedChanges, initialSaveState, isOfflineError, needsSave, saveReducer, type SaveEvent, type SaveState } from "./save";
import { SAVE_LABELS } from "./toolbar";

const run = (events: SaveEvent[], from: SaveState = initialSaveState(3)) => events.reduce(saveReducer, from);

describe("guardado automático (F27)", () => {
  it("guarda 1,5 s después del último cambio", () => {
    expect(AUTOSAVE_DELAY_MS).toBe(1500);
  });

  it("guardado → cambio → con cambios → guardando → guardado, con la rev nueva", () => {
    let s = initialSaveState(3);
    s = saveReducer(s, { type: "edit" });
    expect(s.status).toBe("dirty");
    expect(needsSave(s)).toBe(true);
    s = saveReducer(s, { type: "start" });
    expect(s.status).toBe("saving");
    expect(needsSave(s)).toBe(false);
    s = saveReducer(s, { type: "saved", rev: 4 });
    expect(s).toEqual({ status: "saved", rev: 4, pending: false, error: null });
    expect(hasUnsavedChanges(s)).toBe(false);
  });

  it("un cambio que llega mientras se guarda no se pierde: queda con cambios al terminar", () => {
    const s = run([{ type: "edit" }, { type: "start" }, { type: "edit" }, { type: "saved", rev: 4 }]);
    expect(s.status).toBe("dirty");
    expect(s.rev).toBe(4);
    expect(needsSave(s)).toBe(true);
  });

  it("una rev vieja da conflicto y no se vuelve a guardar sola", () => {
    let s = run([{ type: "edit" }, { type: "start" }, { type: "conflict" }]);
    expect(s.status).toBe("conflict");
    expect(needsSave(s)).toBe(false);
    s = saveReducer(s, { type: "edit" });
    expect(s.status).toBe("conflict");
    expect(hasUnsavedChanges(s)).toBe(true);
    // Recargar empieza de cero con lo vigente.
    expect(saveReducer(s, { type: "reloaded", rev: 9 })).toEqual(initialSaveState(9));
  });

  it("sin conexión: queda para guardar al volver", () => {
    let s = run([{ type: "edit" }, { type: "start" }, { type: "failed", error: "", offline: true }]);
    expect(s.status).toBe("offline");
    expect(needsSave(s)).toBe(false);
    s = saveReducer(s, { type: "online" });
    expect(s.status).toBe("dirty");
    expect(needsSave(s)).toBe(true);
    expect(saveReducer(initialSaveState(1), { type: "online" }).status).toBe("saved");
  });

  it("un error del servidor se muestra y se puede reintentar", () => {
    let s = run([{ type: "edit" }, { type: "start" }, { type: "failed", error: "No pudimos guardar.", offline: false }]);
    expect(s).toMatchObject({ status: "error", error: "No pudimos guardar." });
    expect(needsSave(s)).toBe(true);
    s = saveReducer(s, { type: "start" });
    expect(s.status).toBe("saving");
  });

  it("empezar a guardar sin cambios no hace nada", () => {
    const s = initialSaveState(3);
    expect(saveReducer(s, { type: "start" })).toBe(s);
  });

  it("distingue una falla de red de una del servidor", () => {
    expect(isOfflineError(new TypeError("Failed to fetch"), true)).toBe(true);
    expect(isOfflineError(new TypeError("NetworkError when attempting to fetch"), true)).toBe(true);
    expect(isOfflineError(new Error("boom"), true)).toBe(false);
    expect(isOfflineError(new Error("boom"), false)).toBe(true);
  });

  it("los textos del indicador son los del plano", () => {
    expect(SAVE_LABELS.saved).toBe("Guardado");
    expect(SAVE_LABELS.saving).toBe("Guardando…");
    expect(SAVE_LABELS.offline).toBe("Sin conexión: se guarda al volver");
  });
});
