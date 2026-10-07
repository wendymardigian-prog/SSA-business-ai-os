import { describe, expect, it } from "vitest";
import type { MediaEntry } from "./media";
import { cleanExternalUrl, keepServerFields, normalizeNetworks, parseNewMediaEntry } from "./networks-schema";

const file = (id: string, kind: MediaEntry["kind"] = "image"): MediaEntry => ({
  id,
  storage_path: `ws/post/${id}.jpg`,
  mime_type: "image/jpeg",
  kind,
  size_bytes: 1000,
});

const LIB = [file("a"), file("b"), file("c"), file("v", "video")];

const ok = (raw: unknown, library: MediaEntry[] = LIB) => {
  const r = normalizeNetworks(raw, library);
  if (!r.ok) throw new Error(`esperaba ok y dio: ${r.error}`);
  return r.networks;
};
const bad = (raw: unknown, library: MediaEntry[] = LIB) => {
  const r = normalizeNetworks(raw, library);
  if (r.ok) throw new Error("esperaba un error y paso");
  return r.error;
};

describe("normalizeNetworks: lo que el servidor acepta como redes (F93)", () => {
  it("una lista vacia es valida: una pieza sin redes", () => {
    expect(ok([])).toEqual([]);
  });

  it("acepta una red como la deja createPost", () => {
    const red = { platform: "instagram", planned_at: null, caption: null, media: null, cta: { type: "none", keyword: null }, options: {} };

    expect(ok([red])).toHaveLength(1);
  });

  it("conserva lo que no conoce (needs_review, claves nuevas): no se pierde nada al guardar", () => {
    const [n] = ok([{ platform: "tiktok", needs_review: true, algo_nuevo: 1 }]);

    expect(n).toMatchObject({ needs_review: true, algo_nuevo: 1 });
  });

  it("rechaza algo que no es una lista", () => {
    expect(bad({ platform: "instagram" })).toContain("redes");
    expect(bad("instagram")).toContain("redes");
    expect(bad(null)).toContain("redes");
  });

  it("rechaza una red desconocida", () => {
    expect(bad([{ platform: "facebook" }])).toMatch(/plataforma|platform/i);
  });

  it("rechaza dos entradas de la misma red (hay una publicacion por red y pieza)", () => {
    expect(bad([{ platform: "instagram" }, { platform: "instagram" }])).toContain("instagram");
  });

  it("rechaza una fecha que no es fecha", () => {
    expect(bad([{ platform: "instagram", planned_at: "manana a la tarde" }])).toMatch(/fecha/i);
  });

  it("acepta una fecha ISO con Z o con offset", () => {
    expect(ok([{ platform: "instagram", planned_at: "2026-10-10T15:00:00Z" }])).toHaveLength(1);
    expect(ok([{ platform: "instagram", planned_at: "2026-10-10T09:00:00-06:00" }])).toHaveLength(1);
  });

  it("rechaza un tipo de CTA que no existe", () => {
    expect(bad([{ platform: "instagram", cta: { type: "gritar" } }])).toMatch(/cta/i);
  });

  it("rechaza opciones que no son un objeto", () => {
    expect(bad([{ platform: "tiktok", options: "publico" }])).toMatch(/opciones|options/i);
    expect(bad([{ platform: "tiktok", options: [1, 2] }])).toMatch(/opciones|options/i);
  });

  it("rechaza mas de cinco redes", () => {
    const seis = ["instagram", "tiktok", "youtube", "linkedin", "threads", "instagram"].map((platform) => ({ platform }));
    expect(bad(seis)).toBeTruthy();
  });

  it("un caption absurdamente largo se rechaza: la red tiene su limite y esto es solo un techo", () => {
    expect(bad([{ platform: "instagram", caption: "x".repeat(30_000) }])).toMatch(/caption/i);
  });
});

