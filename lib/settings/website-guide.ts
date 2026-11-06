/**
 * La guía viva de Ajustes → Integraciones → Tu sitio web: con los datos REALES del
 * workspace (la dirección de la app, su identificador y sus formularios publicados con
 * las `key` de sus preguntas) arma los ejemplos para conectar la web.
 *
 * PURO: la página le pasa los datos y muestra lo que devuelve.
 */
import type { FormField } from "@/lib/forms/fields";

export interface GuideForm {
  name: string;
  slug: string;
  fields: Array<{ key: string; label: string; type: string; required: boolean }>;
}

/** Las preguntas que la web manda en `answers` (sin ocultos `fixed`: esos los pone el servidor). */
export function guideFields(fields: FormField[]): GuideForm["fields"] {
  return fields
    .filter((f) => !(f.type === "hidden" && f.hidden?.source === "fixed"))
    .map((f) => ({ key: f.key, label: (f.label ?? "").trim() || f.key, type: f.type, required: f.required === true }));
}

export function submitEndpoint(appUrl: string, slug: string): string {
  return `${appUrl}/api/public/forms/${encodeURIComponent(slug)}/submit`;
}

export function unsubscribeLinkEndpoint(appUrl: string, workspaceSlug: string): string {
  return `${appUrl}/api/public/email/unsubscribe-link?workspace=${encodeURIComponent(workspaceSlug)}`;
}

function placeholderFor(type: string): string {
  switch (type) {
    case "email":
      return "persona@ejemplo.com";
    case "phone":
      return "+5491122334455";
    case "consent":
      return "true";
    case "number":
    case "rating":
    case "nps":
      return "5";
    default:
      return "…";
  }
}

/** El `fetch` de un envío desde la web, listo para copiar. */
export function submitSnippet(appUrl: string, form: GuideForm): string {
  const answers = form.fields
    .filter((f) => f.type !== "file")
    .map((f) => {
      const value = placeholderFor(f.type);
      const literal = value === "true" || /^\d+$/.test(value) ? value : JSON.stringify(value);
      return `      ${JSON.stringify(f.key)}: ${literal},`;
    })
    .join("\n");
  return `await fetch("${submitEndpoint(appUrl, form.slug)}", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    idempotency_key: crypto.randomUUID(), // uno por envío: un reintento no duplica
    origin: "site",
    answers: {
${answers}
    },
    honeypot: "", // un campo invisible: si un bot lo llena, no se guarda nada
    // Guardalos cuando la persona LLEGA a la web: entry_url y landing_page = location.href, referrer_url = document.referrer.
    attribution: {
      entry_url, landing_page, referrer_url, page_url,
      utm_source, utm_medium, utm_campaign, utm_content, utm_term, utm_id,
      campaign_id, adset_id, ad_id, placement,
      fbclid, fbp, fbc, meta_event_id,
    },
  }),
});`;
}

/** El `fetch` de "mandame un link de baja nuevo". */
export function unsubscribeLinkSnippet(appUrl: string, workspaceSlug: string): string {
  return `await fetch("${unsubscribeLinkEndpoint(appUrl, workspaceSlug)}", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, honeypot: "" }),
}); // responde siempre { ok: true }`;
}
