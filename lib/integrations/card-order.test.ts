import { describe, it, expect } from "vitest";
import { BUSINESS_ORDER, orderCards } from "./card-order";

const ids = (cards: { id: string }[]) => cards.map((c) => c.id);

describe("orden de las cards de Integraciones", () => {
  it("sin nada conectado, sigue el orden fijo", () => {
    const cards = ["evolution", "postproxy", "google", "resend", "meta_capi", "meta", "linkedin", "threads", "fathom"].map(
      (id) => ({ id, connected: false }),
    );
    expect(ids(orderCards(cards, BUSINESS_ORDER))).toEqual([
      "resend",
      "google",
      "meta",
      "meta_capi",
      "fathom",
      "threads",
      "linkedin",
      "postproxy",
      "evolution",
    ]);
  });

  it("las conectadas van arriba, cada grupo en el orden fijo", () => {
    const cards = [
      { id: "resend", connected: false },
      { id: "evolution", connected: true },
      { id: "google", connected: false },
      { id: "threads", connected: true },
    ];
    expect(ids(orderCards(cards, BUSINESS_ORDER))).toEqual(["threads", "evolution", "resend", "google"]);
  });

  it("lo que no esta en la lista va despues, en el orden en que llego", () => {
    const cards = [
      { id: "nuevo-b", connected: false },
      { id: "nuevo-a", connected: false },
      { id: "resend", connected: false },
    ];
    expect(ids(orderCards(cards, BUSINESS_ORDER))).toEqual(["resend", "nuevo-b", "nuevo-a"]);
  });

  it("sin lista de orden, solo sube las conectadas", () => {
    const cards = [
      { id: "a", connected: false },
      { id: "b", connected: true },
      { id: "c", connected: false },
    ];
    expect(ids(orderCards(cards))).toEqual(["b", "a", "c"]);
  });
});
