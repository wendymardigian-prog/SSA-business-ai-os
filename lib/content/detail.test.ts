/**
 * El detalle de una pieza (F36).
 */

import { describe, it, expect } from "vitest";
import type { ContentPermissions } from "./status";
import { networkRows, type PublicationSummary } from "./detail";

const TZ = "America/Argentina/Buenos_Aires";

const pub = (over: Partial<PublicationSummary> = {}): PublicationSummary => ({
  platform: "instagram",
  status: "published",
  scheduledAt: null,
  publishedAt: "2026-10-01T18:00:00Z",
  url: "https://ig/9",
  lastError: null,
  lastErrorKind: null,
  attempts: 1,
  warning: null,
  actualVisibility: null,
  ...over,
});

const perms = (over: Partial<ContentPermissions> = {}): ContentPermissions => ({
  create: true,
  approve: false,
  publish: false,
  isAuthor: true,
  ...over,
});

describe("una fila por red (F36)", () => {
  it("una publicada muestra la hora y el link", () => {
    const [row] = networkRows([pub()], { timeZone: TZ, canPublish: true });

    expect(row.state).toContain("Publicado");
    expect(row.state).toContain("15:00");
    expect(row.url).toBe("https://ig/9");
    expect(row.tone).toBe("ok");
  });

  it("una que fallo muestra el motivo, no un codigo", () => {
    const [row] = networkRows(
      [pub({ status: "failed", publishedAt: null, url: null, lastError: "La cuenta se desconecto" })],
      { timeZone: TZ, canPublish: true },
    );

    expect(row.tone).toBe("error");
    expect(row.note).toBe("La cuenta se desconecto");
    expect(row.canRetry).toBe(true);
  });

  it("una que salio pero quedo privada lo avisa igual", () => {
    // "Salio" no alcanza si no la ve nadie.
    const [row] = networkRows([pub({ warning: "YouTube dejo el video en privado" })], {
      timeZone: TZ,
      canPublish: true,
    });

    expect(row.tone).toBe("ok");
    expect(row.note).toContain("privado");
  });

  it("quien no publica no puede reintentar", () => {
    const [row] = networkRows([pub({ status: "failed" })], { timeZone: TZ, canPublish: false });

    expect(row.canRetry).toBe(false);
  });

  it("reintentar una que salio no se ofrece nunca", () => {
    // Seria publicarla dos veces.
    const [row] = networkRows([pub()], { timeZone: TZ, canPublish: true });

    expect(row.canRetry).toBe(false);
  });
});