describe("el formato (F93)", () => {
  it("acepta un formato que la red tiene", () => {
    expect(ok([{ platform: "instagram", format: "reel", files: ["v"] }])[0].format).toBe("reel");
  });

  it("rechaza un formato que la red NO tiene, nombrandolo", () => {
    const error = bad([{ platform: "instagram", format: "pdf", files: [] }]);

    expect(error).toContain("pdf");
    expect(error).toContain("instagram");
  });

  it("un formato sin `files` los deja en una lista vacia, no en 'toda la base'", () => {
    expect(ok([{ platform: "instagram", format: "reel" }])[0].files).toEqual([]);
  });

  it("sin formato ni files la red queda en el modelo anterior", () => {
    const [n] = ok([{ platform: "instagram" }]);

    expect(n.format ?? null).toBeNull();
    expect(n.files).toBeUndefined();
  });
});

describe("los archivos contra la biblioteca (F92)", () => {
  it("deja los ids que existen, en el orden recibido", () => {
    expect(ok([{ platform: "instagram", format: "carousel", files: ["c", "a", "b"] }])[0].files).toEqual(["c", "a", "b"]);
  });

  it("descarta un id que no esta en la biblioteca: otra pestaña pudo haberlo quitado", () => {
    expect(ok([{ platform: "instagram", format: "carousel", files: ["a", "fantasma", "b"] }])[0].files).toEqual(["a", "b"]);
  });

  it("no repite un id", () => {
    expect(ok([{ platform: "instagram", format: "carousel", files: ["a", "a", "b"] }])[0].files).toEqual(["a", "b"]);
  });

  it("no cuenta un archivo borrado de la biblioteca", () => {
    const borrado = { ...file("z"), deleted_at: "2026-10-01T00:00:00Z" };
    expect(ok([{ platform: "instagram", format: "image", files: ["z"] }], [borrado])[0].files).toEqual([]);
  });

  it("encuentra por el id deducido del path a los archivos de antes de F92", () => {
    const sinId: MediaEntry = { storage_path: "ws/post/uuid-9.jpg", mime_type: "image/jpeg", kind: "image", size_bytes: 1 };
    expect(ok([{ platform: "instagram", format: "image", files: ["uuid-9"] }], [sinId])[0].files).toEqual(["uuid-9"]);
  });

  it("mas de 35 ids es demasiado para cualquier formato", () => {
    const muchos = Array.from({ length: 40 }, (_, i) => `x${i}`);
    expect(bad([{ platform: "tiktok", format: "photos", files: muchos }])).toBeTruthy();
  });
});

describe("parseNewMediaEntry: lo que el servidor acepta de una subida (F92)", () => {
  const good = {
    path: "ws-1/post-1/abc.jpg",
    mime: "image/jpeg",
    kind: "image" as const,
    sizeBytes: 12345,
  };

  it("arma la entrada con un id y el nombre limpio", () => {
    const r = parseNewMediaEntry({ ...good, name: "mi portada.jpg", width: 1080, height: 1920 });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entry).toMatchObject({
      id: "abc",
      name: "mi portada.jpg",
      storage_path: "ws-1/post-1/abc.jpg",
      mime_type: "image/jpeg",
      kind: "image",
      size_bytes: 12345,
      width: 1080,
      height: 1920,
    });
  });

  it("el tipo tiene que cuadrar con el mime: un jpg no es un video", () => {
    expect(parseNewMediaEntry({ ...good, kind: "video" }).ok).toBe(false);
  });

  it("rechaza un mime que no se publica (audio, ejecutables)", () => {
    expect(parseNewMediaEntry({ ...good, mime: "audio/mpeg", kind: "document" }).ok).toBe(false);
    expect(parseNewMediaEntry({ ...good, mime: "application/x-msdownload" }).ok).toBe(false);
  });

  it("el nombre no puede traer barras ni caracteres de control: se limpia", () => {
    const r = parseNewMediaEntry({ ...good, name: "../../etc/passwd\u0000.jpg" });

    expect(r.ok && r.entry.name).not.toContain("/");
    expect(r.ok && r.entry.name).not.toContain("\u0000");
  });

  it("un nombre larguisimo se recorta", () => {
    const r = parseNewMediaEntry({ ...good, name: "a".repeat(500) });

    expect(r.ok && (r.entry.name ?? "").length).toBeLessThanOrEqual(200);
  });

  it("dimensiones o duracion absurdas se descartan sin rechazar la subida", () => {
    const r = parseNewMediaEntry({ ...good, width: -5, height: 99999999, durationMs: -1 });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entry.width ?? null).toBeNull();
    expect(r.entry.height ?? null).toBeNull();
    expect(r.entry.duration_ms ?? null).toBeNull();
  });

  it("un tamano cero o negativo se rechaza", () => {
    expect(parseNewMediaEntry({ ...good, sizeBytes: 0 }).ok).toBe(false);
    expect(parseNewMediaEntry({ ...good, sizeBytes: -1 }).ok).toBe(false);
  });
});

