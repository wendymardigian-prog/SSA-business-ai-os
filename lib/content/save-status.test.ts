import { describe, expect, it } from "vitest";
import { deriveSaveState, saveStatusView } from "./save-status";

describe("estado de guardado del drawer", () => {
  it("sin nada pendiente esta guardado, y se queda asi (no es un destello)", () => {
    expect(deriveSaveState({ dirty: false, saving: false, failed: false })).toBe("saved");
    expect(saveStatusView({ dirty: false, saving: false, failed: false }).label).toBe("Guardado");
  });

  it("cambios escritos que no se mandaron: sin guardar", () => {
    expect(deriveSaveState({ dirty: true, saving: false, failed: false })).toBe("unsaved");
  });

  it("mientras se guarda dice Guardando, aunque haya cambios nuevos encima", () => {
    expect(deriveSaveState({ dirty: false, saving: true, failed: false })).toBe("saving");
    expect(deriveSaveState({ dirty: true, saving: true, failed: false })).toBe("saving");
  });

  it("un guardado fallido se ve como error y ofrece reintentar", () => {
    const view = saveStatusView({ dirty: true, saving: false, failed: true });
    expect(view.state).toBe("error");
    expect(view.canRetry).toBe(true);
  });

  it("el error no se tapa con 'Cambios sin guardar' pero si con un reintento en vuelo", () => {
    expect(deriveSaveState({ dirty: true, saving: false, failed: true })).toBe("error");
    expect(deriveSaveState({ dirty: true, saving: true, failed: true })).toBe("saving");
  });

  it("solo el error ofrece reintentar", () => {
    for (const state of [
      { dirty: false, saving: false, failed: false },
      { dirty: true, saving: false, failed: false },
      { dirty: false, saving: true, failed: false },
    ]) {
      expect(saveStatusView(state).canRetry).toBe(false);
    }
  });
});
