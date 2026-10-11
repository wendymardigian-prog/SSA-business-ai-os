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
 * Formularios suma "turnstile" (seccion nueva "Seguridad"): es el unico cambio.
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
  "turnstile",
  "voyage",
  "zernio",
];

describe("el conjunto de proveedores no cambia", () => {
  it("son los catorce de siempre más Turnstile (Formularios)", () => {
    expect(PROVIDERS.map((p) => p.id).sort()).toEqual(IDS);
  });

  it("la pantalla muestra exactamente esos, ninguno dos veces", () => {
    const shown = providersBySection().flatMap((group) => group.providers.map((p) => p.id));
    expect(shown.length).toBe(IDS.length);
    expect([...shown].sort()).toEqual(IDS);
  });
});
