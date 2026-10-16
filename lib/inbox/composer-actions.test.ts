import { describe, expect, it } from "vitest";
import { planComposerActions } from "@/lib/inbox/composer-actions";

describe("botones del composer", () => {
  it("vacio y sin adjunto: todo a mano, con microfono", () => {
    expect(planComposerActions({ hasAttachment: false, hasText: false, canSuggest: true })).toEqual({
      showLibrary: true,
      showAttach: true,
      showMic: true,
      showSuggest: true,
      hasMoreMenu: true,
    });
  });

  it("con texto escrito no hay microfono", () => {
    const plan = planComposerActions({ hasAttachment: false, hasText: true, canSuggest: false });
    expect(plan.showMic).toBe(false);
    expect(plan.showSuggest).toBe(false);
    expect(plan.showLibrary).toBe(true);
  });

  it("con un adjunto elegido solo queda el texto que lo acompana", () => {
    const plan = planComposerActions({ hasAttachment: true, hasText: false, canSuggest: true });
    expect(plan).toEqual({ showLibrary: false, showAttach: false, showMic: false, showSuggest: false, hasMoreMenu: false });
  });

  it("sin agente que sugiera no hay boton de sugerir", () => {
    expect(planComposerActions({ hasAttachment: false, hasText: false, canSuggest: false }).showSuggest).toBe(false);
  });
});
