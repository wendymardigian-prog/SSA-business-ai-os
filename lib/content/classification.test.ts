import { describe, expect, it } from "vitest";
import {
  FUNNEL_STAGES,
  authorshipLine,
  cleanClassification,
  funnelStageInfo,
  isFunnelStage,
  isContentPlatform,
  pickInheritedClassification,
} from "./classification";
import { NO_PILLAR_LABEL, groupByTaxonomy } from "./taxonomy";

describe("etapas del embudo", () => {
  it("son tres, en orden, y cada una dice que es", () => {
    expect(FUNNEL_STAGES.map((s) => s.value)).toEqual(["tofu", "mofu", "bofu"]);
    for (const stage of FUNNEL_STAGES) {
      expect(stage.label.length).toBeGreaterThan(0);
      expect(stage.description.length).toBeGreaterThan(20);
    }
  });

  it("isFunnelStage solo acepta las tres", () => {
    expect(isFunnelStage("mofu")).toBe(true);
    expect(isFunnelStage("xofu")).toBe(false);
    expect(isFunnelStage(null)).toBe(false);
    expect(isFunnelStage("")).toBe(false);
  });

  it("funnelStageInfo devuelve la descripcion que va bajo el selector", () => {
    expect(funnelStageInfo("bofu")?.label).toBe("Decisión");
    expect(funnelStageInfo(null)).toBeNull();
    expect(funnelStageInfo("nada")).toBeNull();
  });
});

describe("isContentPlatform", () => {
  it("son las cinco redes", () => {
    for (const p of ["instagram", "tiktok", "youtube", "linkedin", "threads"]) {
      expect(isContentPlatform(p)).toBe(true);
    }
    expect(isContentPlatform("facebook")).toBe(false);
  });
});

describe("cleanClassification", () => {
  it("deja las plataformas validas, sin repetir y en el orden en que vinieron", () => {
    expect(
      cleanClassification({ platforms: ["tiktok", "instagram", "tiktok", "facebook", "  "] }).platforms,
    ).toEqual(["tiktok", "instagram"]);
  });

  it("lo vacio queda en null y no en cadena vacia", () => {
    expect(
      cleanClassification({ format: "  ", reference: "", offer_id: "", pillar_id: null, funnel_stage: "" }),
    ).toEqual({
      platforms: [],
      format: null,
      reference: null,
      offer_id: null,
      pillar_id: null,
      funnel_stage: null,
    });
  });

  it("una etapa que no es de las tres se descarta", () => {
    expect(cleanClassification({ funnel_stage: "xofu" }).funnel_stage).toBeNull();
    expect(cleanClassification({ funnel_stage: "tofu" }).funnel_stage).toBe("tofu");
  });

  it("recorta formato y referencia", () => {
    const c = cleanClassification({ format: " Reel ", reference: " https://x.test " });
    expect(c.format).toBe("Reel");
    expect(c.reference).toBe("https://x.test");
  });

  it("un campo que no viene queda en su valor vacio, no se inventa", () => {
    expect(cleanClassification({})).toEqual({
      platforms: [],
      format: null,
      reference: null,
      offer_id: null,
      pillar_id: null,
      funnel_stage: null,
    });
  });
});

describe("lo que hereda la pieza de la idea (F91)", () => {
  const idea = {
    platforms: ["instagram", "tiktok"],
    format: "Reel",
    offer_id: "of-1",
    pillar_id: "pi-1",
    funnel_stage: "mofu",
    reference: "https://ref.test",
  };

  it("hereda formato, oferta, pilar, embudo y referencia", () => {
    expect(pickInheritedClassification(idea)).toEqual({
      format: "Reel",
      offer_id: "of-1",
      pillar_id: "pi-1",
      funnel_stage: "mofu",
      reference: "https://ref.test",
    });
  });

  it("lo que la pieza ya tiene gana sobre lo de la idea", () => {
    const heredado = pickInheritedClassification(idea, { pillar_id: "otro", format: "Carrusel" });

    expect(heredado.pillar_id).toBe("otro");
    expect(heredado.format).toBe("Carrusel");
    expect(heredado.offer_id).toBe("of-1");
  });

  it("una idea pelada hereda nada, y no inventa", () => {
    expect(pickInheritedClassification({})).toEqual({
      format: null,
      offer_id: null,
      pillar_id: null,
      funnel_stage: null,
      reference: null,
    });
  });
});

describe("autor y fechas (F91: visibles en la idea, la pieza, el kanban y la lista)", () => {
  const base = { timeZone: "America/Costa_Rica" };

  it("dice quien la creo y cuando", () => {
    expect(
      authorshipLine({ ...base, authorName: "Ana", createdAt: "2026-10-03T15:00:00Z", updatedAt: "2026-10-03T15:00:00Z" }),
    ).toBe("Ana · creada el 3 oct");
  });

  it("si se edito despues, suma la ultima edicion", () => {
    expect(
      authorshipLine({ ...base, authorName: "Ana", createdAt: "2026-10-03T15:00:00Z", updatedAt: "2026-10-05T15:00:00Z" }),
    ).toBe("Ana · creada el 3 oct · editada el 5 oct");
  });

  it("una edicion el mismo dia que la creacion no se repite", () => {
    expect(
      authorshipLine({ ...base, authorName: "Ana", createdAt: "2026-10-03T14:00:00Z", updatedAt: "2026-10-03T18:00:00Z" }),
    ).toBe("Ana · creada el 3 oct");
  });

  it("sin autor conocido igual muestra las fechas", () => {
    expect(authorshipLine({ ...base, authorName: null, createdAt: "2026-10-03T15:00:00Z", updatedAt: null })).toBe(
      "Creada el 3 oct",
    );
  });

  it("usa la zona del negocio: las 2 de la mañana UTC siguen siendo el dia anterior en Costa Rica", () => {
    expect(
      authorshipLine({ ...base, authorName: null, createdAt: "2026-10-04T02:00:00Z", updatedAt: null }),
    ).toBe("Creada el 3 oct");
  });

  it("sin fechas ni autor no muestra nada", () => {
    expect(authorshipLine({ ...base, authorName: null, createdAt: null, updatedAt: null })).toBeNull();
  });

  it("una fecha rota no rompe", () => {
    expect(authorshipLine({ ...base, authorName: "Ana", createdAt: "no es fecha", updatedAt: null })).toBe("Ana");
  });
});

describe("una pieza sin pilar no queda fuera de los conteos (F91)", () => {
  it("se agrupa como 'Sin pilar'", () => {
    const piezas = [
      { id: 1, pillar_id: "a" },
      { id: 2, pillar_id: null },
      { id: 3, pillar_id: null },
    ];
    const grupos = groupByTaxonomy(piezas, (p) => p.pillar_id, [{ id: "a", name: "Educativo", archivedAt: null }], NO_PILLAR_LABEL);

    expect(grupos.map((g) => [g.label, g.rows.length])).toEqual([
      ["Educativo", 1],
      ["Sin pilar", 2],
    ]);
  });
});
