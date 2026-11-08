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
 * Formularios sumo "turnstile" (seccion "Seguridad") y la correccion R1 (12/10/2026) lo saco:  @plantilla-quitar(proyecto)
 * publicar un formulario no puede depender de un captcha. Por eso el catalogo vuelve a los catorce  @plantilla-quitar(proyecto)
 * de siempre a proposito (ver docs/pendientes/turnstile-captcha.md).  @plantilla-quitar(proyecto)
 */
const IDS = [
  "anthropic",
  "evolution",
  "google",
  "google_ai",
  "groq",
  "linkedin",
  "meta",
  // La API de Conversiones de Meta (00327): una tarjeta aparte de la de lectura.
  "meta_capi",
  "openai",
  "postproxy",
  "resend",
  "resend_inbound",
  "threads",
  "voyage",
  "zernio",
];

describe("el conjunto de proveedores no cambia", () => {
  it("son los catorce de siempre (sin Turnstile desde R1) mas la API de Conversiones (00327)", () => {
    expect(PROVIDERS.map((p) => p.id).sort()).toEqual(IDS);
  });

  it("la pantalla muestra exactamente esos, ninguno dos veces", () => {
    // Cambio aprobado (conexion de Resend, 2/11/2026): "Resend (email entrante)" sigue en el catalogo pero oculta:
    // la recepcion y el webhook viven en la tarjeta Resend.
    const VISIBLE = IDS.filter((id) => id !== "resend_inbound");
    const shown = providersBySection().flatMap((group) => group.providers.map((p) => p.id));
    expect(shown.length).toBe(VISIBLE.length);
    expect([...shown].sort()).toEqual(VISIBLE);
  });
});
