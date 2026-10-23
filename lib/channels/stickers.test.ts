import { describe, expect, it } from "vitest";
import { stickerCapability } from "./stickers";

describe("stickerCapability", () => {
  it("solo WhatsApp (Evolution) manda stickers", () => {
    expect(stickerCapability("evolution").supported).toBe(true);
    expect(stickerCapability("zernio").supported).toBe(false);
    expect(stickerCapability("resend").supported).toBe(false);
  });

  it("un proveedor desconocido o vacío, no", () => {
    expect(stickerCapability("telegram")).toEqual({ supported: false, reason: "Este canal no admite stickers." });
    expect(stickerCapability(null).supported).toBe(false);
  });
});
