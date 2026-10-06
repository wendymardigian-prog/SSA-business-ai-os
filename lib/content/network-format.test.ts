import { describe, expect, it } from "vitest";
import type { MediaEntry } from "./media";
import {
  NETWORK_FORMATS,
  changeFormat,
  checkFormatFiles,
  eligibleFiles,
  formatFromOptions,
  formatsFor,
  getFormat,
  moveFile,
  optionsForFormat,
  requirementText,
  resolveNetworkOptions,
  suggestFormat,
  toggleFile,
} from "./network-format";
import { resolveNetworkContent, type NetworkEntry } from "./redistribution";

const file = (id: string, kind: MediaEntry["kind"], over: Partial<MediaEntry> = {}): MediaEntry => ({
  id,
  storage_path: `ws/post/${id}.${kind === "video" ? "mp4" : kind === "document" ? "pdf" : "jpg"}`,
  mime_type: kind === "video" ? "video/mp4" : kind === "document" ? "application/pdf" : "image/jpeg",
  kind,
  size_bytes: 1024 * 1024,
  ...over,
});

const V1 = file("v1", "video");
const I1 = file("i1", "image");
const I2 = file("i2", "image");
const I3 = file("i3", "image");
const D1 = file("d1", "document");
const LIB = [V1, I1, I2, I3, D1];

const def = (platform: string, id: string) => {
  const d = getFormat(platform, id);
  if (!d) throw new Error(`no existe ${platform}/${id}`);
  return d;
};

describe("los formatos de cada red (F93)", () => {
  it("son los del plano, por red", () => {
    const ids = (p: string) => formatsFor(p).map((f) => f.id);
    expect(ids("instagram")).toEqual(["reel", "carousel", "image", "story"]);
    expect(ids("tiktok")).toEqual(["video", "photos"]);
    expect(ids("youtube")).toEqual(["video", "short"]);
    expect(ids("linkedin")).toEqual(["text", "image", "pdf", "video"]);
    expect(ids("threads")).toEqual(["text", "image", "carousel", "video"]);
  });

  it("una red desconocida no tiene formatos", () => {
    expect(formatsFor("facebook")).toEqual([]);
    expect(getFormat("facebook", "reel")).toBeNull();
    expect(getFormat("instagram", "inventado")).toBeNull();
  });

  it("Reel, Video y Short piden 1 video", () => {
    for (const [p, f] of [["instagram", "reel"], ["tiktok", "video"], ["youtube", "video"], ["youtube", "short"], ["linkedin", "video"], ["threads", "video"]]) {
      expect(def(p, f)).toMatchObject({ kinds: ["video"], min: 1, max: 1 });
    }
  });

  it("Imagen pide 1 imagen", () => {
    for (const p of ["instagram", "linkedin", "threads"]) {
      expect(def(p, "image")).toMatchObject({ kinds: ["image"], min: 1, max: 1 });
    }
  });

  it("el carrusel de Instagram y de Threads pide de 2 a 10 imagenes, el de fotos de TikTok de 2 a 35", () => {
    expect(def("instagram", "carousel")).toMatchObject({ kinds: ["image"], min: 2, max: 10 });
    expect(def("threads", "carousel")).toMatchObject({ kinds: ["image"], min: 2, max: 10 });
    expect(def("tiktok", "photos")).toMatchObject({ kinds: ["image"], min: 2, max: 35 });
  });

  it("el carrusel PDF de LinkedIn pide 1 PDF", () => {
    expect(def("linkedin", "pdf")).toMatchObject({ kinds: ["document"], min: 1, max: 1 });
  });

  it("la Story acepta 1 archivo, imagen o video", () => {
    expect(def("instagram", "story")).toMatchObject({ kinds: ["image", "video"], min: 1, max: 1 });
  });

  it("Solo texto no pide ningun archivo", () => {
    expect(def("linkedin", "text")).toMatchObject({ min: 0, max: 0 });
    expect(def("threads", "text")).toMatchObject({ min: 0, max: 0 });
  });

  it("todas las etiquetas y pistas estan escritas", () => {
    for (const defs of Object.values(NETWORK_FORMATS)) {
      for (const d of defs) {
        expect(d.label.length).toBeGreaterThan(0);
        expect(requirementText(d).length).toBeGreaterThan(0);
      }
    }
  });
});

