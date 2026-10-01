/**
 * Links externos del contacto (F17).
 */

import { describe, it, expect } from "vitest";
import { getDmLink, platformHandles } from "./links";

describe("getDmLink", () => {
  it("instagram da ig.me/m/<handle>", () => {
    expect(getDmLink("instagram", "ana.gomez")).toEqual({ url: "https://ig.me/m/ana.gomez", label: "ig.me/m/ana.gomez" });
  });

  it("whatsapp limpia el numero a solo digitos", () => {
    expect(getDmLink("whatsapp", "+54 9 11 2233-4455")).toEqual({
      url: "https://wa.me/5491122334455",
      label: "wa.me/5491122334455",
    });
  });

  it("sin handle no hay link", () => {
    expect(getDmLink("instagram", null)).toEqual({ url: null, label: "" });
    expect(getDmLink("instagram", "")).toEqual({ url: null, label: "" });
  });

  it("una plataforma sin link definido (email, etc.) da null", () => {
    expect(getDmLink("email" as never, "x")).toEqual({ url: null, label: "" });
  });
});

describe("platformHandles", () => {
  it("contacto de Instagram: usa instagram_username, nunca el primer canal con username", () => {
    const result = platformHandles(
      { instagram_username: "ana.gomez" },
      [{ platform: "whatsapp", username: "5491122334455" }],
    );
    expect(result.instagramUsername).toBe("ana.gomez");
    expect(result.instagramUrl).toBe("https://instagram.com/ana.gomez");
  });

  it("contacto de WhatsApp SOLO: no muestra ningun @ de Instagram (el arreglo del bug)", () => {
    // Hoy find(ch => ch.username) no filtra por plataforma: con el canal de
    // WhatsApp (que trae username=telefono, porque Evolution manda
    // senderUsername: phone), mostraba "@<telefono>".
    const result = platformHandles(
      { instagram_username: null },
      [{ platform: "whatsapp", username: "5491122334455" }],
    );
    expect(result.instagramUsername).toBeNull();
    expect(result.instagramUrl).toBeNull();
  });

  it("sin instagram_username, cae al canal cuya platform es instagram", () => {
    const result = platformHandles(
      { instagram_username: null },
      [
        { platform: "whatsapp", username: "5491122334455" },
        { platform: "instagram", username: "ana.gomez" },
      ],
    );
    expect(result.instagramUsername).toBe("ana.gomez");
  });

  it("contacto con los dos: devuelve los dos links", () => {
    const result = platformHandles(
      { instagram_username: "ana.gomez", whatsapp_phone: "+54 9 11 2233-4455" },
      [],
    );
    expect(result.instagramUrl).toBe("https://instagram.com/ana.gomez");
    expect(result.whatsappUrl).toBe("https://wa.me/5491122334455");
  });

  it("un usuario cargado a mano sin canal igual arma el link", () => {
    const result = platformHandles({ instagram_username: "cargado.a.mano" }, []);
    expect(result.instagramUrl).toBe("https://instagram.com/cargado.a.mano");
  });

  it("el telefono de WhatsApp cae al canal, y despues a contacts.phone, con formato", () => {
    const soloCanal = platformHandles({ instagram_username: null }, [{ platform: "whatsapp", username: "+54 11 4444-5555" }]);
    expect(soloCanal.whatsappUrl).toBe("https://wa.me/541144445555");

    const soloPhone = platformHandles({ instagram_username: null, phone: "+54 9 11 9999-8888" }, []);
    expect(soloPhone.whatsappUrl).toBe("https://wa.me/5491199998888");
  });

  it("sin nada, los dos quedan en null", () => {
    expect(platformHandles({ instagram_username: null }, [])).toEqual({
      instagramUsername: null,
      instagramUrl: null,
      whatsappPhone: null,
      whatsappUrl: null,
    });
  });
});
