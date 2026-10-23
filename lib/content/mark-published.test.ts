import { describe, expect, it } from "vitest";
import { markPublishedChoices, markPublishedOffer } from "./mark-published";
import { CONTENT_PLATFORMS } from "./network-format";

describe("'Publicado…' se ofrece", () => {
  it("a quien puede publicar, en cualquier estado que no sea publicada o publicandose", () => {
    for (const status of ["draft", "in_review", "approved", "scheduled", "partially_published", "failed"] as const) {
      expect(markPublishedOffer({ canPublish: true, status })).toEqual({ offered: true, disabled: false });
    }
    expect(markPublishedOffer({ canPublish: true, status: "published" })).toEqual({ offered: false });
    expect(markPublishedOffer({ canPublish: true, status: "publishing" })).toEqual({ offered: false });
  });

  it("sin permiso se ve deshabilitado, con el motivo", () => {
    expect(markPublishedOffer({ canPublish: false, status: "approved" })).toMatchObject({
      offered: true,
      disabled: true,
      reason: expect.stringContaining("publicar"),
    });
  });
});

describe("las redes de la ventanita", () => {
  it("las de la pieza que faltan, tildadas; las ya publicadas no aparecen", () => {
    const choices = markPublishedChoices({
      networks: ["instagram", "linkedin", "youtube"],
      publications: [
        { platform: "instagram", status: "published" },
        { platform: "youtube", status: "scheduled" },
      ],
    });
    expect(choices).toEqual([
      { platform: "linkedin", inPiece: true, checked: true },
      { platform: "youtube", inPiece: true, checked: true },
    ]);
  });

  it("una pieza sin redes ofrece todas, sin tildar: hay que decir donde salio", () => {
    const choices = markPublishedChoices({ networks: [], publications: [] });
    expect(choices.map((c) => c.platform)).toEqual(CONTENT_PLATFORMS);
    expect(choices.every((c) => !c.checked && !c.inPiece)).toBe(true);
  });
});
