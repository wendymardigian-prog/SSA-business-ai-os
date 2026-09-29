/**
 * Que pinta la burbuja para cada adjunto (F12).
 *
 * Los 14 tipos y los cuatro estados. Lo que mas importa: que ningun adjunto deje
 * la burbuja vacia, que lo que no tiene archivo NO muestre un spinner, y que los
 * adjuntos de email sigan leyendose de su propio bucket.
 */

import { describe, it, expect } from "vitest";
import { EMAIL_BUCKET_MARKER, emptyAttachment, type AttachmentKind } from "@/lib/messages/attachments";
import {
  extensionLabel,
  formatBytes,
  formatDuration,
  isCorruptMedia,
  isRetryableMediaError,
  renderPlan,
} from "./media-render";

const ready = (kind: AttachmentKind, over = {}) =>
  emptyAttachment(kind, { status: "ready", storagePath: "ws-1/cv-1/m-1-0.bin", ...over });

const ALL_KINDS: AttachmentKind[] = [
  "image",
  "video",
  "audio",
  "voice",
  "sticker",
  "gif",
  "document",
  "location",
  "contact",
  "poll",
  "share",
  "link",
  "story_reply",
  "unsupported",
];

describe("renderPlan: los 14 tipos (F12)", () => {
  it("ninguno deja la burbuja vacia: todos tienen componente y etiqueta", () => {
    for (const kind of ALL_KINDS) {
      const plan = renderPlan(ready(kind, { mime: null }));
      expect(plan.component, kind).toBeTruthy();
      expect(plan.label.length, kind).toBeGreaterThan(0);
    }
  });

  it("una imagen y un sticker se ven como imagen", () => {
    expect(renderPlan(ready("image", { mime: "image/jpeg" })).component).toBe("image");
    expect(renderPlan(ready("sticker", { mime: "image/webp" })).component).toBe("image");
  });

  it("un GIF de WhatsApp es un mp4 corto, asi que va como video", () => {
    expect(renderPlan(ready("gif", { mime: "video/mp4" })).component).toBe("gif-video");
    expect(renderPlan(ready("gif", { mime: "image/gif" })).component).toBe("gif-image");
  });

  it("un video, un audio y una nota de voz tienen su reproductor", () => {
    expect(renderPlan(ready("video", { mime: "video/mp4" })).component).toBe("video");
    expect(renderPlan(ready("audio", { mime: "audio/mpeg" })).component).toBe("audio");
    expect(renderPlan(ready("voice", { mime: "audio/ogg" })).component).toBe("audio");
  });

  it("un documento va como tarjeta", () => {
    const plan = renderPlan(ready("document", { mime: "application/pdf", filename: "presupuesto.pdf" }));
    expect(plan.component).toBe("document");
    expect(plan.filename).toBe("presupuesto.pdf");
  });

  it("un tipo desconocido cae en la tarjeta de documento, no en la nada", () => {
    expect(renderPlan(ready("unsupported", { mime: "application/x-raro" })).component).toBe("document");
  });
});

