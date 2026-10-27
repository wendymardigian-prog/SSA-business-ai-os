// Control de textos visibles: lo que la plantilla le MUESTRA a quien la usa (strings y texto
// de JSX, no comentarios) no puede nombrar un modulo que la plantilla no lleva. Un "Lo que ven
// los leads en formularios y contratos" en una plantilla sin Formularios confunde a quien la
// instala: busca una pantalla que no existe.
//
// Mira el codigo de la app (app/, components/, lib/), sin tests: los strings y las partes de
// texto de los template literals, y el texto de JSX. No mira los imports, los console.* (son
// registros, no se ven), los nombres de propiedades ni los tipos literales. Tambien mira los
// textos que se le mandan a un modelo de IA (un prompt que habla de "las ventas" hace que el
// modelo las busque).
//
// Lo que se parece a un modulo sacado y no lo es va en VISIBLE_ALLOWLIST, cada entrada con su
// motivo. Para arreglar un texto en el proyecto sin cambiar lo que hace: una marca
// `@plantilla-sin(<modulo>)` con el texto neutro de la plantilla (ver markers.mjs).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { walkFiles } from "./export-profile.mjs";

const require = createRequire(import.meta.url);

/** Lo que nombra un modulo sacado en un texto visible. */
export const VISIBLE_WORDS = [
  { module: "llamadas", re: /\bFathom\b/g },
  { module: "llamadas", re: /\ban[aá]lisis de (?:las |la )?llamadas?\b|\banalizador de llamadas\b|\bllamadas? de venta\b/gi },
  { module: "llamadas", re: /\bLlamadas\b/g },
  { module: "llamadas", re: /\bes closer\b|\bpuntaje del closer\b|\btipo de llamada\b|\bqui[eé]n es closer\b/gi },
  { module: "formularios", re: /\bformularios?\b/gi },
  { module: "formularios", re: /\bencuestas?\b/gi },
  { module: "formularios", re: /\bcontratos?\b|\bcopia firmada\b|\bse firma\b/gi },
  { module: "formularios", re: /\bEOD\b|\bfin de d[ií]a\b|\breporte del d[ií]a\b/g },
  { module: "ventas", re: /\bventas?\b/gi },
  { module: "ventas", re: /\bpagos?\b/gi },
  { module: "ventas", re: /\bcobranza\b|\bmora\b|\bcobros?\b|\breembolsos?\b/gi },
  { module: "tareas", re: /\btareas?\b/gi },
  // "Gasto" suelto es el de la pauta o el de IA; el modulo habla de "gastos" y "proveedores"
  // ("proveedor" suelto es el de IA, por eso no se busca).
  { module: "finanzas", re: /\bfinanzas\b|\bgastos\b/gi },
  { module: "comisiones", re: /\bcomisi[oó]n(?:es)?\b/gi },
  { module: "webhooks", re: /\bwebhooks? entrantes?\b|\bwebhook recibido\b|\bwebhook\.payload\b|\bflujos? de webhook\b/gi },
  { module: "sitio", re: /\bsitio p[uú]blico\b/gi },
];

/**
 * Lo que se parece a un modulo sacado y no lo es. `files` limita la excepcion a esos archivos
 * (sin `files` vale en toda la copia); `re` es lo que se tapa antes de buscar. Cada una dice por que.
 */
