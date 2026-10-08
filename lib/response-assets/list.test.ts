import { describe, it, expect } from "vitest";
import {
  agentUsable,
  applyFilters,
  contextLine,
  hasActiveFilters,
  kindCounts,
  NO_FILTERS,
  paginate,
  tagCounts,
  toBankAsset,
  toggleTag,
  type BankAsset,
} from "./list";

function asset(over: Partial<BankAsset> & Pick<BankAsset, "id" | "kind" | "name">): BankAsset {
  return {
    shortcut: null,
    description: null,
    tags: [],
    content: null,
    url: null,
    linkKind: null,
    caption: null,
    storagePath: null,
    previewPath: null,
    mimeType: null,
    sizeBytes: null,
    durationSeconds: null,
    transcript: null,
    transcriptStatus: "none",
    transcriptError: null,
    agentEnabled: false,
    isActive: true,
    usageCount: 0,
    lastUsedAt: null,
    createdAt: null,
    ...over,
  };
}

const BANK = [
  asset({ id: "t1", kind: "text", name: "Precio", content: "Sale 100 por mes", tags: ["precios"], usageCount: 5 }),
  asset({ id: "t2", kind: "text", name: "Bienvenida", content: "Hola", tags: ["saludos"] }),
  asset({ id: "a1", kind: "audio", name: "Precio en audio", transcript: "cuesta cien", transcriptStatus: "ready", tags: ["Precios", "objeciones"], usageCount: 2 }),
  asset({ id: "v1", kind: "video", name: "Testimonio Ana", description: "Ana cuenta su caso", tags: ["testimonios"] }),
  asset({ id: "l1", kind: "link", name: "Agenda", url: "https://www.calendly.com/wendy", description: "Reservar llamada", tags: ["precios"] }),
];

const ids = (list: { id: string }[]) => list.map((a) => a.id);

describe("applyFilters", () => {
  it("sin filtros: todos, los mas usados primero", () => {
    expect(ids(applyFilters(BANK, NO_FILTERS))).toEqual(["t1", "a1", "l1", "t2", "v1"]);
  });

  it("por tipo", () => {
    expect(ids(applyFilters(BANK, { ...NO_FILTERS, kind: "text" }))).toEqual(["t1", "t2"]);
  });

  it("dos etiquetas = los que tienen las dos, sin distinguir mayusculas", () => {
    expect(ids(applyFilters(BANK, { ...NO_FILTERS, tags: ["precios"] }))).toEqual(["t1", "a1", "l1"]);
    expect(ids(applyFilters(BANK, { ...NO_FILTERS, tags: ["precios", "objeciones"] }))).toEqual(["a1"]);
  });

  it("los tres filtros juntos", () => {
    expect(ids(applyFilters(BANK, { kind: "audio", tags: ["precios"], query: "cien" }))).toEqual(["a1"]);
  });
});

describe("kindCounts", () => {
  it("cuenta los seis tipos, con cero en gris en vez de desaparecer", () => {
    expect(kindCounts(BANK, NO_FILTERS)).toEqual({ all: 5, text: 2, audio: 1, video: 1, image: 0, file: 0, link: 1 });
  });

  it("el numero de un chip respeta los otros filtros pero no el de tipo", () => {
    const counts = kindCounts(BANK, { kind: "video", tags: ["precios"], query: "" });
    expect(counts).toMatchObject({ all: 3, text: 1, audio: 1, link: 1, video: 0 });
  });
});