describe("renderPlan: lo que NO tiene archivo (F12)", () => {
  it("una ubicacion, un contacto y una encuesta son una etiqueta, sin spinner ni reproductor", () => {
    for (const kind of ["location", "contact", "poll"] as AttachmentKind[]) {
      // Incluso con status pending, que es lo que dejaria un spinner girando
      // para siempre.
      const plan = renderPlan(emptyAttachment(kind, { status: "pending" }));
      expect(plan.component, kind).toBe("label");
      expect(plan.canRetry, kind).toBe(false);
    }
  });

  it("la etiqueta suma el dato que la hace util", () => {
    expect(renderPlan(emptyAttachment("location", { meta: { name: "Obelisco" } })).label).toBe("📍 Ubicación: Obelisco");
    expect(renderPlan(emptyAttachment("location", { meta: { address: "Corrientes 1234" } })).label).toContain(
      "Corrientes 1234",
    );
    expect(renderPlan(emptyAttachment("contact", { meta: { name: "Juan" } })).label).toBe("👤 Contacto: Juan");
    expect(renderPlan(emptyAttachment("poll", { meta: { name: "¿Qué día?" } })).label).toBe("📊 Encuesta: ¿Qué día?");
  });

  it("una ubicacion sin datos igual dice que es", () => {
    expect(renderPlan(emptyAttachment("location")).label).toBe("📍 Ubicación");
  });

  it("un post compartido, un link y una historia son una tarjeta con link", () => {
    for (const kind of ["share", "link"] as AttachmentKind[]) {
      const plan = renderPlan(emptyAttachment(kind, { meta: { url: "https://instagram.com/p/abc" } }));
      expect(plan.component, kind).toBe("link-card");
      expect(plan.externalUrl, kind).toBe("https://instagram.com/p/abc");
    }

    const story = renderPlan(emptyAttachment("story_reply", { meta: { storyUrl: "https://cdn/story.jpg" } }));
    expect(story.component).toBe("link-card");
    expect(story.externalUrl).toBe("https://cdn/story.jpg");
  });

  it("un link sin URL no promete una tarjeta que no se puede abrir", () => {
    expect(renderPlan(emptyAttachment("share")).component).toBe("label");
    // Y una URL que no es http no se usa: seria un link roto o algo peor.
    expect(renderPlan(emptyAttachment("share", { meta: { url: "javascript:alert(1)" } })).externalUrl).toBeNull();
  });
});

describe("renderPlan: los cuatro estados (F12)", () => {
  it("pending muestra que se esta bajando", () => {
    const plan = renderPlan(emptyAttachment("voice", { status: "pending" }));
    expect(plan.component).toBe("pending");
    expect(plan.label).toBe("Descargando adjunto…");
  });

  it("failed muestra el motivo y ofrece reintentar", () => {
    const plan = renderPlan(
      emptyAttachment("image", { status: "failed", error: "El proveedor respondió 500 al pedirle el archivo" }),
    );
    expect(plan.component).toBe("failed");
    expect(plan.label).toContain("500");
    expect(plan.canRetry).toBe(true);
  });

  it("failed por algo que no se arregla NO ofrece reintentar", () => {
    // Un boton que siempre falla es peor que no tener boton.
    for (const error of [
      "El archivo supera el máximo de 25 MB",
      "WhatsApp ya no tiene este archivo disponible",
      "El archivo llegó vacío",
      "El adjunto llegó sin dirección de descarga",
    ]) {
      expect(renderPlan(emptyAttachment("image", { status: "failed", error })).canRetry, error).toBe(false);
    }
  });

  it("none con metadatos dice que ya no esta, pero dice QUE era", () => {
    const plan = renderPlan(emptyAttachment("voice", { status: "none", durationSeconds: 12 }));
    expect(plan.component).toBe("unavailable");
    // "Adjunto ya no disponible" a secas no dice si era una nota de voz o una foto.
    expect(plan.label).toBe("🎤 Nota de voz · ya no disponible");
  });

  it("ready pero sin path tambien es 'ya no disponible', no un reproductor roto", () => {
    expect(renderPlan(emptyAttachment("image", { status: "ready", storagePath: null })).component).toBe("unavailable");
  });
});

