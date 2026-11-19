import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const exchangeCodeForSession = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { exchangeCodeForSession } }) }));

import { GET } from "./route";

// Detras de Railway el pedido llega como localhost:8080: la redireccion tiene que ir al dominio de la app.
const INTERNAL = "http://localhost:8080";

describe("/auth/callback", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://os.example.com");
    exchangeCodeForSession.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("con el código bueno, a la ruta pedida en el dominio de la app, nunca al host interno", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });
    const res = await GET(new Request(`${INTERNAL}/auth/callback?code=abc&next=%2Frestablecer`));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://os.example.com/restablecer");
  });

  it("sin código, a la entrada con el aviso genérico", async () => {
    const res = await GET(new Request(`${INTERNAL}/auth/callback`));
    expect(res.headers.get("location")).toBe("https://os.example.com/login?error=auth");
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("un link de recuperación vencido vuelve a pedir uno nuevo, en el dominio de la app", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: { message: "expired" } });
    const res = await GET(new Request(`${INTERNAL}/auth/callback?code=viejo&next=%2Frestablecer`));
    expect(res.headers.get("location")).toBe("https://os.example.com/recuperar?vencido=1");
  });

  it("un next hacia otro dominio no saca a nadie de la app", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });
    const res = await GET(new Request(`${INTERNAL}/auth/callback?code=abc&next=%2F%2Fevil.com`));
    expect(res.headers.get("location")).toBe("https://os.example.com/dashboard");
  });
});
