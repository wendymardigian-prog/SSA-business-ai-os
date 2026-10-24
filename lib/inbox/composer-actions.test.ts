import { describe, expect, it } from "vitest";
import { planComposerActions } from "@/lib/inbox/composer-actions";

describe("botones del composer", () => {
  it("vacio y sin adjunto: el principal es el microfono y todo lo demas va al menu, en orden", () => {
    expect(planComposerActions({ hasAttachment: false, hasText: false, canSuggest: true, canSticker: true })).toEqual({
      primary: "mic",
      menu: ["library", "attach", "emoji", "sticker", "suggest"],
    });
  });

  it("con texto escrito el principal es enviar (grabar y escribir son excluyentes)", () => {
    const plan = planComposerActions({ hasAttachment: false, hasText: true, canSuggest: true });
    expect(plan.primary).toBe("send");
    expect(plan.menu).toEqual(["library", "attach", "emoji", "suggest"]);
  });

  it("con un adjunto elegido se manda: solo queda el emoji para el texto que lo acompana", () => {
    expect(planComposerActions({ hasAttachment: true, hasText: false, canSuggest: true, canSticker: true })).toEqual({
      primary: "send",
      menu: ["emoji"],
    });
  });

  it("sin agente que sugiera no hay sugerir; sin stickers en el canal, tampoco stickers", () => {
    const plan = planComposerActions({ hasAttachment: false, hasText: false, canSuggest: false });
    expect(plan.menu).not.toContain("suggest");
    expect(plan.menu).not.toContain("sticker");
  });

  it("el menu nunca esta vacio: el emoji siempre esta", () => {
    for (const hasAttachment of [true, false])
      for (const hasText of [true, false])
        for (const canSuggest of [true, false])
          expect(planComposerActions({ hasAttachment, hasText, canSuggest }).menu).toContain("emoji");
  });
});