describe("Contenido v4 · lo que solo escribe el servidor", () => {
  it("el autoguardado no puede prender 'el sistema la publica' ni inventar un publicado a mano", () => {
    const stored = [{ platform: "instagram", auto: false }];
    const incoming = [
      {
        platform: "instagram",
        caption: "nuevo",
        auto: true,
        published_manually_at: "2026-10-01T10:00:00.000Z",
        external_url: "https://evil.test",
        status_before_manual: "approved" as const,
      },
    ];
    const [out] = keepServerFields(incoming, stored);
    expect(out.caption).toBe("nuevo");
    expect(out.auto).toBe(false);
    expect(out).not.toHaveProperty("published_manually_at");
    expect(out).not.toHaveProperty("external_url");
    expect(out).not.toHaveProperty("status_before_manual");
  });

  it("conserva lo guardado aunque el navegador no lo mande", () => {
    const stored = [
      {
        platform: "youtube",
        auto: false,
        published_manually_at: "2026-10-15T16:00:00.000Z",
        external_url: "https://youtu.be/abc",
        status_before_manual: "draft" as const,
      },
    ];
    const [out] = keepServerFields([{ platform: "youtube", planned_at: null }], stored);
    expect(out).toMatchObject(stored[0]);
  });

  it("una red nueva arranca sin campos del servidor", () => {
    const [out] = keepServerFields([{ platform: "threads", auto: true }], []);
    expect(out).not.toHaveProperty("auto");
  });

  it("la forma de los campos nuevos se valida igual", () => {
    expect(normalizeNetworks([{ platform: "instagram", auto: "si" }], []).ok).toBe(false);
    expect(normalizeNetworks([{ platform: "instagram", auto: true }], []).ok).toBe(true);
  });
});

describe("Contenido v4 · el link de una publicacion a mano", () => {
  it("vacio es valido: el link es opcional", () => {
    expect(cleanExternalUrl("")).toEqual({ ok: true, url: null });
    expect(cleanExternalUrl(null)).toEqual({ ok: true, url: null });
  });

  it("acepta https y lo normaliza", () => {
    expect(cleanExternalUrl("  https://www.youtube.com/watch?v=abc ")).toEqual({
      ok: true,
      url: "https://www.youtube.com/watch?v=abc",
    });
  });

  it("rechaza lo que no es un link web", () => {
    expect(cleanExternalUrl("javascript:alert(1)").ok).toBe(false);
    expect(cleanExternalUrl("youtube punto com").ok).toBe(false);
  });
});

describe("Contenido v4 · C10, 'Publicar por' ya no es de la pieza", () => {
  it("normalizeNetworks descarta publisher: el efectivo es siempre el de la cuenta", () => {
    const result = normalizeNetworks([{ platform: "instagram", publisher: "postproxy" }], []);
    if (!result.ok) throw new Error(result.error);
    expect(result.networks[0]).not.toHaveProperty("publisher");
  });
});
