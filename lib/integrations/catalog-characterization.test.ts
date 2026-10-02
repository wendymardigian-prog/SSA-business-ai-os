import { describe, it, expect } from "vitest";
import { PROVIDERS, providersBySection } from "./providers";

/**
 * CARACTERIZACION (Bloque G): reagrupar la pantalla no agrega ni quita
 * integraciones.
 *
 * Se escribio contra el catalogo de antes del bloque, cuando eran seis
 * secciones, y tiene que seguir pasando igual con dos. Si un dia se suma un
 * proveedor de verdad, este es el test que se actualiza, a proposito.
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
  it("son los mismos catorce ids", () => {
    expect(PROVIDERS.map((p) => p.id).sort()).toEqual(IDS);
  });

  it("la pantalla muestra exactamente esos catorce, ninguno dos veces", () => {
    const shown = providersBySection().flatMap((group) => group.providers.map((p) => p.id));
    expect(shown.length).toBe(IDS.length);
    expect([...shown].sort()).toEqual(IDS);
  });
});
