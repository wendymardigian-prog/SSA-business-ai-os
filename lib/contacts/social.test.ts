import { describe, it, expect } from "vitest";
import { linkedinSlug, normalizeSocialHandle, SOCIAL_COLUMNS, SOCIAL_PLATFORMS } from "./social";
import { validateContactField } from "./fields";

const ok = (platform: Parameters<typeof normalizeSocialHandle>[0], raw: string) => {
  const r = normalizeSocialHandle(platform, raw);
  return r.ok ? r.value : `ERROR:${r.error}`;
};

describe("normalizeSocialHandle: Instagram", () => {
  it.each(["@Ana", "ana", "instagram.com/ana", "https://instagram.com/ana/?hl=es", "https://www.instagram.com/Ana/", "  @ANA  "])(
    "%s → ana",
    (raw) => expect(ok("instagram", raw)).toBe("ana"),
  );

  it("conserva puntos y guiones bajos", () => expect(ok("instagram", "@Ana.Perez_1")).toBe("ana.perez_1"));
  it("un usuario con espacios es un error del campo", () => expect(ok("instagram", "ana perez")).toBe("ERROR:Ese usuario de Instagram no es válido"));
  it("más de 30 caracteres o caracteres raros: error", () => {
    expect(normalizeSocialHandle("instagram", "a".repeat(31)).ok).toBe(false);
    expect(normalizeSocialHandle("instagram", "ana-perez").ok).toBe(false);
    expect(normalizeSocialHandle("instagram", "").ok).toBe(false);
  });
  it("una publicación o un reel no es un perfil", () => {
    expect(normalizeSocialHandle("instagram", "https://www.instagram.com/p/Cx123/").ok).toBe(false);
    expect(normalizeSocialHandle("instagram", "https://www.instagram.com/reel/abc/").ok).toBe(false);
  });
  it("la URL de otra red no vale", () => expect(normalizeSocialHandle("instagram", "https://tiktok.com/@ana").ok).toBe(false));
  it("algo con barras que no es una red conocida: error", () => expect(normalizeSocialHandle("instagram", "ana/perez").ok).toBe(false));
});

describe("normalizeSocialHandle: TikTok y X", () => {
  it("TikTok acepta el @ de la URL", () => {
    expect(ok("tiktok", "https://www.tiktok.com/@Ana")).toBe("ana");
    expect(ok("tiktok", "@ana.perez")).toBe("ana.perez");
  });
  it("TikTok pide 2 a 24 caracteres", () => {
    expect(normalizeSocialHandle("tiktok", "a").ok).toBe(false);
    expect(normalizeSocialHandle("tiktok", "a".repeat(25)).ok).toBe(false);
  });
  it("X acepta x.com y twitter.com", () => {
    expect(ok("x", "x.com/ana")).toBe("ana");
    expect(ok("x", "https://twitter.com/Ana?s=20")).toBe("ana");
    expect(ok("x", "@Ana_1")).toBe("ana_1");
  });
  it("X no admite puntos ni más de 15 caracteres", () => {
    expect(normalizeSocialHandle("x", "ana.perez").ok).toBe(false);
    expect(normalizeSocialHandle("x", "a".repeat(16)).ok).toBe(false);
  });
});

describe("normalizeSocialHandle: LinkedIn", () => {
  it("guarda la URL canónica con el slug en minúsculas", () => {
    expect(ok("linkedin", "linkedin.com/in/ana-perez/")).toBe("https://www.linkedin.com/in/ana-perez");
    expect(ok("linkedin", "https://www.linkedin.com/in/Ana-Perez?utm_source=x")).toBe("https://www.linkedin.com/in/ana-perez");
    expect(ok("linkedin", "ana-perez")).toBe("https://www.linkedin.com/in/ana-perez");
  });
  it("una URL de LinkedIn que no es un perfil (/company/) es un error", () => {
    expect(normalizeSocialHandle("linkedin", "https://www.linkedin.com/company/acme").ok).toBe(false);
  });
  it("linkedinSlug saca el slug de la URL guardada", () => {
    expect(linkedinSlug("https://www.linkedin.com/in/Ana-Perez/")).toBe("ana-perez");
    expect(linkedinSlug("https://www.linkedin.com/company/acme")).toBeNull();
  });
});

describe("normalizeSocialHandle: Facebook y YouTube solo se limpian", () => {
  it("sin @, sin espacios, recortados", () => {
    expect(ok("facebook", "  @ana perez ")).toBe("anaperez");
    expect(ok("youtube", "@MiCanal")).toBe("MiCanal");
    expect(ok("youtube", "https://www.youtube.com/channel/UC123abc")).toBe("UC123abc");
    expect(ok("facebook", "https://facebook.com/ana.perez")).toBe("ana.perez");
  });
});

describe("coincide con cómo se guardan los contactos", () => {
  it("la columna de cada red existe en CONTACT_FIELDS", () => {
    for (const platform of SOCIAL_PLATFORMS) expect(SOCIAL_COLUMNS[platform]).toBeTruthy();
  });
  it("el mismo @ da lo mismo que la edición manual de la ficha (validateContactField, kind handle)", () => {
    for (const raw of ["@Ana", "ana", "@ANA.perez"]) {
      const fromFicha = validateContactField("instagram_username", raw);
      expect(fromFicha.ok && fromFicha.value).toBe(ok("instagram", raw));
    }
  });
});
