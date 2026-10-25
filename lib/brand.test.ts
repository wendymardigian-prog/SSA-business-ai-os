import { describe, it, expect, afterEach } from "vitest";
import { brandName, brandLogoUrl, brandColorHex, brandInitial, resolveBrand, safeBrandColor, brandColorCss } from "./brand";

const KEYS = ["NEXT_PUBLIC_BRAND_NAME", "NEXT_PUBLIC_BRAND_LOGO_URL", "NEXT_PUBLIC_BRAND_COLOR"] as const;

function clearEnv() {
  for (const k of KEYS) delete process.env[k];
}

afterEach(clearEnv);

describe("brandName", () => {
  it("usa un nombre generico si no esta configurado", () => {
    clearEnv();
    expect(brandName()).toBe("Panel");
  });

  it("usa NEXT_PUBLIC_BRAND_NAME si esta configurado", () => {
    process.env.NEXT_PUBLIC_BRAND_NAME = "Scale·OS";
    expect(brandName()).toBe("Scale·OS");
  });

  it("ignora un valor vacio o solo espacios", () => {
    process.env.NEXT_PUBLIC_BRAND_NAME = "   ";
    expect(brandName()).toBe("Panel");
  });
});

describe("brandLogoUrl", () => {
  it("es null si no esta configurado", () => {
    expect(brandLogoUrl()).toBeNull();
  });

  it("devuelve la URL configurada", () => {
    process.env.NEXT_PUBLIC_BRAND_LOGO_URL = "https://cdn.ejemplo.com/logo.png";
    expect(brandLogoUrl()).toBe("https://cdn.ejemplo.com/logo.png");
  });
});

describe("brandColorHex", () => {
  it("es null si no esta configurado", () => {
    expect(brandColorHex()).toBeNull();
  });

  it("acepta un hex valido de 6 caracteres", () => {
    process.env.NEXT_PUBLIC_BRAND_COLOR = "#4f46e5";
    expect(brandColorHex()).toBe("#4f46e5");
  });

  it("rechaza un valor que no es un hex valido (no deja pasar CSS arbitrario)", () => {
    process.env.NEXT_PUBLIC_BRAND_COLOR = "red; } body { display: none";
    expect(brandColorHex()).toBeNull();
  });

  it("rechaza un hex corto o sin los 6 digitos", () => {
    process.env.NEXT_PUBLIC_BRAND_COLOR = "#fff";
    expect(brandColorHex()).toBeNull();
  });
});

describe("brandInitial", () => {
  it("usa la primera letra del nombre, en mayuscula", () => {
    process.env.NEXT_PUBLIC_BRAND_NAME = "scale·os";
    expect(brandInitial()).toBe("S");
  });

  it("usa P si no hay nombre configurado", () => {
    clearEnv();
    expect(brandInitial()).toBe("P");
  });
});

describe("resolveBrand (marca de un negocio, 00266)", () => {
  const SUPABASE = "NEXT_PUBLIC_SUPABASE_URL";
  const previousSupabase = process.env[SUPABASE];
  afterEach(() => {
    if (previousSupabase === undefined) delete process.env[SUPABASE];
    else process.env[SUPABASE] = previousSupabase;
  });

  it("sin marca propia es exactamente la de la instalacion (un negocio que no toca nada se ve igual)", () => {
    process.env.NEXT_PUBLIC_BRAND_NAME = "SSA";
    process.env.NEXT_PUBLIC_BRAND_LOGO_URL = "https://cdn.ejemplo.com/ssa.png";
    process.env.NEXT_PUBLIC_BRAND_COLOR = "#112233";
    const installation = { name: brandName(), logoUrl: brandLogoUrl(), colorHex: brandColorHex(), initial: brandInitial() };
    expect(resolveBrand(null)).toEqual(installation);
    expect(resolveBrand({ brand_name: null, brand_logo_path: null, brand_color: null })).toEqual(installation);
    expect(resolveBrand({ brand_name: "   " })).toEqual(installation);
  });

  it("con todo propio, usa lo del negocio", () => {
    process.env.NEXT_PUBLIC_BRAND_NAME = "SSA";
    process.env.NEXT_PUBLIC_BRAND_COLOR = "#112233";
    process.env[SUPABASE] = "https://abc.supabase.co/";
    const brand = resolveBrand({ brand_name: "BusinessXcelerator", brand_logo_path: "ws-1/logo/a.png", brand_color: "#aabbcc" });
    expect(brand).toEqual({
      name: "BusinessXcelerator",
      logoUrl: "https://abc.supabase.co/storage/v1/object/public/brand-assets/ws-1/logo/a.png",
      colorHex: "#aabbcc",
      initial: "B",
    });
  });

  it("con nombre propio y sin logo, muestra su inicial: nunca el logo de la instalacion al lado de otro nombre", () => {
    process.env.NEXT_PUBLIC_BRAND_NAME = "SSA";
    process.env.NEXT_PUBLIC_BRAND_LOGO_URL = "https://cdn.ejemplo.com/ssa.png";
    const brand = resolveBrand({ brand_name: "BX" });
    expect(brand.logoUrl).toBeNull();
    expect(brand.initial).toBe("B");
  });

  it("un color invalido se descarta (va en un <style>) y cae al de la instalacion", () => {
    process.env.NEXT_PUBLIC_BRAND_COLOR = "#112233";
    expect(resolveBrand({ brand_color: "red;} body{display:none" }).colorHex).toBe("#112233");
    expect(safeBrandColor("#ABCDEF")).toBe("#ABCDEF");
    expect(safeBrandColor("#abc")).toBeNull();
  });

  it("brandColorCss solo acepta un hex valido", () => {
    expect(brandColorCss("#aabbcc")).toContain("--primary:#aabbcc !important");
    expect(brandColorCss("x;}")).toBe("");
  });
});
