import { describe, expect, it } from "vitest";
import type { MediaEntry } from "./media";
import {
  aspectRatioLabel,
  describeFile,
  displayName,
  ensureMediaIds,
  idOf,
  mediaIdFor,
  networkFileIds,
  removeFileFromNetworks,
  unusedFiles,
  usageByFile,
} from "./media-library";
import type { NetworkEntry } from "./redistribution";

const entry = (over: Partial<MediaEntry> & { storage_path: string }): MediaEntry => ({
  mime_type: "image/jpeg",
  kind: "image",
  size_bytes: 2 * 1024 * 1024,
  ...over,
});

const A = entry({ storage_path: "ws/post/aaaa-1111.jpg", name: "portada.jpg", width: 1080, height: 1920 });
const B = entry({ storage_path: "ws/post/bbbb-2222.mp4", mime_type: "video/mp4", kind: "video", size_bytes: 30 * 1024 * 1024 });
const C = entry({ storage_path: "ws/post/cccc-3333.png", kind: "image" });

describe("ids estables (F92)", () => {
  it("el id se deduce del path: el nombre del archivo sin extension", () => {
    expect(mediaIdFor("ws-1/post-1/3f2a-9b1c.mp4")).toBe("3f2a-9b1c");
  });

  it("no cambia entre lecturas: es una funcion del path y de nada mas", () => {
    expect(mediaIdFor(A.storage_path)).toBe(mediaIdFor(A.storage_path));
    expect(mediaIdFor(A.storage_path)).not.toBe(mediaIdFor(B.storage_path));
  });

  it("un id guardado gana sobre el deducido", () => {
    expect(idOf({ ...A, id: "mio" })).toBe("mio");
    expect(idOf(A)).toBe("aaaa-1111");
  });

  it("ensureMediaIds les da id a los que no lo tienen y no toca el resto", () => {
    const out = ensureMediaIds([A, { ...B, id: "ya-tenia" }]);

    expect(out.map((m) => m.id)).toEqual(["aaaa-1111", "ya-tenia"]);
    expect(out[0].storage_path).toBe(A.storage_path);
  });

  it("no muta lo que recibe", () => {
    const original = [A];
    ensureMediaIds(original);
    expect(original[0].id).toBeUndefined();
  });
});

describe("que redes usan cada archivo (F92)", () => {
  const networks: NetworkEntry[] = [
    { platform: "instagram", files: ["aaaa-1111", "cccc-3333"] },
    { platform: "tiktok", files: ["bbbb-2222"] },
    { platform: "threads", files: [] },
  ];

  it("por red, en el orden de las redes", () => {
    const uso = usageByFile([A, B, C], networks);

    expect(uso.get("aaaa-1111")).toEqual(["instagram"]);
    expect(uso.get("bbbb-2222")).toEqual(["tiktok"]);
    expect(uso.get("cccc-3333")).toEqual(["instagram"]);
  });

  it("un archivo que usan dos redes dice las dos", () => {
    const uso = usageByFile([A], [
      { platform: "instagram", files: ["aaaa-1111"] },
      { platform: "threads", files: ["aaaa-1111"] },
    ]);

    expect(uso.get("aaaa-1111")).toEqual(["instagram", "threads"]);
  });

  it("un archivo que ninguna red usa queda 'sin usar'", () => {
    const sin = unusedFiles([A, B, C], [{ platform: "instagram", files: ["aaaa-1111"] }]);

    expect(sin.map((m) => m.storage_path)).toEqual([B.storage_path, C.storage_path]);
  });

  it("sin ninguna red, todo esta sin usar", () => {
    expect(unusedFiles([A, B], [])).toHaveLength(2);
  });

  it("no cuenta los archivos ya borrados de una pieza publicada", () => {
    const borrado = { ...C, deleted_at: "2026-10-01T00:00:00Z" };
    expect(unusedFiles([A, borrado], [])).toHaveLength(1);
  });

  it("MODELO ANTERIOR: una red sin `files` ni media propia usaba TODA la base", () => {
    const viejas: NetworkEntry[] = [{ platform: "instagram" }];

    expect(networkFileIds(viejas[0], [A, B])).toEqual(["aaaa-1111", "bbbb-2222"]);
    expect(unusedFiles([A, B], viejas)).toEqual([]);
  });

  it("MODELO ANTERIOR: una red con media propia usaba esa y no la base", () => {
    const propia: NetworkEntry = { platform: "instagram", media: [{ storage_path: A.storage_path }] };

    expect(networkFileIds(propia, [A, B])).toEqual(["aaaa-1111"]);
  });

  it("MODELO NUEVO: `files` gana sobre `media`", () => {
    const mixta: NetworkEntry = {
      platform: "instagram",
      files: ["cccc-3333"],
      media: [{ storage_path: A.storage_path }],
    };

    expect(networkFileIds(mixta, [A, B, C])).toEqual(["cccc-3333"]);
  });

  it("`files` con un id que ya no esta en la biblioteca lo ignora", () => {
    expect(networkFileIds({ platform: "instagram", files: ["fantasma", "aaaa-1111"] }, [A])).toEqual(["aaaa-1111"]);
  });
});

