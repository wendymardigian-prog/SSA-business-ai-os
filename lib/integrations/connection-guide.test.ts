/**
 * La guía de conexiones (`guias/conexiones.md`) viaja a cada clon y la usa `/conectar`. Si alguien cambia los
 * permisos de Google o las rutas de retorno del OAuth en el código y no la guía, un cliente configura mal su
 * llave y Google rechaza la conexión (`redirect_uri_mismatch` o un permiso de menos). Este test los ata.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GOOGLE_SCOPES } from "@/lib/social/google";
import { GOOGLE_CALENDAR_SCOPES } from "@/lib/social/google-calendar";
import { OAUTH_ADAPTERS } from "@/lib/oauth/registry";

const GUIDE = readFileSync(join(process.cwd(), "guias/conexiones.md"), "utf8");
const COMMAND = readFileSync(join(process.cwd(), ".claude/commands/conectar.md"), "utf8");

/** En la consola de Google, `email` figura como `userinfo.email`; el resto, con la dirección completa. */
function asShownByGoogle(scope: string): string {
  return scope === "email" ? "https://www.googleapis.com/auth/userinfo.email" : scope;
}

/** El bloque de la opción A (pegar todo de una vez): el primero que empieza con el primer permiso. */
function pastedScopes(): string[] {
  const start = GUIDE.indexOf("https://www.googleapis.com/auth/calendar.calendarlist.readonly");
  const end = GUIDE.indexOf("```", start);
  return GUIDE.slice(start, end).split("\n").map((l) => l.trim()).filter(Boolean);
}

describe("guias/conexiones.md", () => {
  const scopes = [...new Set([...GOOGLE_SCOPES, ...GOOGLE_CALENDAR_SCOPES].map(asShownByGoogle))];

  it("el bloque para pegar tiene exactamente los permisos que pide el sistema", () => {
    expect([...pastedScopes()].sort()).toEqual([...scopes].sort());
  });

  it("la cuenta de permisos que dice la guía coincide con el código", () => {
    expect(GUIDE).toContain(`los ${scopes.length} permisos`);
  });

  it("tiene la dirección de retorno de cada adaptador de Google", () => {
    const google = Object.keys(OAUTH_ADAPTERS).filter((p) => p.startsWith("google"));
    expect(google.sort()).toEqual(["google", "google_calendar"]);
    for (const provider of google) {
      expect(GUIDE).toContain(`https://app.tunegocio.com/api/oauth/${provider}/callback`);
    }
  });

  it("no tiene datos de un negocio real", () => {
    // Solo ejemplos: un dominio, un Reference ID o un proyecto de verdad acá quedarían en todos los clones.
    const domains = GUIDE.match(/https:\/\/[a-z0-9.-]+\.[a-z]{2,}/g) ?? [];
    const allowedHosts = [
      "app.tunegocio.com",
      "tu-app.up.railway.app",
      "abcdefghijklmnopqrst.supabase.co",
      "console.cloud.google.com",
      "www.googleapis.com",
      "app.zernio.com",
      "resend.com",
      "console.anthropic.com",
      "platform.openai.com",
      "aistudio.google.com",
      "dashboard.voyageai.com",
      "console.groq.com",
    ];
    for (const url of domains) {
      expect(allowedHosts).toContain(new URL(url).host);
    }
  });

  it("/conectar reemplaza todos los ejemplos que usa la guía", () => {
    for (const example of ["app.tunegocio.com", "tu-app.up.railway.app", "abcdefghijklmnopqrst", "mi-proyecto-123"]) {
      expect(GUIDE).toContain(example);
      expect(COMMAND).toContain(example);
    }
  });
});
