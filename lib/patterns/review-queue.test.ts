import { describe, expect, it } from "vitest";
import { accuracyByWeek, lastWeeks, mostCorrectedCategories, reviewQueue, type ReviewCandidate } from "./review-queue";

function candidate(over: Partial<ReviewCandidate> = {}): ReviewCandidate {
  return {
    textId: "t1",
    direction: "inbound",
    text: "sí",
    categoryId: "c1",
    categoryName: "Dice que sí",
    confidence: 0.9,
    source: "model",
    reviewResult: null,
    categoryIsNew: false,
    messageCount: 5,
    ...over,
  };
}

describe("reviewQueue", () => {
  it("primero las categorias nuevas, despues la menor confianza", () => {
    const queue = reviewQueue([
      candidate({ textId: "alta", confidence: 0.99 }),
      candidate({ textId: "baja", confidence: 0.55 }),
      candidate({ textId: "nueva", confidence: 0.98, categoryIsNew: true }),
    ]);
    expect(queue.map((c) => c.textId)).toEqual(["nueva", "baja", "alta"]);
  });

  it("no vuelve a pedir lo que alguien ya reviso", () => {
    const queue = reviewQueue([candidate({ textId: "visto", reviewResult: "ok" }), candidate({ textId: "nuevo" })]);
    expect(queue.map((c) => c.textId)).toEqual(["nuevo"]);
  });

  it("lo que puso una regla no se revisa: no lo decidio el modelo", () => {
    expect(reviewQueue([candidate({ source: "rule" }), candidate({ source: "human" })])).toEqual([]);
  });

  it("a igual confianza, primero el que afecta a mas mensajes", () => {
    const queue = reviewQueue([
      candidate({ textId: "pocos", messageCount: 2 }),
      candidate({ textId: "muchos", messageCount: 90 }),
    ]);
    expect(queue[0].textId).toBe("muchos");
  });

  it("son veinte por sesion", () => {
    const many = Array.from({ length: 50 }, (_, i) => candidate({ textId: `t${i}`, confidence: i / 100 }));
    expect(reviewQueue(many)).toHaveLength(20);
  });
});

describe("accuracyByWeek", () => {
  const weeks = ["2026-09-14", "2026-09-21"];

  it("cuenta aciertos por semana", () => {
    const out = accuracyByWeek(
      [
        { reviewedAt: "2026-09-15T10:00:00.000Z", reviewResult: "ok" },
        { reviewedAt: "2026-09-16T10:00:00.000Z", reviewResult: "corrected" },
        { reviewedAt: "2026-09-22T10:00:00.000Z", reviewResult: "ok" },
      ],
      weeks,
      "UTC",
    );
    expect(out[0]).toEqual({ weekStart: "2026-09-14", reviewed: 2, accuracy: 50 });
    expect(out[1]).toEqual({ weekStart: "2026-09-21", reviewed: 1, accuracy: 100 });
  });

  it("una semana sin revisiones es un hueco, no un 0 %", () => {
    const out = accuracyByWeek([], weeks, "UTC");
    expect(out.every((w) => w.accuracy === null)).toBe(true);
  });

  it("ignora fechas invalidas y filas sin resultado", () => {
    const out = accuracyByWeek(
      [{ reviewedAt: "x", reviewResult: "ok" }, { reviewedAt: "2026-09-15T10:00:00.000Z", reviewResult: null }],
      weeks,
      "UTC",
    );
    expect(out[0].reviewed).toBe(0);
  });

  it("la semana se corta en la zona del negocio, no en UTC", () => {
    // Martes 15 a las 23:30 UTC es ya miercoles 16 en Asia/Tokyo (UTC+9),
    // pero sigue siendo la semana del 14.
    const out = accuracyByWeek(
      [{ reviewedAt: "2026-09-15T23:30:00.000Z", reviewResult: "ok" }],
      weeks,
      "Asia/Tokyo",
    );
    expect(out[0]).toEqual({ weekStart: "2026-09-14", reviewed: 1, accuracy: 100 });
  });
});

describe("lastWeeks", () => {
  it("son lunes consecutivos, del mas viejo al mas nuevo", () => {
    expect(lastWeeks(new Date("2026-09-25T00:00:00.000Z"), 3, "UTC")).toEqual(["2026-09-07", "2026-09-14", "2026-09-21"]);
  });

  it("se corta en la zona del negocio, no en UTC", () => {
    // 2026-09-25T23:30:00Z es ya 26/9 en Asia/Tokyo, pero sigue siendo la
    // semana del 21.
    expect(lastWeeks(new Date("2026-09-25T23:30:00.000Z"), 1, "Asia/Tokyo")).toEqual(["2026-09-21"]);
  });
});

describe("mostCorrectedCategories", () => {
  it("ordena por porcentaje, no por cantidad", () => {
    const texts = [
      // 10 de 200 = 5 %
      ...Array.from({ length: 190 }, () => ({ categoryId: "grande", categoryName: "Grande", source: "model", reviewResult: null })),
      ...Array.from({ length: 10 }, () => ({ categoryId: "grande", categoryName: "Grande", source: "model", reviewResult: "corrected" })),
      // 5 de 12 = 42 %
      ...Array.from({ length: 7 }, () => ({ categoryId: "chica", categoryName: "Chica", source: "model", reviewResult: null })),
      ...Array.from({ length: 5 }, () => ({ categoryId: "chica", categoryName: "Chica", source: "model", reviewResult: "corrected" })),
    ];
    const out = mostCorrectedCategories(texts);
    expect(out.map((c) => c.categoryId)).toEqual(["chica", "grande"]);
    expect(out[0].pct).toBe(42);
  });

  it("una categoria sin correcciones no aparece", () => {
    const out = mostCorrectedCategories([{ categoryId: "c1", categoryName: "C", source: "model", reviewResult: "ok" }]);
    expect(out).toEqual([]);
  });

  it("son tres como maximo", () => {
    const texts = ["a", "b", "c", "d"].map((id) => ({ categoryId: id, categoryName: id, source: "model", reviewResult: "corrected" }));
    expect(mostCorrectedCategories(texts)).toHaveLength(3);
  });
});
