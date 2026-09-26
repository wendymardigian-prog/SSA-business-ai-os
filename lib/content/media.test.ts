import { describe, it, expect } from "vitest";
import {
  liveMedia,
  MAX_MEDIA_BYTES,
  mediaPath,
  pathBelongsToWorkspace,
  removalPlan,
  RESUMABLE_THRESHOLD_BYTES,
  sniffMime,
  validateMedia,
  type MediaEntry,
} from "./media";

/** Los primeros bytes de un archivo de cada tipo. */
const HEADS: Record<string, number[]> = {
  jpeg: [0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0],
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0],
  gif: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0],
  pdf: [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0, 0, 0, 0],
  webp: [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50],
  mp4: [0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32],
  mov: [0, 0, 0, 0x14, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20],
  /** Un ejecutable de Windows renombrado a .png. */
  exe: [0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 4, 0, 0, 0],
};

const head = (kind: keyof typeof HEADS) => new Uint8Array(HEADS[kind]);

describe("reconocer el tipo por el contenido (F18)", () => {
  it("reconoce cada tipo permitido", () => {
    expect(sniffMime(head("jpeg"))).toBe("image/jpeg");
    expect(sniffMime(head("png"))).toBe("image/png");
    expect(sniffMime(head("gif"))).toBe("image/gif");
    expect(sniffMime(head("webp"))).toBe("image/webp");
    expect(sniffMime(head("pdf"))).toBe("application/pdf");
    expect(sniffMime(head("mp4"))).toBe("video/mp4");
  });

  it("distingue un MOV de un MP4, que comparten caja", () => {
    expect(sniffMime(head("mov"))).toBe("video/quicktime");
  });

  it("un ejecutable renombrado a .png no pasa", () => {
    // Es el caso que justifica mirar los bytes: la extension y el
    // Content-Type los elige quien sube.
    expect(sniffMime(head("exe"))).toBeNull();
  });

  it("un archivo cortado no se adivina", () => {
    expect(sniffMime(new Uint8Array([0xff, 0xd8]))).toBeNull();
  });
});

describe("validar un archivo antes de subirlo", () => {
  const candidate = (over: Partial<Parameters<typeof validateMedia>[0]> = {}) =>
    validateMedia({ fileName: "foto.png", sizeBytes: 1000, head: head("png"), ...over });

  it("acepta lo permitido y dice de que tipo es", () => {
    expect(candidate()).toEqual({
      ok: true,
      mime: "image/png",
      kind: "image",
      ext: "png",
      resumable: false,
    });
  });

  it("un archivo grande se sube por partes", () => {
    const grande = candidate({ sizeBytes: RESUMABLE_THRESHOLD_BYTES + 1, head: head("mp4") });

    expect(grande).toMatchObject({ ok: true, resumable: true });
  });

  it("mas de 1 GB se rechaza, y el mensaje dice cuanto pesa", () => {
    const result = candidate({ sizeBytes: MAX_MEDIA_BYTES + 1, head: head("mp4") });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("1 GB");
  });

  it("un archivo vacio se rechaza", () => {
    expect(candidate({ sizeBytes: 0 }).ok).toBe(false);
  });

  it("si el contenido no coincide con lo declarado, se dice", () => {
    const result = candidate({ head: head("exe"), declaredMime: "image/png" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("image/png");
  });
});

describe("donde se guarda", () => {
  it("el primer segmento es el workspace: es lo que mira la policy del bucket", () => {
    expect(mediaPath({ workspaceId: "ws-1", postId: "p-1", ext: "mp4", uniqueId: "abc" })).toBe(
      "ws-1/p-1/abc.mp4",
    );
  });

  it("una ruta de otro workspace, o con saltos, no pasa", () => {
    expect(pathBelongsToWorkspace("ws-1/p/a.png", "ws-1")).toBe(true);
    expect(pathBelongsToWorkspace("ws-2/p/a.png", "ws-1")).toBe(false);
    expect(pathBelongsToWorkspace("ws-1/../ws-2/a.png", "ws-1")).toBe(false);
  });
});

describe("sacar una media de la pieza", () => {
  const media: MediaEntry[] = [
    { storage_path: "ws/p/a.png", mime_type: "image/png", kind: "image", size_bytes: 10 },
    { storage_path: "ws/p/b.mp4", mime_type: "video/mp4", kind: "video", size_bytes: 20 },
  ];

  it("si la pieza no se publico, el archivo se borra de verdad", () => {
    const plan = removalPlan({ media, storagePath: "ws/p/a.png", postPublished: false });

    expect(plan.deleteFromBucket).toBe(true);
    expect(plan.media.map((m) => m.storage_path)).toEqual(["ws/p/b.mp4"]);
  });

  it("si ya se publico, se marca y se conserva", () => {
    // Puede ser lo que se ve en la red, y el analisis del post lo muestra.
    const plan = removalPlan({ media, storagePath: "ws/p/a.png", postPublished: true });

    expect(plan.deleteFromBucket).toBe(false);
    expect(plan.media).toHaveLength(2);
    expect(plan.media[0].deleted_at).toBeTruthy();
  });

  it("sacar algo que no esta no rompe ni borra nada", () => {
    const plan = removalPlan({ media, storagePath: "ws/p/no-existe.png", postPublished: false });

    expect(plan).toMatchObject({ found: false, deleteFromBucket: false });
    expect(plan.media).toHaveLength(2);
  });

  it("la media borrada no se muestra", () => {
    const conBorrada = [...media, { ...media[0], storage_path: "ws/p/c.png", deleted_at: "2026-09-01T00:00:00Z" }];

    expect(liveMedia(conBorrada)).toHaveLength(2);
  });
});
