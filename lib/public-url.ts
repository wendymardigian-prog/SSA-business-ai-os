/**
 * De qué dominio sale cada link que arma el sistema (3/11/2026).
 *
 * Dos dominios, una regla:
 * - **El dominio principal de la instalación** (`appUrl()`, la variable `NEXT_PUBLIC_APP_URL`): lo que usa el
 *   EQUIPO y los proveedores. Invitaciones, recuperar la contraseña, avisos, links al panel, el retorno de OAuth
 *   (como Google) y los webhooks de Zernio, Evolution y Resend.
 * - **El dominio de los links públicos del negocio** (`publicBaseUrl(workspace)`): lo que ve o recibe un LEAD, o lo
 *   que el negocio pega en otro lado. La agenda, los links firmados, la baja de emails, los links medidos
 *   (`/l/`) y el embed, entre otros. Si el negocio cargó el suyo (Ajustes →
 *   General → Dominio), gana; si no, es el principal.
 *
 * El dominio del negocio vive en `workspaces.scheduling_public_base_url` (00098). Nació solo para la agenda y sin
 * pantalla; desde esta fecha vale para todos los links públicos. No se renombró: no cambió ningún dato y renombrar
 * obligaba a una migración que borra.
 *
 * NUNCA se arma un link con el host del pedido: un email o una automatización salen sin nadie mirando, así que el
 * link que ves en la pantalla tiene que ser el mismo que recibe el lead. Y un "Olvidé mi contraseña" con el host
 * del pedido es un agujero conocido. Para que "el dominio por el que entrás" y "el configurado" coincidan, el
 * middleware lleva el dominio de Railway al principal (`canonicalRedirectUrl`).
 *
 * Módulo puro (sin servidor): lo usan el middleware, las páginas, las acciones y los jobs.
 */

import { appUrl } from "@/lib/app-url";

/** La forma mínima del workspace que hace falta para saber su dominio. */
export type WorkspaceDomainSource = { scheduling_public_base_url?: string | null } | null | undefined;

/** La columna donde vive el dominio del negocio (para los `select`). */
export const BUSINESS_DOMAIN_COLUMN = "scheduling_public_base_url";

/** True para localhost, 127.0.0.1, ::1 y el resto de las direcciones caseras. */
export function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "0.0.0.0" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  );
}

/** El dominio que Railway le da a cada servicio (`algo.up.railway.app`). */
export function isRailwayHost(hostname: string): boolean {
  return hostname.toLowerCase().endsWith(".up.railway.app");
}