describe("que pide cada formato, en palabras", () => {
  it("dice cantidad y tipo", () => {
    expect(requirementText(def("instagram", "reel"))).toBe("1 video");
    expect(requirementText(def("instagram", "image"))).toBe("1 imagen");
    expect(requirementText(def("instagram", "carousel"))).toBe("de 2 a 10 imágenes, en orden");
    expect(requirementText(def("linkedin", "pdf"))).toBe("1 PDF");
    expect(requirementText(def("instagram", "story"))).toBe("1 archivo (imagen o video)");
    expect(requirementText(def("threads", "text"))).toBe("ningún archivo");
  });
});

describe("el selector se filtra por el formato elegido (F93)", () => {
  it("un carrusel solo ofrece imagenes", () => {
    expect(eligibleFiles(def("instagram", "carousel"), LIB).map((m) => m.id)).toEqual(["i1", "i2", "i3"]);
  });

  it("un Reel solo ofrece videos, y un PDF solo documentos", () => {
    expect(eligibleFiles(def("instagram", "reel"), LIB).map((m) => m.id)).toEqual(["v1"]);
    expect(eligibleFiles(def("linkedin", "pdf"), LIB).map((m) => m.id)).toEqual(["d1"]);
  });

  it("la Story ofrece imagenes y videos, no documentos", () => {
    expect(eligibleFiles(def("instagram", "story"), LIB).map((m) => m.id)).toEqual(["v1", "i1", "i2", "i3"]);
  });

  it("Solo texto no ofrece nada", () => {
    expect(eligibleFiles(def("threads", "text"), LIB)).toEqual([]);
  });

  it("no ofrece los archivos ya borrados", () => {
    const borrado = file("i9", "image", { deleted_at: "2026-10-01T00:00:00Z" });
    expect(eligibleFiles(def("instagram", "image"), [borrado, I1]).map((m) => m.id)).toEqual(["i1"]);
  });
});

describe("la linea de verificacion (F93)", () => {
  it("VERDE: dice que publica y en que orden", () => {
    expect(checkFormatFiles(def("instagram", "carousel"), [I1, I2, I3])).toEqual({
      ok: true,
      message: "Publica 3 imágenes en ese orden",
    });
    expect(checkFormatFiles(def("instagram", "reel"), [V1])).toEqual({ ok: true, message: "Publica 1 video" });
    expect(checkFormatFiles(def("threads", "text"), [])).toEqual({ ok: true, message: "Publica solo texto" });
  });

  it("ROJO: un carrusel con un solo archivo", () => {
    const r = checkFormatFiles(def("instagram", "carousel"), [I1]);

    expect(r.ok).toBe(false);
    expect(r.message).toBe("Faltan archivos: este formato pide entre 2 y 10");
  });

  it("ROJO: sin ningun archivo", () => {
    expect(checkFormatFiles(def("instagram", "reel"), [])).toEqual({
      ok: false,
      message: "Faltan archivos: este formato pide 1 video",
    });
  });

  it("ROJO: de mas", () => {
    const r = checkFormatFiles(def("instagram", "reel"), [V1, V1]);

    expect(r.ok).toBe(false);
    expect(r.message).toContain("Sobran archivos");
  });

  it("ROJO: un archivo de un tipo que el formato no admite", () => {
    const r = checkFormatFiles(def("instagram", "reel"), [I1]);

    expect(r.ok).toBe(false);
    expect(r.message).toContain("no sirve");
  });

  it("ROJO: Solo texto con un archivo", () => {
    expect(checkFormatFiles(def("linkedin", "text"), [I1]).ok).toBe(false);
  });

  it("el limite del carrusel de TikTok es 35, no 10", () => {
    const muchas = Array.from({ length: 35 }, (_, i) => file(`x${i}`, "image"));
    expect(checkFormatFiles(def("tiktok", "photos"), muchas).ok).toBe(true);
    expect(checkFormatFiles(def("tiktok", "photos"), [...muchas, I1]).ok).toBe(false);
  });
});

