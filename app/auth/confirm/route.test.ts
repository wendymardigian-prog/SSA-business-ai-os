import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const verifyOtp = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { verifyOtp } }) }));

import { GET } from "./route";

// Detras de Railway el pedido llega como localhost:8080: la redireccion tiene que ir al dominio de la app.
const INTERNAL = "http://localhost:8080";

describe("/auth/confirm", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://os.example.com");
    verifyOtp.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("un token válido lleva a la ruta pedida en el dominio de la app", async () => {
    verifyOtp.mockResolvedValue({ error: null });
    const res = await GET(new Request(`${INTERNAL}/auth/confirm?token_hash=t&type=recovery&next=%2Frestablecer`));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://os.example.com/restablecer");
  });

  it("un token de recuperación vencido vuelve a pedir uno nuevo", async () => {
    verifyOtp.mockResolvedValue({ error: { message: "expired" } });
    const res = await GET(new Request(`${INTERNAL}/auth/confirm?token_hash=t&type=recovery`));
    expect(res.headers.get("location")).toBe("https://os.example.com/recuperar?vencido=1");
  });

  it("sin token, a la entrada con el aviso genérico", async () => {
    const res = await GET(new Request(`${INTERNAL}/auth/confirm`));
    expect(res.headers.get("location")).toBe("https://os.example.com/login?error=auth");
  });
});