describe("quitar un archivo de las redes (F92)", () => {
  const networks: NetworkEntry[] = [
    { platform: "instagram", files: ["aaaa-1111", "cccc-3333"] },
    { platform: "tiktok", files: ["bbbb-2222"] },
    { platform: "threads", files: ["cccc-3333"] },
  ];

  it("lo saca de todas las redes que lo usan y dice cuales eran", () => {
    const { networks: out, affected } = removeFileFromNetworks(networks, "cccc-3333");

    expect(affected).toEqual(["instagram", "threads"]);
    expect(out[0].files).toEqual(["aaaa-1111"]);
    expect(out[1].files).toEqual(["bbbb-2222"]);
    expect(out[2].files).toEqual([]);
  });

  it("conserva el orden de los que quedan", () => {
    const { networks: out } = removeFileFromNetworks(
      [{ platform: "instagram", files: ["a", "b", "c", "d"] }],
      "b",
    );

    expect(out[0].files).toEqual(["a", "c", "d"]);
  });

  it("un archivo que nadie usa no cambia nada y no avisa a nadie", () => {
    const { networks: out, affected } = removeFileFromNetworks(networks, "no-lo-usa-nadie");

    expect(affected).toEqual([]);
    expect(out).toEqual(networks);
  });

  it("no muta las redes que recibe", () => {
    const copia = JSON.parse(JSON.stringify(networks));
    removeFileFromNetworks(networks, "cccc-3333");
    expect(networks).toEqual(copia);
  });

  it("las redes del modelo anterior (sin `files`) no se tocan", () => {
    const { networks: out, affected } = removeFileFromNetworks([{ platform: "instagram" }], "aaaa-1111");

    expect(affected).toEqual([]);
    expect(out).toEqual([{ platform: "instagram" }]);
  });
});

describe("como se muestra un archivo", () => {
  it("la proporcion usa las conocidas y no inventa decimales", () => {
    expect(aspectRatioLabel(1080, 1920)).toBe("9:16");
    expect(aspectRatioLabel(1920, 1080)).toBe("16:9");
    expect(aspectRatioLabel(1080, 1080)).toBe("1:1");
    expect(aspectRatioLabel(1080, 1350)).toBe("4:5");
    expect(aspectRatioLabel(1200, 628)).toBe("1.91:1");
  });

  it("sin dimensiones no hay proporcion", () => {
    expect(aspectRatioLabel(null, null)).toBeNull();
    expect(aspectRatioLabel(0, 100)).toBeNull();
    expect(aspectRatioLabel(undefined, 100)).toBeNull();
  });

  it("el nombre original si lo hay; si no, tipo y numero de orden", () => {
    expect(displayName(A, 0)).toBe("portada.jpg");
    expect(displayName(B, 1)).toBe("Video 2");
    expect(displayName(C, 2)).toBe("Imagen 3");
    expect(displayName(entry({ storage_path: "a/b/c.pdf", kind: "document" }), 0)).toBe("Documento 1");
  });

  it("describeFile junta nombre, tipo, peso y proporcion", () => {
    expect(describeFile(A, 0)).toEqual({
      name: "portada.jpg",
      kindLabel: "Imagen",
      size: "2.0 MB",
      ratio: "9:16",
    });
  });

  it("el peso de un archivo chico va en KB", () => {
    expect(describeFile(entry({ storage_path: "a/b/c.png", size_bytes: 300 * 1024 }), 0).size).toBe("300 KB");
  });
});
