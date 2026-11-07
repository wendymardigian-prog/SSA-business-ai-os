import { describe, expect, it } from "vitest";
import { linkPreviewCapability } from "./link-preview";

describe("linkPreviewCapability", () => {
  it("WhatsApp e Instagram llevan tarjeta y un aviso que no promete nada", () => {
    expect(linkPreviewCapability("evolution", "whatsapp")).toEqual({ card: true, notice: "Puede verse distinto en WhatsApp." });
    expect(linkPreviewCapability("zernio", "instagram")).toEqual({ card: true, notice: "Instagram decide si la muestra." });
    expect(linkPreviewCapability("zernio", "facebook").notice).toBe("Facebook decide si la muestra.");
    expect(linkPreviewCapability("zernio").notice).toBe("La red decide si la muestra.");
  });

  it("email y un proveedor desconocido, sin tarjeta", () => {
    for (const provider of ["resend", "otro", null, undefined]) {
      expect(linkPreviewCapability(provider)).toEqual({ card: false, notice: null });
    }
  });
});
