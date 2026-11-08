import { describe, expect, it } from "vitest";
import { pageFit, targetsForDesignFormat } from "../content-map";
import type { ContentLinkInfo, ModalNetwork, PieceChoice, UseInContentModalData } from "../content-link-types";
import type { FormatKey } from "../formats";
import {
  USE_IN_CONTENT_TEXT,
  buildSubmission,
  defaultSelection,
  exportSummary,
  initialModalState,
  linkNetworkOptions,
  linkedMenuView,
  networkKey,
  resolveLinkPlatform,
  syncMessage,
  toggleNetwork,
} from "./use-in-content";

const networksFor = (format: FormatKey, pages: number): ModalNetwork[] =>
  targetsForDesignFormat(format).map((t) => ({ platform: t.platform, format: t.format, label: t.label, fit: pageFit(t, pages), note: t.note ?? null }));

const data = (over: Partial<UseInContentModalData> & { format?: FormatKey; pageCount?: number } = {}): UseInContentModalData => {
  const format = over.format ?? "v45";
  const pageCount = over.pageCount ?? 5;
  return { designName: "Carrusel de prueba", format, pageCount, networks: networksFor(format, pageCount), canCopy: true, linked: null, ...over };
};

const piece = (over: Partial<PieceChoice> = {}): PieceChoice => ({
  id: "p1",
  title: "Una pieza",
  statusLabel: "Borrador",
  networks: [{ platform: "instagram", label: "Instagram Carrusel", format: "carousel" }],
  summary: "Borrador · Instagram Carrusel",
  hasDesign: false,
  ...over,
});

describe("lo que arranca elegido en «Crear una pieza nueva»", () => {
  it("un diseño de varias páginas: Instagram carrusel y LinkedIn PDF (como el prototipo)", () => {
    expect(defaultSelection(networksFor("v45", 5), 5)).toEqual(["instagram:carousel", "linkedin:pdf"]);
  });

  it("un diseño de una página: Instagram imagen, y LinkedIn no", () => {
    expect(defaultSelection(networksFor("v45", 1), 1)).toEqual(["instagram:image"]);
    expect(defaultSelection(networksFor("sq", 1), 1)).toEqual(["instagram:image"]);
  });

  it("una historia: la historia de Instagram, y TikTok queda sin tildar", () => {
    expect(defaultSelection(networksFor("story", 3), 3)).toEqual(["instagram:story"]);
  });

  it("un documento (carta vertical o presentación) solo tiene el PDF de LinkedIn y arranca elegido, tenga una o varias páginas", () => {
    expect(defaultSelection(networksFor("carta_v", 1), 1)).toEqual(["linkedin:pdf"]);
    expect(defaultSelection(networksFor("wide", 6), 6)).toEqual(["linkedin:pdf"]);
  });

  it("sin publicaciones no elige nada", () => {
    expect(defaultSelection([], 3)).toEqual([]);
  });
});

describe("el estado inicial del modal", () => {
  it("arranca en «Crear una pieza nueva» con el nombre del diseño, lo elegido por defecto y el caption con IA si tiene permiso", () => {
    const state = initialModalState(data());

    expect(state).toMatchObject({ mode: "new", title: "Carrusel de prueba", selected: ["instagram:carousel", "linkedin:pdf"], proposeCaption: true, pieceId: null, platform: null });
  });

  it("sin permiso de IA el caption con IA arranca apagado", () => {
    expect(initialModalState(data({ canCopy: false })).proposeCaption).toBe(false);
  });
});

describe("toggleNetwork: una publicación por red", () => {
  const ig = { platform: "instagram", format: "carousel" };
  const igImage = { platform: "instagram", format: "image" };
  const li = { platform: "linkedin", format: "pdf" };

  it("tilda y destilda", () => {
    expect(toggleNetwork([], ig)).toEqual(["instagram:carousel"]);
    expect(toggleNetwork(["instagram:carousel"], ig)).toEqual([]);
  });

  it("elegir otra publicación de la misma red reemplaza a la anterior", () => {
    expect(toggleNetwork(["instagram:carousel", "linkedin:pdf"], igImage)).toEqual(["linkedin:pdf", "instagram:image"]);
  });

  it("las demás redes no se tocan", () => {
    expect(toggleNetwork(["instagram:carousel"], li)).toEqual(["instagram:carousel", "linkedin:pdf"]);
  });

  it("la clave es red y formato", () => {
    expect(networkKey(ig)).toBe("instagram:carousel");
  });
});