describe("el archivo corrupto (F12)", () => {
  it("un text/html donde deberia haber una imagen es corrupto, y no se ofrece reintento", () => {
    // Es lo que queda cuando el proveedor devolvio una pagina de error.
    const plan = renderPlan(ready("image", { mime: "text/html" }));
    expect(plan.component).toBe("corrupt");
    expect(plan.label).toBe("El archivo no se pudo descargar correctamente");
    expect(plan.canRetry).toBe(false);
  });

  it("isCorruptMedia compara la familia del mime con el tipo", () => {
    expect(isCorruptMedia({ kind: "image", mime: "text/html", status: "ready" })).toBe(true);
    expect(isCorruptMedia({ kind: "voice", mime: "text/plain", status: "ready" })).toBe(true);
    expect(isCorruptMedia({ kind: "video", mime: "image/jpeg", status: "ready" })).toBe(true);

    expect(isCorruptMedia({ kind: "image", mime: "image/png", status: "ready" })).toBe(false);
    expect(isCorruptMedia({ kind: "voice", mime: "audio/ogg", status: "ready" })).toBe(false);
  });

  it("un GIF vale como imagen Y como video: WhatsApp los manda como mp4", () => {
    expect(isCorruptMedia({ kind: "gif", mime: "video/mp4", status: "ready" })).toBe(false);
    expect(isCorruptMedia({ kind: "gif", mime: "image/gif", status: "ready" })).toBe(false);
    expect(isCorruptMedia({ kind: "gif", mime: "text/html", status: "ready" })).toBe(true);
  });

  it("un documento acepta cualquier mime: puede ser cualquier cosa", () => {
    expect(isCorruptMedia({ kind: "document", mime: "application/zip", status: "ready" })).toBe(false);
  });

  it("sin mime, o sin bajar, no se declara corrupto", () => {
    expect(isCorruptMedia({ kind: "image", mime: null, status: "ready" })).toBe(false);
    expect(isCorruptMedia({ kind: "image", mime: "text/html", status: "pending" })).toBe(false);
  });
});

describe("de que bucket se lee (F12)", () => {
  it("la media del chat va por su ruta, con descarga aparte", () => {
    const plan = renderPlan(ready("voice", { mime: "audio/ogg", storagePath: "ws-1/cv-1/m-1-0.ogg", filename: "nota.ogg" }));

    expect(plan.url).toBe("/api/v1/chat-media?path=ws-1%2Fcv-1%2Fm-1-0.ogg");
    expect(plan.downloadUrl).toContain("download=1");
  });

  it("los adjuntos de EMAIL se siguen leyendo de su bucket, como hoy", () => {
    const plan = renderPlan(
      ready("document", {
        mime: "application/pdf",
        storagePath: "ws-1/email-1/0-guia.pdf",
        filename: "guia.pdf",
        meta: { bucket: EMAIL_BUCKET_MARKER },
      }),
    );

    expect(plan.url).toBe("/api/v1/email-attachments?path=ws-1%2Femail-1%2F0-guia.pdf");
    expect(plan.url).not.toContain("chat-media");
  });

  it("sin path no hay links que ofrecer", () => {
    const plan = renderPlan(emptyAttachment("image", { status: "none" }));
    expect(plan.url).toBeNull();
    expect(plan.downloadUrl).toBeNull();
  });
});

describe("los formatos que lee una persona (F12)", () => {
  it("el tamaño en la unidad que corresponde", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(1_500_000)).toBe("1,4 MB");
    expect(formatBytes(0)).toBeNull();
    expect(formatBytes(null)).toBeNull();
  });

  it("la duracion como m:ss", () => {
    expect(formatDuration(12)).toBe("0:12");
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(600)).toBe("10:00");
    expect(formatDuration(12.6)).toBe("0:13");
  });

  it("sin duracion devuelve null, NO 0:00", () => {
    // Cero segundos diria que el audio esta vacio; lo que pasa es que no
    // sabemos cuanto dura (el webm de Chrome no la trae).
    expect(formatDuration(null)).toBeNull();
    expect(formatDuration(0)).toBeNull();
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBeNull();
    expect(formatDuration(Number.NaN)).toBeNull();
  });

  it("la extension sale del nombre, y si no, del mime", () => {
    expect(extensionLabel(ready("document", { filename: "presupuesto.pdf" }))).toBe("PDF");
    expect(extensionLabel(ready("document", { filename: null, mime: "application/zip" }))).toBe("ZIP");
    expect(extensionLabel(ready("document", { filename: null, mime: null }))).toBeNull();
  });
});
