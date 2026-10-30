/**
 * Los remitentes de Resend (suscripcion a emails, E8). Puro: lo usan la pantalla,
 * la accion que guarda, el envio y el aviso de "los emails no salen".
 *
 * Dos remitentes, cada uno armado con un usuario (lo de antes del @) y un dominio
 * VERIFICADO de la cuenta de Resend:
 *  - el de emails importantes (transaccional: agenda, contratos, invitaciones,
 *    avisos). Obligatorio para mandar.
 *  - el de marketing (secuencias, automatizaciones de marketing). Opcional: sin el,
 *    sale el de importantes. Conviene un subdominio aparte para que un envio de
 *    marketing no afecte a los importantes.
 * Ademas el nombre del remitente y un "Responder a" opcional.
 *
 * Se guardan en `integration_configs.config` del proveedor `resend` (sin tabla
 * nueva): `from_local`, `from_domain` y TAMBIEN `from_email` compuesto (lo leen el
 * envio, el aviso de readiness y la tarjeta), mas `marketing_from_*` y `reply_to`.
 */

import type { EmailCategory } from "./subscription";

export interface ResendSenderConfig {
  from_email?: string;
  from_name?: string;
  from_local?: string;
  from_domain?: string;
  marketing_from_local?: string;
  marketing_from_domain?: string;
  marketing_from_email?: string;
  reply_to?: string;
}

/** Las claves que guarda la pantalla de remitentes (y que volver a guardar la key no pisa). */
export const SENDER_CONFIG_KEYS = [
  "from_email",
  "from_name",
  "from_local",
  "from_domain",
  "marketing_from_local",
  "marketing_from_domain",
  "marketing_from_email",
  "reply_to",
] as const;