describe("cambiar de formato (F93)", () => {
  const reel: NetworkEntry = { platform: "instagram", format: "reel", files: ["v1"] };

  it("de Reel a Carrusel el video se va de esa red, y se propone el carrusel valido", () => {
    const next = changeFormat(reel, "carousel", LIB);

    expect(next.format).toBe("carousel");
    expect(next.files).not.toContain("v1");
    expect(next.files).toEqual(["i1", "i2", "i3"]);
  });

  it("el video queda en la biblioteca: cambiar de formato no borra archivos", () => {
    // changeFormat solo devuelve la red; la biblioteca ni se mira para escribir.
    const antes = JSON.stringify(LIB);
    changeFormat(reel, "carousel", LIB);
    expect(JSON.stringify(LIB)).toBe(antes);
  });

  it("conserva los archivos que siguen sirviendo, en su orden", () => {
    const carrusel: NetworkEntry = { platform: "instagram", format: "carousel", files: ["i3", "i1"] };
    const next = changeFormat(carrusel, "story", LIB);

    // La story admite 1: se queda con el primero.
    expect(next.files).toEqual(["i3"]);
  });

  it("de carrusel a imagen deja una sola", () => {
    const carrusel: NetworkEntry = { platform: "instagram", format: "carousel", files: ["i2", "i1", "i3"] };

    expect(changeFormat(carrusel, "image", LIB).files).toEqual(["i2"]);
  });

  it("si no hay nada valido para proponer, queda vacio (y la verificacion lo pone en rojo)", () => {
    const soloVideo = [V1];
    const next = changeFormat(reel, "carousel", soloVideo);

    expect(next.files).toEqual([]);
  });

  it("un carrusel no se propone con menos de 2 imagenes disponibles", () => {
    const next = changeFormat(reel, "carousel", [V1, I1]);

    expect(next.files).toEqual([]);
  });

  it("a Solo texto se descartan todos los archivos", () => {
    const next = changeFormat({ platform: "linkedin", format: "image", files: ["i1"] }, "text", LIB);

    expect(next.files).toEqual([]);
  });

  it("deja de usar la media propia del modelo anterior", () => {
    const vieja: NetworkEntry = { platform: "instagram", media: [{ storage_path: "x" }] };

    expect(changeFormat(vieja, "reel", LIB).media).toBeNull();
  });

  it("no muta la red que recibe", () => {
    const copia = JSON.stringify(reel);
    changeFormat(reel, "carousel", LIB);
    expect(JSON.stringify(reel)).toBe(copia);
  });

  it("un formato que la red no tiene no cambia nada", () => {
    expect(changeFormat(reel, "inventado", LIB)).toEqual(reel);
  });
});

describe("elegir y ordenar archivos (F93, D4)", () => {
  const carrusel = def("instagram", "carousel");
  const reel = def("instagram", "reel");

  it("tocar un archivo lo agrega al final: el orden es el de seleccion", () => {
    expect(toggleFile(["i1"], "i3", carrusel)).toEqual(["i1", "i3"]);
  });

  it("tocar uno ya elegido lo saca", () => {
    expect(toggleFile(["i1", "i2"], "i1", carrusel)).toEqual(["i2"]);
  });

  it("en un formato de 1 archivo, elegir otro REEMPLAZA en vez de sumar", () => {
    expect(toggleFile(["v1"], "v2", reel)).toEqual(["v2"]);
  });

  it("no pasa del maximo del formato", () => {
    const diez = Array.from({ length: 10 }, (_, i) => `x${i}`);
    expect(toggleFile(diez, "otro", carrusel)).toEqual(diez);
  });

  it("↑ sube un lugar y ↓ baja un lugar", () => {
    expect(moveFile(["a", "b", "c"], "b", "up")).toEqual(["b", "a", "c"]);
    expect(moveFile(["a", "b", "c"], "b", "down")).toEqual(["a", "c", "b"]);
  });

  it("el primero no sube y el ultimo no baja", () => {
    expect(moveFile(["a", "b"], "a", "up")).toEqual(["a", "b"]);
    expect(moveFile(["a", "b"], "b", "down")).toEqual(["a", "b"]);
  });

  it("un id que no esta no cambia nada", () => {
    expect(moveFile(["a", "b"], "z", "up")).toEqual(["a", "b"]);
  });

  it("no muta la lista", () => {
    const lista = ["a", "b", "c"];
    moveFile(lista, "b", "up");
    expect(lista).toEqual(["a", "b", "c"]);
  });

  it("CRITERIO: reordenar con ↑ cambia el orden guardado Y el de lo que se publica", () => {
    const red: NetworkEntry = { platform: "instagram", format: "carousel", files: ["i1", "i2", "i3"] };
    const movida = { ...red, files: moveFile(red.files!, "i3", "up") };

    expect(movida.files).toEqual(["i1", "i3", "i2"]);

    // Lo que ve la vista previa y lo que sale: el mismo resolutor.
    const resolved = resolveNetworkContent<MediaEntry>({ network: movida, baseCaption: "x", baseMedia: LIB });
    expect(resolved.media.map((m) => m.id)).toEqual(["i1", "i3", "i2"]);
  });
});

