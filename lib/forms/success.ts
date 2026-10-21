/**
 * La pantalla de éxito de un formulario (F7).
 *
 * Se arma EN EL SERVIDOR al responder el envío: la definición pública nunca
 * lleva la configuración de éxito (`get_public_form` no la devuelve), así que
 * ni un redirect ni un mensaje con variables se pueden leer sin enviar.
 *
 * Variables: `{{answer.<clave>}}` y `{{form.name}}`. Una variable que no
 * resuelve queda VACÍA en la pantalla pública (nunca cruda).
 */
import { z } from "zod";
import { UTM_KEYS } from "@/lib/attribution/keys";

export type SuccessConfig =
  | {
      mode: "message";
      title?: string;
      body?: string;
      button?: { label: string; url: string };
      /** Solo contratos: el botón "Descargar contrato" con la copia firmada (link de 24 h, `contract/copy-link.ts`). */
      downloadContract?: boolean;
    }
  | { mode: "redirect"; url: string; passParams: boolean };

export const DEFAULT_SUCCESS: SuccessConfig = {
  mode: "message",
  title: "¡Gracias!",
  body: "Recibimos tu respuesta.",
};

const httpUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }, "La dirección tiene que empezar con http:// o https://");

/** Las variables también pueden ir en la URL del botón: ahí se valida ya resuelta. */
const buttonUrl = z.string().trim().min(1).max(2000);

const successSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("message"),
    title: z.string().max(200).optional(),
    body: z.string().max(2000).optional(),
    button: z.object({ label: z.string().trim().min(1).max(60), url: buttonUrl }).optional(),
    downloadContract: z.boolean().optional(),
  }),
  z.object({
    mode: z.literal("redirect"),
    url: httpUrl,
    passParams: z.boolean().default(false),
  }),
]);

export type SuccessResult = { ok: true; success: SuccessConfig } | { ok: false; error: string };

export function validateSuccess(input: unknown): SuccessResult {
  const parsed = successSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "La pantalla de éxito no es válida" };
  return { ok: true, success: parsed.data as SuccessConfig };
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface SuccessContext {
  formName: string;
  /** Respuestas ya pasadas a texto, por clave del campo. */
  answers: Record<string, string>;
  submissionId?: string;
  /** Atribución de la visita: de acá salen los UTM que se suman a una redirección. */
  attribution?: Record<string, string | undefined>;
}

export interface RenderedSuccess {
  mode: "message" | "redirect";
  title?: string;
  body?: string;
  button?: { label: string; url: string };
  url?: string;
  /** Solo un contrato con "Descargar contrato" prendido: dónde bajar la copia firmada. */
  download?: { url: string };
}

const TOKEN_RE = /\{\{\s*(answer\.[a-z][a-z0-9_]*|form\.name)\s*\}\}/g;

function substitute(template: string, ctx: SuccessContext, transform: (value: string) => string): string {
  return template.replace(TOKEN_RE, (_match, path: string) => {
    if (path === "form.name") return transform(ctx.formName);
    const key = path.slice("answer.".length);
    return transform(ctx.answers[key] ?? "");
  });
}

/** Solo http(s): lo que quede de un botón después de resolver variables y que no lo sea se descarta. */
function safeHttp(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * `escape: true` (por defecto) devuelve texto con HTML escapado, para quien lo
 * vaya a incrustar como HTML. La API de envío usa `escape: false`: React ya
 * escapa los nodos de texto y escapar dos veces mostraría `&lt;` en pantalla.
 */
export function renderSuccess(
  success: SuccessConfig,
  ctx: SuccessContext,
  options: { escape?: boolean } = {},
): RenderedSuccess {
  const escape = options.escape ?? true;
  const text = (value: string) => (escape ? escapeHtml(value) : value);

  if (success.mode === "redirect") {
    const url = new URL(success.url);
    if (success.passParams) {
      if (ctx.submissionId) url.searchParams.set("submission_id", ctx.submissionId);
      for (const key of UTM_KEYS) {
        const value = ctx.attribution?.[key];
        if (value) url.searchParams.set(key, value);
      }
    }
    return { mode: "redirect", url: url.toString() };
  }

  const out: RenderedSuccess = {
    mode: "message",
    title: substitute(success.title ?? "", ctx, text),
    body: substitute(success.body ?? "", ctx, text),
  };
  if (success.button) {
    const resolved = substitute(success.button.url, ctx, encodeURIComponent);
    const url = safeHttp(resolved);
    if (url) out.button = { label: text(success.button.label), url };
  }
  return out;
}