/** El origen (`https://host[:puerto]`) de una URL, o null si no es una URL http(s) válida. */
function originOf(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * El dominio propio del negocio, ya normalizado, o null si no tiene (o si lo guardado no sirve: un valor roto nunca
 * llega a un link, se usa el principal).
 */
export function businessDomain(workspace: WorkspaceDomainSource): string | null {
  const origin = originOf(workspace?.scheduling_public_base_url);
  if (!origin || !origin.startsWith("https://")) return null;
  if (isLocalHost(new URL(origin).hostname)) return null;
  return origin;
}

/** La base de los links públicos del negocio, sin barra final: su dominio, o el principal. */
export function publicBaseUrl(workspace: WorkspaceDomainSource): string {
  return businessDomain(workspace) ?? appUrl();
}

/** Lo mínimo de un cliente de Supabase para leer el dominio de un workspace. */
interface DomainReader {
  from(table: "workspaces"): {
    select(columns: string): {
      eq(column: "id", value: string): { maybeSingle(): PromiseLike<{ data: unknown; error: unknown }> };
    };
  };
}

/**
 * `publicBaseUrl` cuando solo se tiene el id (jobs, automatizaciones, el agente). Si la base no responde, el
 * principal: un link que sale con el dominio principal sigue funcionando (los dos apuntan a la misma app).
 */
export async function loadPublicBaseUrl(db: unknown, workspaceId: string): Promise<string> {
  try {
    const { data, error } = await (db as DomainReader)
      .from("workspaces")
      .select(BUSINESS_DOMAIN_COLUMN)
      .eq("id", workspaceId)
      .maybeSingle();
    if (error) {
      console.error("[dominio] no pude leer el dominio del negocio; uso el principal");
      return appUrl();
    }
    return publicBaseUrl(data as WorkspaceDomainSource);
  } catch {
    console.error("[dominio] no pude leer el dominio del negocio; uso el principal");
    return appUrl();
  }
}

export type DomainInputResult = { ok: true; origin: string | null } | { ok: false; error: string };

/**
 * Lo que escribe una persona en «Dominio de tus links» → el origen a guardar. Acepta `links.empresa.com` o
 * `https://links.empresa.com/`. Vacío = sin dominio propio (vuelve al principal).
 */
export function normalizeDomainInput(raw: string): DomainInputResult {
  const text = (raw ?? "").trim();
  if (!text) return { ok: true, origin: null };
  if (/^http:\/\//i.test(text)) return { ok: false, error: "Tiene que empezar con https:// (sin el candado, el navegador lo marca como inseguro)." };
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, error: "Eso no parece un dominio. Escribilo así: links.tuempresa.com" };
  }
  if (url.protocol !== "https:") return { ok: false, error: "Tiene que empezar con https://" };
  if (url.username || url.password) return { ok: false, error: "El dominio no puede llevar usuario ni clave." };
  if ((url.pathname && url.pathname !== "/") || url.search || url.hash) {
    return { ok: false, error: "Solo el dominio, sin nada después (por ejemplo links.tuempresa.com, sin /agenda)." };
  }
  if (isLocalHost(url.hostname)) return { ok: false, error: "Una dirección local no la puede abrir un lead." };
  if (!url.hostname.includes(".")) return { ok: false, error: "Falta la terminación del dominio (.com, .net…)." };
  if (isRailwayHost(url.hostname)) return { ok: false, error: "Ese es el dominio de Railway: cargá el de tu empresa." };
  return { ok: true, origin: url.origin.toLowerCase() };
}

/** Rutas que nunca se redirigen al dominio principal (ver `canonicalRedirectUrl`). */
const NO_REDIRECT_PREFIXES = ["/api/", "/_next/", "/auth/", "/embed/"];

/**
 * A dónde mandar a quien entra por el dominio de Railway, o null para dejarlo pasar.
 *
 * Solo se redirige el dominio de Railway, y solo páginas que se abren en el navegador (GET/HEAD). Nunca:
 * - `/api/`: los webhooks ya registrados en Zernio, Evolution y Resend, el clic de baja de un email (POST) y los
 *   formularios de otras webs siguen llegando por Railway.
 * - `/auth/`: el retorno de Supabase guarda su verificación en una cookie del dominio por el que se pidió.
 * - `/embed/` y `?embed=1`: un embed ya instalado en otra web confía SOLO en los mensajes de su dominio; si la agenda
 *   se abriera en otro, dejaría de avisarle (alto, reserva hecha).
 * - Server Actions y envíos (POST): un 307 los repetiría en otro dominio sin la sesión.
 * Tampoco si el principal no está configurado, es local o es el mismo Railway.
 */
export function canonicalRedirectUrl(input: { url: string; method: string; host: string | null; mainUrl: string }): string | null {
  const method = input.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") return null;
  const host = (input.host ?? "").split(",")[0].trim().toLowerCase().replace(/:\d+$/, "");
  if (!host || !isRailwayHost(host)) return null;

  const main = originOf(input.mainUrl);
  if (!main || !main.startsWith("https://")) return null;
  const mainHost = new URL(main).hostname;
  if (isLocalHost(mainHost) || isRailwayHost(mainHost) || mainHost === host) return null;

  let current: URL;
  try {
    current = new URL(input.url);
  } catch {
    return null;
  }
  if (NO_REDIRECT_PREFIXES.some((prefix) => current.pathname.startsWith(prefix))) return null;
  if (current.searchParams.get("embed") === "1") return null;

  return `${main}${current.pathname}${current.search}`;
}