describe("el formato completa las opciones del publicador (F93)", () => {
  it("Instagram: el tipo de contenido", () => {
    expect(optionsForFormat("instagram", "reel")).toEqual({ contentType: "reel" });
    expect(optionsForFormat("instagram", "carousel")).toEqual({ contentType: "carousel" });
    expect(optionsForFormat("instagram", "image")).toEqual({ contentType: "feed" });
    expect(optionsForFormat("instagram", "story")).toEqual({ contentType: "story" });
  });

  it("TikTok: video o fotos", () => {
    expect(optionsForFormat("tiktok", "video")).toEqual({ mediaType: "video" });
    expect(optionsForFormat("tiktok", "photos")).toEqual({ mediaType: "photo" });
  });

  it("LinkedIn: el tipo de publicacion", () => {
    expect(optionsForFormat("linkedin", "pdf")).toEqual({ postType: "document" });
    expect(optionsForFormat("linkedin", "text")).toEqual({ postType: "text" });
  });

  it("YouTube y Threads no agregan nada: el Short lo decide YouTube por el video", () => {
    expect(optionsForFormat("youtube", "short")).toEqual({});
    expect(optionsForFormat("threads", "carousel")).toEqual({});
  });

  it("sin formato o con uno desconocido, no agrega nada", () => {
    expect(optionsForFormat("instagram", null)).toEqual({});
    expect(optionsForFormat("instagram", "inventado")).toEqual({});
  });

  it("resolveNetworkOptions mezcla: el formato gana sobre un contentType viejo", () => {
    const red: NetworkEntry = { platform: "instagram", format: "reel", options: { contentType: "feed", shareToFeed: true } };

    expect(resolveNetworkOptions(red)).toEqual({ contentType: "reel", shareToFeed: true });
  });

  it("sin formato deja las opciones como estaban", () => {
    expect(resolveNetworkOptions({ platform: "instagram", options: { contentType: "story" } })).toEqual({
      contentType: "story",
    });
    expect(resolveNetworkOptions({ platform: "tiktok" })).toEqual({});
  });
});

describe("inferir el formato de lo que ya estaba guardado", () => {
  it("Instagram sale del contentType", () => {
    expect(formatFromOptions("instagram", { contentType: "reel" })).toBe("reel");
    expect(formatFromOptions("instagram", { contentType: "carousel" })).toBe("carousel");
    expect(formatFromOptions("instagram", { contentType: "story" })).toBe("story");
    expect(formatFromOptions("instagram", { contentType: "feed" })).toBe("image");
  });

  it("LinkedIn sale del postType", () => {
    expect(formatFromOptions("linkedin", { postType: "document" })).toBe("pdf");
    expect(formatFromOptions("linkedin", { postType: "video" })).toBe("video");
  });

  it("el resto tiene un valor por defecto razonable", () => {
    expect(formatFromOptions("tiktok", {})).toBe("video");
    expect(formatFromOptions("youtube", {})).toBe("video");
    expect(formatFromOptions("threads", {})).toBe("text");
  });
});

describe("sugerir el formato de una red desde el de la pieza", () => {
  it("un Reel es Reel en Instagram y video en TikTok", () => {
    expect(suggestFormat("instagram", "Reel")).toBe("reel");
    expect(suggestFormat("tiktok", "Reel")).toBe("video");
    expect(suggestFormat("youtube", "Reel")).toBe("video");
  });

  it("un Short es Short en YouTube", () => {
    expect(suggestFormat("youtube", "Short")).toBe("short");
  });

  it("un carrusel es carrusel, fotos en TikTok y PDF en LinkedIn", () => {
    expect(suggestFormat("instagram", "Carrusel")).toBe("carousel");
    expect(suggestFormat("tiktok", "Carrusel")).toBe("photos");
    expect(suggestFormat("linkedin", "Carrusel")).toBe("pdf");
    expect(suggestFormat("threads", "Carrusel")).toBe("carousel");
  });

  it("una imagen es imagen, y una historia es Story solo en Instagram", () => {
    expect(suggestFormat("instagram", "Imagen")).toBe("image");
    expect(suggestFormat("instagram", "Historia")).toBe("story");
    expect(suggestFormat("linkedin", "Historia")).toBe("image");
  });

  it("texto es Solo texto donde se puede, y nada donde no", () => {
    expect(suggestFormat("linkedin", "Texto")).toBe("text");
    expect(suggestFormat("threads", "Texto")).toBe("text");
    expect(suggestFormat("instagram", "Texto")).toBeNull();
  });

  it("un formato que no se reconoce no inventa nada", () => {
    expect(suggestFormat("instagram", "Otra cosa")).toBeNull();
    expect(suggestFormat("instagram", null)).toBeNull();
    expect(suggestFormat("instagram", "")).toBeNull();
  });
});
