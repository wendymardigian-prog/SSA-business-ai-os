import { describe, it, expect } from "vitest";
import {
  AD_KEYS,
  ATTRIBUTION_KEYS,
  CLICK_ID_KEYS,
  COOKIE_KEYS,
  TOUCH_KEYS,
  UTM_KEYS,
  canonicalKey,
  isAttributionKey,
} from "./keys";
import {
  CLICK_ID_KEYS as AGENDA_CLICK_ID_KEYS,
  UTM_KEYS as AGENDA_UTM_KEYS,
} from "@/lib/scheduling/booker/embed-params";
import { UTM_KEYS as AGENDA_PICK_KEYS } from "@/lib/scheduling/antispam";

describe("claves de atribución", () => {
  it("contienen todas las que usa la Agenda (el embed de la Agenda no cambia)", () => {
    for (const k of AGENDA_UTM_KEYS) expect(UTM_KEYS).toContain(k);
    for (const k of AGENDA_CLICK_ID_KEYS) expect(CLICK_ID_KEYS).toContain(k);
    for (const k of AGENDA_PICK_KEYS) expect(ATTRIBUTION_KEYS).toContain(k);
  });

  it("incluyen los ids de clic de las plataformas de anuncios", () => {
    for (const k of ["fbclid", "gclid", "gbraid", "wbraid", "msclkid", "ttclid", "li_fat_id", "twclid", "sccid", "epik", "rdt_cid"]) {
      expect(CLICK_ID_KEYS).toContain(k);
    }
  });

  it("el toque nuevo se decide por UTM, ids de clic o de anuncio, no por las cookies", () => {
    expect(TOUCH_KEYS).toEqual([...UTM_KEYS, ...CLICK_ID_KEYS, ...AD_KEYS]);
    for (const v of Object.values(COOKIE_KEYS)) expect(TOUCH_KEYS).not.toContain(v);
  });

  it("no hay claves repetidas", () => {
    expect(new Set(ATTRIBUTION_KEYS).size).toBe(ATTRIBUTION_KEYS.length);
  });

  it("canonicalKey acepta mayúsculas y el alias de Snapchat, y rechaza lo ajeno", () => {
    expect(canonicalKey("UTM_Source")).toBe("utm_source");
    expect(canonicalKey("ScCid")).toBe("sccid");
    expect(canonicalKey("scclid")).toBe("sccid");
    expect(canonicalKey("password")).toBeNull();
    expect(isAttributionKey("fbc")).toBe(true);
    expect(isAttributionKey("foo")).toBe(false);
  });
});