const AGENDA_FILES = /^(components\/scheduling|lib\/scheduling|lib\/actions\/scheduling|app\/calendario|components\/dashboards\/agenda|lib\/dashboards\/agenda\.ts)/;
const AI_TASK_FILES = /^(components\/agents|app\/\(dashboard\)\/dashboard\/agents|lib\/ai-tasks|lib\/actions\/ai-tasks\.ts|lib\/background|lib\/jobs\/handlers\/bg-task\.ts|lib\/settings\/empty-states\.ts)/;
export const VISIBLE_ALLOWLIST = [
  // Agenda
  { files: AGENDA_FILES, re: /\bformularios?\b/gi, why: "en la Agenda, el formulario es el de cada evento (los datos que se piden al reservar)" },
  { files: AGENDA_FILES, re: /\bventas?\b|\bLlamadas de venta\b|\btipo de llamada\b/gi, why: "en la Agenda, «Venta» es un resultado de la reunion y «Ventas» un area; un evento es un «tipo de llamada» que se agenda y «Llamadas de venta» es un ejemplo de nombre de horario" },
  { re: /no se present[oó], venta, seguimiento|venta o no calificado|disponibilidad, formulario/gi, why: "los resultados de una reunion (venta, seguimiento) y el formulario de un evento de la Agenda" },
  // Tareas de IA
  { re: /\btareas? (?:de (?:la )?IA|en segundo plano|del sistema)\b/gi, why: "las tareas de IA (clasificar, resumir, transcribir) son de Agentes IA, no del modulo de Tareas" },
  { files: AI_TASK_FILES, re: /\btareas?\b/gi, why: "en Agentes IA y en sus ajustes, una tarea es una tarea de IA" },
  { re: /\/dashboard\/agents\/tareas\S*/g, why: "la ruta de las tareas de IA (Agentes IA)" },
  { re: /\b(?:tu tarea|agente, tarea u origen)\b/gi, why: "\"tarea\" como palabra comun (la del modelo, o el origen de una corrida de IA)" },
  // Meta Ads
  { files: /^(components\/dashboards\/ads\/col-tips\.ts|lib\/dashboards\/ads-crm-columns\.ts|lib\/dashboards\/ads-leads\.ts)$/, re: /\bformularios?\b/gi, why: "el formulario de clientes potenciales de Meta (lead form), no el modulo de Formularios" },
  { files: /^lib\/dashboards\/ads\.ts$/, re: /\bVentas\b/g, why: "el objetivo de campaña de Meta OUTCOME_SALES" },
  { re: /\bleads, ventas, tr[aá]fico\b/gi, why: "los objetivos de campaña de Meta" },
  { files: /^(components\/dashboards\/unified-dashboard\.tsx|lib\/dashboards\/unified\.ts)$/, re: /\bpagos?\b/gi, why: "lo pago = la pauta, frente a lo organico" },
  { re: /\blo pago\b|\bmedios pagos\b/gi, why: "lo pago = la pauta, frente a lo organico" },
  // Lo que dice o pide un lead, y el catalogo de productos
  { re: /\blink de pago\b|\breembolsos?\b|\bcobro indebido\b/gi, why: "lo que un lead pide o reclama en el chat: vocabulario de cualquier negocio, no del modulo de Ventas" },
  { re: /\bcierra(?:r)? la venta\b/gi, why: "lo que hace el vendedor (closer) del contacto, que la plantilla tiene" },
  { files: /^(components\/catalog|lib\/catalog)\//, re: /\bcobro\b|\bpago [uú]nico\b/gi, why: "como se cobra un producto del catalogo (pago unico o recurrente), que la plantilla tiene" },
  { files: /^lib\/response-assets\/kind\.ts$/, re: /\bformularios?\b|\bpagos?\b/gi, why: "tipos de enlace de la banca de recursos (un link a un formulario o a un pago de afuera)" },
  { files: /^lib\/contacts\/taxonomy\.ts$/, re: /\bformulario\b/g, why: "el medio de un link con utm_medium=form, vocabulario de UTM" },
  // WhatsApp
  { files: /^components\/channels\/whatsapp-call-settings\.tsx$/, re: /\bLlamadas\b/g, why: "las llamadas de WhatsApp (aviso de Evolution), no el modulo de Llamadas" },
  { files: /^lib\/(agent\/effective-text|messages\/attachments)\.ts$/, re: /\bencuestas?\b/gi, why: "una encuesta de WhatsApp (un tipo de mensaje), no el modulo de Formularios" },
  { files: /^lib\/nav\/items\.ts$/, re: /^(?:ventas|Ventas)$/g, why: "la seccion del menu con Contactos y la Agenda (el proceso de venta), y su id" },
  // Etiquetas que solo aparecen con datos que la plantilla no tiene
  { files: /^lib\/flow-engine\/condition-catalog\.ts$/, re: /\bDe sus ventas\b|\bya no existe en el formulario\b/g, why: "grupos y avisos de condiciones que solo aparecen con campos de ese modulo: en la plantilla no hay ninguno" },
];

const SCAN = /^(app|components|lib)\/.*\.(ts|tsx)$/;
const SKIP = /\.test\.tsx?$|\.d\.ts$/;

/** Los textos visibles de un archivo: [{ line, text }]. */
export function visibleStrings(source, rel) {
  const ts = require("typescript");
  const kind = rel.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(rel, source, ts.ScriptTarget.Latest, true, kind);
  const out = [];
  const add = (node, text) => {
    if (!text || !/[A-Za-zÁÉÍÓÚáéíóúñÑ]/.test(text)) return;
    out.push({ line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, text });
  };
  const isConsole = (node) => {
    for (let p = node.parent; p; p = p.parent) {
      if (ts.isCallExpression(p)) {
        const e = p.expression;
        if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === "console") return true;
      }
      if (ts.isBlock(p) || ts.isSourceFile(p)) return false;
    }
    return false;
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isImportTypeNode?.(node)) return;
    if (ts.isLiteralTypeNode(node)) return;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const p = node.parent;
      const isKey = p && (ts.isPropertyAssignment(p) || ts.isPropertySignature(p) || ts.isPropertyDeclaration(p) || ts.isEnumMember(p)) && p.name === node;
      const isCall = p && ts.isCallExpression(p) && ts.isIdentifier(p.expression) && p.expression.text === "require";
      if (!isKey && !isCall && !(p && ts.isExternalModuleReference(p)) && !isConsole(node)) add(node, node.text);
      return;
    }
    if (ts.isTemplateExpression(node)) {
      if (!isConsole(node)) {
        add(node, node.head.text);
        for (const span of node.templateSpans) add(span.literal, span.literal.text);
      }
      ts.forEachChild(node, visit);
      return;
    }
    if (ts.isJsxText(node)) {
      const t = node.text.replace(/\s+/g, " ").trim();
      add(node, t);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** Las menciones de un texto (despues de las excepciones de ese archivo). */
export function visibleModuleWords(text, rel = "") {
  const clean = VISIBLE_ALLOWLIST.reduce((t, a) => (a.files && !a.files.test(rel) ? t : t.replace(a.re, " ")), text);
  return VISIBLE_WORDS.flatMap((w) => [...clean.matchAll(w.re)].map((m) => ({ module: w.module, word: m[0] })));
}

/** Lo que encuentra el control en la copia: [{ file, line, module, word, text }]. */
export function findVisibleModuleStrings(out) {
  const hits = [];
  for (const rel of walkFiles(out)) {
    if (!SCAN.test(rel) || SKIP.test(rel)) continue;
    const source = readFileSync(join(out, rel), "utf8");
    for (const s of visibleStrings(source, rel)) {
      for (const w of visibleModuleWords(s.text, rel)) hits.push({ file: rel, line: s.line, ...w, text: s.text.slice(0, 200) });
    }
  }
  return hits;
}

/** Resumen del control: { ok, detail, text }. */
export function visibleReport(hits) {
  const by = {};
  for (const h of hits) by[h.module] = (by[h.module] ?? 0) + 1;
  const detail = hits.length ? `${hits.length} textos nombran modulos que no viajan (${Object.entries(by).map(([k, v]) => `${k} ${v}`).join(", ")})` : "ninguno";
  const text = [`# Textos visibles que nombran un modulo que no viaja (${hits.length})`, ...hits.map((h) => `${h.file}:${h.line} [${h.module}: ${h.word}] ${h.text}`)].join("\n");
  return { ok: hits.length === 0, detail, text: text + "\n" };
}