describe("qué se manda al confirmar", () => {
  const d = data();

  it("crear: el título limpio, las redes con su formato y si se pide el caption", () => {
    const state = { ...initialModalState(d), title: "  Mi pieza  " };

    expect(buildSubmission("d1", state, d, [])).toEqual({
      ok: true,
      input: { designId: "d1", mode: "new", title: "Mi pieza", networks: [{ platform: "instagram", format: "carousel" }, { platform: "linkedin", format: "pdf" }], proposeCaption: true },
    });
  });

  it("sin permiso de IA nunca pide el caption, aunque el estado diga que sí", () => {
    const noAi = data({ canCopy: false });
    const out = buildSubmission("d1", { ...initialModalState(noAi), proposeCaption: true }, noAi, []);

    expect(out.ok && out.input.mode === "new" && out.input.proposeCaption).toBe(false);
  });

  it("crear sin ninguna red o con un título larguísimo no se puede", () => {
    expect(buildSubmission("d1", { ...initialModalState(d), selected: [] }, d, [])).toEqual({ ok: false, reason: "Elegí al menos una red." });
    expect(buildSubmission("d1", { ...initialModalState(d), selected: ["youtube:video"] }, d, [])).toEqual({ ok: false, reason: "Elegí al menos una red." });
    expect(buildSubmission("d1", { ...initialModalState(d), title: "x".repeat(201) }, d, [])).toEqual({ ok: false, reason: "El título va de 1 a 200 caracteres." });
  });

  it("un título vacío se manda vacío (el servidor usa el nombre del diseño)", () => {
    const out = buildSubmission("d1", { ...initialModalState(d), title: "  " }, d, []);

    expect(out.ok && out.input.mode === "new" && out.input.title).toBe("");
  });

  it("vincular: la pieza elegida y la red donde va", () => {
    const state = { ...initialModalState(d), mode: "link" as const, pieceId: "p1", platform: "instagram" };

    expect(buildSubmission("d1", state, d, [piece()])).toEqual({ ok: true, input: { designId: "d1", mode: "link", postId: "p1", platform: "instagram" } });
  });

  it("vincular sin elegir pieza no se puede; con una pieza que ya no está en la lista, tampoco", () => {
    const state = { ...initialModalState(d), mode: "link" as const };

    expect(buildSubmission("d1", state, d, [piece()])).toEqual({ ok: false, reason: "Elegí una pieza." });
    expect(buildSubmission("d1", { ...state, pieceId: "otra" }, d, [piece()])).toEqual({ ok: false, reason: "Elegí una pieza." });
  });

  it("vincular sin red elegida toma la primera que sirve", () => {
    const state = { ...initialModalState(d), mode: "link" as const, pieceId: "p1" };
    const out = buildSubmission("d1", state, d, [piece()]);

    expect(out.ok && out.input.mode === "link" && out.input.platform).toBe("instagram");
  });
});

describe("las redes donde va el diseño al vincular", () => {
  const d = data({ pageCount: 4 });

  it("cada red con la publicación que le toca, respetando la que la pieza ya tiene", () => {
    expect(linkNetworkOptions(piece(), d)).toEqual([
      { platform: "instagram", format: "carousel", label: "Instagram · Carrusel" },
      { platform: "tiktok", format: "photos", label: "TikTok · Carrusel de fotos" },
      { platform: "linkedin", format: "pdf", label: "LinkedIn · Carrusel PDF" },
      { platform: "threads", format: "carousel", label: "Threads · Carrusel" },
    ]);
    const imageFirst = piece({ networks: [{ platform: "instagram", label: "Instagram Imagen", format: "image" }] });
    expect(linkNetworkOptions(imageFirst, d)[0]).toEqual({ platform: "instagram", format: "image", label: "Instagram · Imagen" });
  });

  it("sin pieza elegida no hay opciones", () => {
    expect(linkNetworkOptions(null, d)).toEqual([]);
  });

  it("un diseño solo de documento ofrece solo LinkedIn", () => {
    expect(linkNetworkOptions(piece(), data({ format: "carta_v", pageCount: 2 })).map((o) => o.platform)).toEqual(["linkedin"]);
  });

  it("la red elegida se respeta si sigue valiendo; si no, la primera", () => {
    const options = [{ platform: "instagram" }, { platform: "linkedin" }];
    const base = { ...initialModalState(d), mode: "link" as const };

    expect(resolveLinkPlatform({ ...base, platform: "linkedin" }, options)).toBe("linkedin");
    expect(resolveLinkPlatform({ ...base, platform: "tiktok" }, options)).toBe("instagram");
    expect(resolveLinkPlatform(base, [])).toBeNull();
  });
});

