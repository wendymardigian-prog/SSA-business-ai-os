/**
 * Palabras clave y automatizaciones (F27).
 *
 * El CTA de una red suele ser "comenta SISTEMA y te mando la guia". Eso solo
 * funciona si existe una automatizacion escuchando esa palabra en esa red. El
 * editor lo comprueba mientras se escribe y lo dice: es la diferencia entre un
 * post que captura leads y uno que le pide a la gente algo que no pasa nada.
 *
 * Es una ADVERTENCIA, nunca un bloqueo: puede haber un motivo para poner la
 * palabra antes de armar el flow.
 *
 * Aca no se toca el motor de automatizaciones: se LEE lo que hay. Lo unico
 * que el contenido escribe es el `postIds` de una automatizacion limitada a un
 * post, y eso pasa recien al publicar.
 */

export type CtaType = "comment" | "dm" | "link" | "none";

export interface NetworkCta {
  type: CtaType;
  keyword?: string | null;
  url?: string | null;
}

/** Una automatizacion del flow builder, en lo que le importa a esto. */
export interface AutomationRule {
  triggerId: string;
  flowId: string;
  flowName: string;
  /** `comment_keyword` responde comentarios; `keyword`, mensajes directos. */
  type: string;
  isActive: boolean;
  /** Los canales a los que aplica. Vacio = cualquiera. */
  channelIds: string[];
  keywords: Array<{ value: string; matchType?: string }>;
  /** Limitada a estos posts. Vacio = cualquiera. */
  postIds: string[];
}

/**
 * Si una palabra dispara una automatizacion.
 *
 * Misma logica que `keywordMatches` del motor (`contains` por defecto), para
 * que lo que dice el editor sea lo que va a pasar de verdad.
 */
export function keywordTriggers(keyword: string, rule: AutomationRule): boolean {
  const needle = keyword.trim().toLowerCase();
  if (!needle) return false;

  return rule.keywords.some((kw) => {
    const value = kw.value?.trim().toLowerCase();
    if (!value) return false;

    switch (kw.matchType ?? "contains") {
      case "exact":
        return needle === value;
      case "startsWith":
        // El comentario empieza con la palabra configurada: si el CTA pide
        // "SISTEMA", un comentario "sistema por favor" entra.
        return needle.startsWith(value) || value.startsWith(needle);
      default:
        return needle.includes(value) || value.includes(needle);
    }
  });
}

/** Que tipo de automatizacion corresponde a cada CTA. */
export function triggerTypeFor(cta: CtaType): string | null {
  if (cta === "comment") return "comment_keyword";
  if (cta === "dm") return "keyword";
  return null;
}

export interface KeywordCheck {
  keyword: string;
  cta: CtaType;
  platform: string;
  /** La automatizacion que responde, si hay alguna. */
  match: { flowId: string; flowName: string; triggerId: string } | null;
  /** Que decir, en palabras. */
  message: string;
  level: "ok" | "warning" | "info";
}

export interface CheckContext {
  platform: string;
  /** El canal de la bandeja de esa red, si tiene. */
  channelId: string | null;
  rules: AutomationRule[];
}

/**
 * Revisa el CTA de una red.
 *
 * Una automatizacion inactiva NO cuenta: existir no es lo mismo que
 * responder, y decir que si cuando esta apagada es peor que decir que no.
 */
