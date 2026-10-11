/**
 * Caracterización de `updateSession` ANTES de que Formularios (FO4, F30) abra
 * el área pública del sitio.
 *
 * Fija quién va adónde, con y sin sesión. F30 no puede cambiar nada de esto:
 * lo único nuevo es que `/` deja de redirigir al login por código propio de la
 * página (ahora la decide `app/(sitio)/page.tsx`), no por el middleware.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const getClaims = vi.fn();

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getClaims } }),
}));

import { updateSession } from "./middleware";

const ORIGIN = "http://localhost:3000";

function withSession(on: boolean) {
  getClaims.mockResolvedValue({ data: { claims: on ? { sub: "user-1" } : null } });
}

async function go(path: string) {
  const res = await updateSession(new NextRequest(`${ORIGIN}${path}`));
  const location = res.headers.get("location");
  return { status: res.status, location: location ? new URL(location).pathname : null };
}

beforeEach(() => {
  getClaims.mockReset();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.test";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
});

describe("updateSession: quién va adónde (previo a Formularios)", () => {
  it("sin sesión: /dashboard va a /login", async () => {
    withSession(false);
    expect(await go("/dashboard")).toEqual({ status: 307, location: "/login" });
    expect(await go("/dashboard/contacts")).toEqual({ status: 307, location: "/login" });
  });

  it("con sesión: /login va a /dashboard", async () => {
    withSession(true);
    expect(await go("/login")).toEqual({ status: 307, location: "/dashboard" });
  });

  it("sin sesión: /login se muestra", async () => {
    withSession(false);
    expect((await go("/login")).location).toBeNull();
  });

  it("/register siempre va a /login (el alta es solo por invitación)", async () => {
    withSession(false);
    expect(await go("/register")).toEqual({ status: 307, location: "/login" });
    withSession(true);
    expect(await go("/register")).toEqual({ status: 307, location: "/login" });
  });

  it("/ pasa por el middleware sin redirigir (lo decide la página)", async () => {
    withSession(false);
    expect((await go("/")).location).toBeNull();
    withSession(true);
    expect((await go("/")).location).toBeNull();
  });

  it("las páginas públicas existentes pasan con y sin sesión", async () => {
    for (const on of [false, true]) {
      withSession(on);
      for (const path of ["/calendario/ana/llamada", "/invite/abc", "/f/aplicacion", "/ejemplo"]) {
        expect((await go(path)).location, `${path} con sesión=${on}`).toBeNull();
      }
    }
  });

  it("la API y el callback pasan sin mirar la sesión", async () => {
    withSession(false);
    expect((await go("/api/webhooks/late")).location).toBeNull();
    expect((await go("/auth/callback")).location).toBeNull();
    expect(getClaims).not.toHaveBeenCalled();
  });
});
