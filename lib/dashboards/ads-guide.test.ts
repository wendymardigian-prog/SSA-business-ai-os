import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ADS_GUIDE_STEPS, ADS_NO_SIGNAL_MESSAGE, ADS_URL_PARAMS } from "./ads-guide";

describe("la guia del aviso «ningún contacto trae datos de anuncio»", () => {
  it("la plantilla de parametros es la MISMA que explica docs/atribucion.md", () => {
    const docs = readFileSync(resolve(__dirname, "../../docs/atribucion.md"), "utf8");
    expect(docs).toContain(ADS_URL_PARAMS);
    expect(docs).toContain("Guía: parámetros de URL para los anuncios".replace("í", "i").replace("á", "a"));
  });

  it("el mensaje es el que se pidio y los pasos piden la plantilla tal cual", () => {
    expect(ADS_NO_SIGNAL_MESSAGE).toBe("Ningún contacto de este período trae datos de anuncio. Configurá los parámetros de URL de tus anuncios.");
    expect(ADS_GUIDE_STEPS.length).toBeGreaterThanOrEqual(3);
    expect(ADS_GUIDE_STEPS.join(" ")).toContain("{{campaign.id}}");
  });
});