const LOCAL_RE = /^[A-Za-z0-9._-]+$/;
const DOMAIN_RE = /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const EMAIL_RE = /^[^\s@,;()<>"]+@[^\s@,;()<>"]+\.[^\s@,;()<>"]+$/;

/** Lo de antes del @: solo letras, numeros, punto, guion y guion bajo. `null` = esta bien. */
export function validateSenderLocal(raw: string): string | null {
  const v = raw.trim();
  if (!v) return "Escribí lo que va antes del @ (por ejemplo, hola).";
  if (v.includes("@")) return "Escribí solo lo que va antes del @; el dominio se elige al lado.";
  if (v.length > 64) return "Lo que va antes del @ puede tener hasta 64 caracteres.";
  if (!LOCAL_RE.test(v) || v.startsWith(".") || v.endsWith(".") || v.includes("..")) {
    return "Lo que va antes del @ solo puede tener letras, números, punto, guion y guion bajo.";
  }
  return null;
}

/** Un dominio escrito a mano (cuando la key no deja listarlos). */
export function normalizeDomain(raw: string): string | null {
  const v = raw.trim().toLowerCase().replace(/^@/, "").replace(/\.$/, "");
  return DOMAIN_RE.test(v) ? v : null;
}

/** `hola@mail.negocio.com` → `{ local: "hola", domain: "mail.negocio.com" }`. */
export function splitAddress(email: string | null | undefined): { local: string; domain: string } | null {
  const v = (email ?? "").trim();
  const at = v.lastIndexOf("@");
  if (at < 1 || at === v.length - 1) return null;
  return { local: v.slice(0, at), domain: v.slice(at + 1).toLowerCase() };
}

export function composeAddress(local: string, domain: string): string {
  return `${local.trim()}@${domain.trim().toLowerCase()}`;
}

/** El usuario y el dominio guardados; si no estan (una config vieja), salen de `from_email`. */
export function senderParts(config: ResendSenderConfig, kind: "important" | "marketing"): { local: string; domain: string } {
  if (kind === "important") {
    if (config.from_local && config.from_domain) return { local: config.from_local, domain: config.from_domain };
    return splitAddress(config.from_email) ?? { local: "", domain: "" };
  }
  if (config.marketing_from_local && config.marketing_from_domain) {
    return { local: config.marketing_from_local, domain: config.marketing_from_domain };
  }
  return splitAddress(config.marketing_from_email) ?? { local: "", domain: "" };
}

/** Desde que direccion sale un email de esta categoria. Marketing sin remitente propio: el de importantes. */
export function senderFor(config: ResendSenderConfig, category: EmailCategory | undefined): { email: string | null; name: string | null; replyTo: string | null } {
  const important = config.from_email?.trim() || null;
  const marketing = config.marketing_from_email?.trim() || null;
  return {
    email: category === "marketing" ? (marketing ?? important) : important,
    name: config.from_name?.trim() || null,
    replyTo: config.reply_to?.trim() || null,
  };
}

/** Un dominio de la cuenta de Resend. `status`: verified | pending | not_started | failed | temporary_failure. */
export interface ResendDomain {
  name: string;
  status: string;
}

export function isVerifiedDomain(domain: ResendDomain): boolean {
  return domain.status === "verified";
}

const DOMAIN_STATUS_LABELS: Record<string, string> = {
  verified: "verificado",
  pending: "pendiente",
  not_started: "sin verificar",
  failed: "falló",
  temporary_failure: "falló (temporal)",
};

export function domainStatusLabel(status: string): string {
  return DOMAIN_STATUS_LABELS[status] ?? status;
}

/**
 * El aviso en rojo: el remitente guardado usa un dominio que Resend no tiene verificado,
 * asi que los emails no estan saliendo. Solo con la lista de dominios en la mano.
 */
export function unverifiedSenderWarning(fromEmail: string | null | undefined, domains: ResendDomain[] | null): string | null {
  const parts = splitAddress(fromEmail);
  if (!parts || !domains) return null;
  const match = domains.find((d) => d.name.toLowerCase() === parts.domain);
  if (match && isVerifiedDomain(match)) return null;
  return `Tu remitente actual (${fromEmail}) usa un dominio que Resend no tiene verificado: los emails no están saliendo. Elegí un dominio verificado.`;
}

export interface SenderInput {
  fromLocal: string;
  fromDomain: string;
  fromName?: string;
  marketingLocal?: string;
  marketingDomain?: string;
  replyTo?: string;
}

/**
 * Valida lo que manda la pantalla y arma la config. Con la lista de dominios
 * (`domains`), un dominio que no esta verificado no se guarda. Sin lista (la key no
 * deja listar), el dominio escrito a mano solo tiene que tener forma de dominio.
 */
export function parseSenderInput(input: SenderInput, domains: ResendDomain[] | null): { ok: true; config: ResendSenderConfig } | { ok: false; error: string } {
  const checkDomain = (raw: string, label: string): { ok: true; domain: string } | { ok: false; error: string } => {
    const domain = normalizeDomain(raw);
    if (!domain) return { ok: false, error: `Elegí el dominio del ${label}.` };
    if (domains) {
      const found = domains.find((d) => d.name.toLowerCase() === domain);
      if (!found) return { ok: false, error: `El dominio ${domain} no está en tu cuenta de Resend.` };
      if (!isVerifiedDomain(found)) {
        return { ok: false, error: `El dominio ${domain} todavía no está verificado en Resend (${domainStatusLabel(found.status)}): con ese remitente los emails no salen.` };
      }
    }
    return { ok: true, domain };
  };

  const localError = validateSenderLocal(input.fromLocal ?? "");
  if (localError) return { ok: false, error: `Remitente de emails importantes: ${localError}` };
  const important = checkDomain(input.fromDomain ?? "", "remitente de emails importantes");
  if (!important.ok) return important;

  const config: ResendSenderConfig = {
    from_local: input.fromLocal.trim(),
    from_domain: important.domain,
    from_email: composeAddress(input.fromLocal, important.domain),
    from_name: (input.fromName ?? "").trim().slice(0, 100),
    marketing_from_local: "",
    marketing_from_domain: "",
    marketing_from_email: "",
    reply_to: "",
  };

  const mLocal = (input.marketingLocal ?? "").trim();
  const mDomain = (input.marketingDomain ?? "").trim();
  if (mLocal || mDomain) {
    const mError = validateSenderLocal(mLocal);
    if (mError) return { ok: false, error: `Remitente de marketing: ${mError}` };
    const marketing = checkDomain(mDomain, "remitente de marketing");
    if (!marketing.ok) return marketing;
    config.marketing_from_local = mLocal;
    config.marketing_from_domain = marketing.domain;
    config.marketing_from_email = composeAddress(mLocal, marketing.domain);
  }

  const replyTo = (input.replyTo ?? "").trim();
  if (replyTo) {
    if (!EMAIL_RE.test(replyTo) || replyTo.length > 254) return { ok: false, error: "«Responder a» tiene que ser una dirección de email completa." };
    config.reply_to = replyTo.toLowerCase();
  }
  return { ok: true, config };
}