export function checkCta(cta: NetworkCta, context: CheckContext): KeywordCheck | null {
  if (cta.type === "none" || cta.type === "link") return null;

  const keyword = (cta.keyword ?? "").trim();
  if (!keyword) {
    return {
      keyword: "",
      cta: cta.type,
      platform: context.platform,
      match: null,
      level: "warning",
      message: "Elegiste un llamado a la accion pero no pusiste la palabra clave.",
    };
  }

  // LinkedIn no tiene automatizaciones: sus respuestas se atienden a mano.
  if (context.platform === "linkedin") {
    return {
      keyword,
      cta: cta.type,
      platform: context.platform,
      match: null,
      level: "info",
      message: "Las respuestas en LinkedIn se atienden a mano: no hay automatizacion que las conteste.",
    };
  }

  const wanted = triggerTypeFor(cta.type);
  const match = context.rules.find(
    (rule) =>
      rule.isActive &&
      rule.type === wanted &&
      // Sin canales declarados, la automatizacion vale para todos.
      (rule.channelIds.length === 0 ||
        (context.channelId !== null && rule.channelIds.includes(context.channelId))) &&
      keywordTriggers(keyword, rule),
  );

  if (!match) {
    return {
      keyword,
      cta: cta.type,
      platform: context.platform,
      match: null,
      level: "warning",
      message: `Ninguna automatizacion responde a "${keyword}" en ${context.platform}.`,
    };
  }

  return {
    keyword,
    cta: cta.type,
    platform: context.platform,
    match: { flowId: match.flowId, flowName: match.flowName, triggerId: match.triggerId },
    level: "ok",
    message:
      cta.type === "comment"
        ? `Comenta "${keyword}" → ${match.flowName}`
        : `Escribi "${keyword}" por DM → ${match.flowName}`,
  };
}

/**
 * Las palabras en mayusculas del texto.
 *
 * Se resaltan en el editor porque asi se escriben los CTA ("comenta
 * SISTEMA"), y sirve para notar que se puso una palabra clave sin declararla.
 * Se ignoran las de una o dos letras y las siglas comunes.
 */
const IGNORED_UPPERCASE = new Set(["OK", "IA", "CEO", "CTA", "DM", "PDF", "IVA", "USD", "ARS"]);

export function findUppercaseWords(text: string): string[] {
  const matches = text.match(/\b[A-ZÁÉÍÓÚÑ]{3,}\b/g) ?? [];
  return [...new Set(matches)].filter((word) => !IGNORED_UPPERCASE.has(word));
}

/**
 * El ultimo parrafo del guion: el cierre, donde va el llamado a la accion.
 *
 * Antes el CTA era un campo propio del copy; con el guion unico (F90) vive al
 * final del texto. Mirar el guion entero marcaria como "palabra clave" cada
 * sigla en mayuscula del desarrollo (ROI, SEO...) y el aviso dejaria de
 * servir, asi que solo se mira el cierre.
 */
export function closingParagraph(script: string | null | undefined): string {
  const paragraphs = (script ?? "")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  return paragraphs[paragraphs.length - 1] ?? "";
}

/** Las palabras en mayuscula del cierre del guion: las candidatas a palabra clave. */
export function findScriptKeywords(script: string | null | undefined): string[] {
  return findUppercaseWords(closingParagraph(script));
}

/**
 * El link para crear la automatizacion que falta, con todo precargado.
 *
 * Que el boton lleve al editor de flows con la palabra, el tipo y la red ya
 * puestos es la diferencia entre arreglarlo ahora y anotarlo para despues.
 */
export function createAutomationHref(check: KeywordCheck, channelId: string | null): string {
  const params = new URLSearchParams({
    trigger: triggerTypeFor(check.cta) ?? "keyword",
    keyword: check.keyword,
  });
  if (channelId) params.set("channel", channelId);
  return `/dashboard/flows?${params.toString()}`;
}

/**
 * Los `postIds` que hay que dejar en una automatizacion limitada a un post,
 * una vez publicado.
 *
 * Sin duplicar: publicar dos veces la misma pieza no tiene que dejar el id
 * repetido.
 */
export function addPostId(current: string[], externalPostId: string): string[] {
  return current.includes(externalPostId) ? current : [...current, externalPostId];
}

/** Si esa automatizacion esta limitada a posts puntuales. */
export function isLimitedToPosts(rule: AutomationRule): boolean {
  return rule.postIds.length > 0;
}