describe("tagCounts", () => {
  it("las etiquetas que existen, con su conteo, sin duplicar por mayusculas", () => {
    const tags = tagCounts(BANK, NO_FILTERS);
    expect(tags[0]).toEqual({ tag: "precios", count: 3, selected: false });
    expect(tags.map((t) => t.tag).sort()).toEqual(["objeciones", "precios", "saludos", "testimonios"]);
  });

  it("con una etiqueta elegida, cuenta lo que queda combinandola", () => {
    const tags = tagCounts(BANK, { ...NO_FILTERS, tags: ["precios"] });
    expect(tags[0]).toMatchObject({ tag: "precios", selected: true, count: 3 });
    expect(tags.find((t) => t.tag === "objeciones")?.count).toBe(1);
    expect(tags.find((t) => t.tag === "saludos")).toBeUndefined();
  });

  it("una elegida que quedo en cero se sigue mostrando para poder sacarla", () => {
    const tags = tagCounts(BANK, { kind: "image", tags: ["precios"], query: "" });
    expect(tags).toEqual([{ tag: "precios", count: 0, selected: true }]);
  });

  it("toggleTag prende y apaga sin distinguir mayusculas", () => {
    expect(toggleTag(["precios"], "Precios")).toEqual([]);
    expect(toggleTag([], "precios")).toEqual(["precios"]);
  });
});

describe("paginate", () => {
  const items = Array.from({ length: 60 }, (_, i) => i);

  it("de a 25", () => {
    expect(paginate(items, 1)).toMatchObject({ page: 1, totalPages: 3, total: 60 });
    expect(paginate(items, 3).items).toEqual(items.slice(50));
  });

  it("una pagina fuera de rango se acota", () => {
    expect(paginate(items, 9).page).toBe(3);
    expect(paginate(items, 0).page).toBe(1);
    expect(paginate([], 4)).toMatchObject({ page: 1, totalPages: 1, total: 0, items: [] });
  });
});

describe("contextLine", () => {
  it("una linea segun el tipo", () => {
    expect(contextLine(BANK[0])).toBe("Sale 100 por mes");
    expect(contextLine(BANK[2])).toBe("cuesta cien");
    expect(contextLine(BANK[4])).toBe("calendly.com · Reservar llamada");
    expect(contextLine(asset({ id: "i", kind: "image", name: "x", description: "Flyer" }))).toBe("Flyer");
  });

  it("un audio o video sin transcripcion lista dice su estado", () => {
    expect(contextLine(asset({ id: "a", kind: "audio", name: "x", transcriptStatus: "pending" }))).toBe("Transcribiendo…");
    expect(contextLine(asset({ id: "v", kind: "video", name: "x", description: "Demo" }))).toBe("Sin voz · Demo");
  });

  it("recorta lo largo", () => {
    const long = asset({ id: "t", kind: "text", name: "x", content: "palabra ".repeat(50) });
    expect(contextLine(long, 20).length).toBeLessThanOrEqual(20);
    expect(contextLine(long, 20).endsWith("…")).toBe(true);
  });
});

describe("agentUsable", () => {
  it("audio con transcripcion lista; video lista o sin voz; lo demas siempre", () => {
    expect(agentUsable({ kind: "audio", transcriptStatus: "ready" })).toBe(true);
    expect(agentUsable({ kind: "audio", transcriptStatus: "none" })).toBe(false);
    expect(agentUsable({ kind: "video", transcriptStatus: "none" })).toBe(true);
    expect(agentUsable({ kind: "video", transcriptStatus: "pending" })).toBe(false);
    expect(agentUsable({ kind: "video", transcriptStatus: "failed" })).toBe(false);
    expect(agentUsable({ kind: "file", transcriptStatus: "none" })).toBe(true);
  });
});

describe("toBankAsset y hasActiveFilters", () => {
  it("pasa la fila a camelCase con defaults sanos", () => {
    const bank = toBankAsset({
      id: "x", kind: "link", name: "n", shortcut: null, description: "d", tags: null, content: null,
      url: "https://a.com", link_kind: "agenda", storage_path: null, mime_type: null, duration_seconds: null, transcript: null,
    });
    expect(bank).toMatchObject({ kind: "link", tags: [], linkKind: "agenda", usageCount: 0, transcriptStatus: "none", isActive: true });
  });

  it("detecta si hay algun filtro puesto", () => {
    expect(hasActiveFilters(NO_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...NO_FILTERS, query: " x " })).toBe(true);
  });
});
