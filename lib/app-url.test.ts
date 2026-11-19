import { afterEach, describe, expect, it, vi } from "vitest";
import { appRedirectUrl, appUrl } from "./app-url";

describe("appRedirectUrl", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("arma la ruta sobre el dominio de la app, con o sin barra final", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://os.example.com/");
    expect(appUrl()).toBe("https://os.example.com");
    expect(appRedirectUrl("/dashboard")).toBe("https://os.example.com/dashboard");
    expect(appRedirectUrl("/login?error=auth")).toBe("https://os.example.com/login?error=auth");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://os.example.com");
    expect(appRedirectUrl("/recuperar?vencido=1")).toBe("https://os.example.com/recuperar?vencido=1");
  });

  it("nunca sale del dominio: lo que no es una ruta interna va a la entrada", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://os.example.com");
    expect(appRedirectUrl("//evil.com/x")).toBe("https://os.example.com/login");
    expect(appRedirectUrl("/\\evil.com")).toBe("https://os.example.com/login");
    expect(appRedirectUrl("https://evil.com")).toBe("https://os.example.com/login");
    expect(appRedirectUrl("")).toBe("https://os.example.com/login");
  });

  it("sin la variable, el local de siempre", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    expect(appRedirectUrl("/dashboard")).toBe("http://localhost:3000/dashboard");
  });
});
