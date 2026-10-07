import { describe, it, expect, afterEach } from "vitest";
import { brandName, brandLogoUrl, brandColorHex, brandInitial } from "./brand";

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
