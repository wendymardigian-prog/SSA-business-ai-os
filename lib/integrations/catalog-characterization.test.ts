import { describe, it, expect } from "vitest";
import { PROVIDERS, providersBySection } from "./providers";

/**
 * CARACTERIZACION (Bloque G): reagrupar la pantalla no agrega ni quita
 * integraciones.
 *
 * Se escribio contra el catalogo de antes del bloque, cuando eran seis
 * secciones, y tiene que seguir pasando igual con dos. Si un dia se suma un
 * proveedor de verdad, este es el test que se actualiza, a proposito.
 *
 * Formularios sumo "turnstile" (seccion "Seguridad") y la correccion R1 (12/10/2026) lo saco:
 * publicar un formulario no puede depender de un captcha. Por eso el catalogo vuelve a los catorce
 * de siempre a proposito (ver docs/pendientes/turnstile-captcha.md).
 */
const IDS = [
  "anthropic",
  "evolution",
  "google",
  "google_ai",
  "groq",
  "linkedin",
  "meta",
  "openai",
  "postproxy",
  "resend",
  "resend_inbound",
  "threads",
  "voyage",
  "zernio",
];

describe("el conjunto de proveedores no cambia", () => {
  it("son los catorce de siempre (sin Turnstile desde R1)", () => {
    expect(PROVIDERS.map((p) => p.id).sort()).toEqual(IDS);
  });

  it("la pantalla muestra exactamente esos, ninguno dos veces", () => {
    const shown = providersBySection().flatMap((group) => group.providers.map((p) => p.id));
    expect(shown.length).toBe(IDS.length);
    expect([...shown].sort()).toEqual(IDS);
  });
});