describe("el resumen de qué se exporta", () => {
  it("láminas como PNG, y el PDF solo si LinkedIn está elegido", () => {
    expect(exportSummary({ pageCount: 5 }, ["instagram:carousel"])).toContain("Se exportan las 5 láminas como PNG, se suman a los archivos de la pieza y quedan elegidas en orden en la red.");
    expect(exportSummary({ pageCount: 5 }, ["instagram:carousel", "linkedin:pdf"])).toContain("(y un PDF para LinkedIn)");
  });

  it("una sola página es una imagen", () => {
    expect(exportSummary({ pageCount: 1 }, ["instagram:image"])).toContain("Se exportan las 1 imagen como PNG");
  });

  it("solo LinkedIn: un PDF con todas las páginas", () => {
    expect(exportSummary({ pageCount: 6 }, ["linkedin:pdf"])).toBe("Se exporta un PDF con todas las páginas, se suma a los archivos de la pieza y queda elegido en la red.");
  });
});

describe("el menú «En contenido ▾»", () => {
  const info: ContentLinkInfo = {
    postId: "p1",
    title: "Una pieza",
    statusLabel: "Programado",
    href: "/dashboard/content?piece=p1",
    network: "instagram",
    networks: [
      { platform: "instagram", label: "Instagram Carrusel", state: "sched", stateLabel: "Programado" },
      { platform: "linkedin", label: "LinkedIn Carrusel PDF", state: "none", stateLabel: "Sin fecha" },
    ],
  };

  it("muestra la pieza, su estado y sus redes", () => {
    expect(linkedMenuView(info)).toEqual({ title: "Una pieza", summary: "Programado · Instagram Carrusel · LinkedIn Carrusel PDF", networks: info.networks });
    expect(linkedMenuView(null)).toBeNull();
  });

  it("los textos del botón y del menú son los del prototipo", () => {
    expect(USE_IN_CONTENT_TEXT.button).toBe("Usar en contenido");
    expect(USE_IN_CONTENT_TEXT.buttonLinked).toBe("En contenido ▾");
    expect(USE_IN_CONTENT_TEXT.openPiece).toBe("Abrir la pieza");
    expect(USE_IN_CONTENT_TEXT.sendChanges).toBe("Enviar los cambios a la pieza");
    expect(USE_IN_CONTENT_TEXT.unlink).toBe("Desvincular");
    expect(USE_IN_CONTENT_TEXT.modeNew).toBe("Crear una pieza nueva");
    expect(USE_IN_CONTENT_TEXT.modeLink).toBe("Vincular a una pieza existente");
    expect(USE_IN_CONTENT_TEXT.alreadyHasDesign).toBe("ya tiene un diseño (se suma este)");
  });

  it("después de enviar los cambios: lo que pasó, dicho claro", () => {
    expect(syncMessage({ queued: true })).toMatchObject({ tone: "ok", openPiece: false });
    expect(syncMessage({ queued: false })).toMatchObject({ text: "Ya hay una actualización en camino." });
    expect(syncMessage({ queued: false, needsConfirmation: true })).toMatchObject({ tone: "info", openPiece: true });
    expect(syncMessage({ queued: false, published: true })).toMatchObject({ tone: "info", text: expect.stringContaining("ya se publicó") });
  });
});
