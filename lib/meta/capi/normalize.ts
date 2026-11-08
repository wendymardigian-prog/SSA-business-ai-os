/**
 * Los datos de la persona, como los pide la API de Conversiones de Meta (CAPI).
 *
 * Meta cruza el evento con una cuenta suya por estos datos, y solo los acepta normalizados y con hash SHA-256 (el
 * email, el teléfono, el nombre, el país, el id externo). La IP, el navegador y las cookies `fbp`/`fbc` van SIN hash:
 * Meta los usa tal cual. Un dato que no pasa la normalización no se manda: un hash de basura no coincide con nadie y
 * baja la calidad del evento.
 *
 * Reglas de Meta (customer information parameters, noviembre 2026):
 *   em       minúsculas y sin espacios.
 *   ph       solo dígitos, CON el código de país y sin el «+» ni ceros adelante.
 *   fn / ln  minúsculas, sin puntuación (las letras con tilde van en UTF-8).
 *   country  dos letras ISO 3166-1, en minúsculas.
 *   external_id  el hash es recomendado: va con hash.
 *
 * Puro (salvo el hash de `node:crypto`): sin base y sin red. Solo servidor.
 */

import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { normalizePhone } from "@/lib/phone";
import { isPlaceholderName } from "@/lib/contacts/anonymous";

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim().toLowerCase();
  return EMAIL_RE.test(value) ? value : null;
}

/** «+54 9 11 2233-4455» → «5491122334455». Sin código de país no hay forma de saberlo: lo guardado ya lo trae. */
export function normalizePhoneForMeta(raw: string | null | undefined): string | null {
  const phone = normalizePhone(raw);
  return phone ? phone.slice(1) : null;
}

/** Minúsculas, sin puntuación ni espacios: «María José» → «maríajosé». */
export function normalizeNamePart(raw: string | null | undefined): string | null {
  const value = (raw ?? "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}]/gu, "");
  return value || null;
}

/**
 * Nombre y apellido desde el nombre del contacto: la primera palabra es el nombre y la última el apellido. Un id o un
 * «@usuario» puesto como nombre (un relleno) no es un nombre: no se manda.
 */
export function splitName(displayName: string | null | undefined): { fn: string | null; ln: string | null } {
  const value = (displayName ?? "").trim();
  if (!value || isPlaceholderName(value) || value.includes("@")) return { fn: null, ln: null };
  const words = value.split(/\s+/).filter(Boolean);
  const fn = normalizeNamePart(words[0]);
  const ln = words.length > 1 ? normalizeNamePart(words[words.length - 1]) : null;
  return { fn, ln };
}

export function normalizeCountry(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim().toLowerCase();
  return /^[a-z]{2}$/.test(value) ? value : null;
}

/** La IP de la persona, solo si es una dirección real (no la de relleno `0.0.0.0` que usan los topes). */
export function normalizeIp(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value || value === "0.0.0.0" || value === "::") return null;
  return isIP(value) ? value : null;
}

export function normalizeUserAgent(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  return value ? value.slice(0, 500) : null;
}

// `fb.<subdominio>.<milisegundos>.<valor>`: lo que guardan las cookies `_fbc` y `_fbp` (y lo que arma la atribución).
const FBC_RE = /^fb\.\d\.\d{10,13}\.\S{1,500}$/;
const FBP_RE = /^fb\.\d\.\d{10,13}\.\d{1,30}$/;

export function normalizeFbc(raw: unknown): string | null {
  return typeof raw === "string" && FBC_RE.test(raw.trim()) ? raw.trim() : null;
}

export function normalizeFbp(raw: unknown): string | null {
  return typeof raw === "string" && FBP_RE.test(raw.trim()) ? raw.trim() : null;
}

/**
 * El `fbc` cuando no hay cookie pero sí el `fbclid` del link: `fb.1.<cuándo se vio>.<fbclid>`. El `fbclid` va tal cual
 * (Meta: «es sensible a mayúsculas, no lo modifiques»).
 */
export function fbcFromFbclid(fbclid: unknown, seenAt: Date): string | null {
  if (typeof fbclid !== "string") return null;
  const value = fbclid.trim();
  if (!/^[A-Za-z0-9_-]{10,500}$/.test(value)) return null;
  const ms = seenAt.getTime();
  return Number.isFinite(ms) ? `fb.1.${ms}.${value}` : null;
}

export interface UserDataInput {
  emails?: Array<string | null | undefined>;
  phones?: Array<string | null | undefined>;
  displayName?: string | null;
  country?: string | null;
  /** El id del contacto en SSA. */
  externalId?: string | null;
  clientIp?: string | null;
  userAgent?: string | null;
  fbc?: string | null;
  fbp?: string | null;
}

/** El `user_data` que viaja a Meta. Cada clave existe solo si hay un dato que pasó la normalización. */
export interface MetaUserData {
  em?: string[];
  ph?: string[];
  fn?: string[];
  ln?: string[];
  country?: string[];
  external_id?: string[];
  client_ip_address?: string;
  client_user_agent?: string;
  fbc?: string;
  fbp?: string;
}

function hashedList(values: Array<string | null>): string[] | undefined {
  const unique = [...new Set(values.filter((v): v is string => !!v))];
  return unique.length > 0 ? unique.map(sha256) : undefined;
}

export function buildUserData(input: UserDataInput): MetaUserData {
  const { fn, ln } = splitName(input.displayName);
  const externalId = (input.externalId ?? "").trim().toLowerCase();
  const data: MetaUserData = {
    em: hashedList((input.emails ?? []).map(normalizeEmail)),
    ph: hashedList((input.phones ?? []).map(normalizePhoneForMeta)),
    fn: hashedList([fn]),
    ln: hashedList([ln]),
    country: hashedList([normalizeCountry(input.country)]),
    external_id: hashedList([externalId || null]),
  };
  const ip = normalizeIp(input.clientIp);
  const ua = normalizeUserAgent(input.userAgent);
  const fbc = normalizeFbc(input.fbc);
  const fbp = normalizeFbp(input.fbp);
  if (ip) data.client_ip_address = ip;
  if (ua) data.client_user_agent = ua;
  if (fbc) data.fbc = fbc;
  if (fbp) data.fbp = fbp;
  for (const key of Object.keys(data) as Array<keyof MetaUserData>) {
    if (data[key] === undefined) delete data[key];
  }
  return data;
}

/**
 * Si Meta puede cruzar el evento con alguien. El `external_id` solo no alcanza (solo coincide si el Pixel mandó el
 * mismo, y no lo manda), ni el nombre o el país solos.
 */
export function hasMatchData(data: MetaUserData): boolean {
  return Boolean(data.em || data.ph || data.fbc || data.fbp || (data.client_ip_address && data.client_user_agent));
}
