import { describe, expect, it } from "vitest";
import { isMissingFilesError, lacksFiles, visibleValidation } from "./network-files";
import { validateNetwork } from "./validation";

describe("archivos obligatorios solo si publica el sistema", () => {
  it("reconoce los mensajes de archivos faltantes de la validacion real", () => {
    // Sin ningun archivo, en un formato que pide uno.
    const reel = validateNetwork({ platform: "instagram", text: "hola", media: [], format: "reel" });
    expect(reel.ok).toBe(false);
    expect(reel.errors.some(isMissingFilesError)).toBe(true);

    // Sin formato, Instagram igual necesita media.
    const bare = validateNetwork({ platform: "instagram", text: "hola", media: [] });
    expect(bare.errors.some(isMissingFilesError)).toBe(true);

    const yt = validateNetwork({
      platform: "youtube",
      text: "hola",
      title: "Un titulo",
      media: [],
      format: "video",
      options: { visibility: "public" },
    });
    expect(yt.errors.some(isMissingFilesError)).toBe(true);
  });

  it("no confunde otros errores con archivos faltantes", () => {
    expect(isMissingFilesError("Sobran archivos: este formato pide 1 video")).toBe(false);
    expect(isMissingFilesError("Un archivo no sirve para este formato: pide 1 video")).toBe(false);
    expect(isMissingFilesError("YouTube necesita un titulo.")).toBe(false);
    expect(isMissingFilesError("El texto tiene 3000 caracteres y instagram acepta 2200.")).toBe(false);
  });

  it("si la sube la persona, la falta de archivos deja de ser un error", () => {
    const strict = validateNetwork({ platform: "instagram", text: "hola", media: [], format: "reel" });
    const shown = visibleValidation(strict, false);
    expect(shown.errors).toEqual([]);
    expect(shown.ok).toBe(true);
  });

  it("si la publica el sistema, se muestra la validacion del servidor tal cual", () => {
    const strict = validateNetwork({ platform: "instagram", text: "hola", media: [], format: "reel" });
    expect(visibleValidation(strict, true)).toBe(strict);
    expect(visibleValidation(strict, true).ok).toBe(false);
  });

  it("los errores de verdad siguen viendose aunque la suba la persona", () => {
    const long = validateNetwork({ platform: "instagram", text: "x".repeat(5000), media: [], format: "reel" });
    const shown = visibleValidation(long, false);
    expect(shown.ok).toBe(false);
    expect(shown.errors).toHaveLength(1);
    expect(shown.errors[0]).toMatch(/caracteres/);
  });

  it("lacksFiles dice si hay un error de archivos faltantes", () => {
    expect(lacksFiles(validateNetwork({ platform: "instagram", text: "", media: [], format: "reel" }))).toBe(true);
    expect(lacksFiles({ platform: "linkedin", errors: [], warnings: [], ok: true })).toBe(false);
  });
});
