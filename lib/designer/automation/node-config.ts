/**
 * El paso «Generar desde plantilla» de las automatizaciones (Diseñador IA, DS7, F57–F58): su configuración y las
 * reglas puras que usan el panel del lienzo, el motor y la validación al publicar.
 *
 * Puro y sin dependencias del servidor: lo importa el navegador.
 */

import type { ConditionFieldSpec } from "@/lib/flow-engine/condition-eval";

/** Si falta un dato (F55). En automatizaciones, «No generar y avisarme» por defecto. */
export type NodeMissingPolicy = "fail" | "template_default" | "empty";

/** Con qué se llena una variable de la plantilla. */
export type VarMapping =
  /** El valor de la plantilla (el del sujeto o el valor por defecto): no se pasa nada. */
  | { mode: "template" }
  /** Una variable del disparador, de un paso anterior o del contacto (`answer.nombre`, `contact.first_name`). */
  | { mode: "variable"; path: string }
  /** La fecha de hoy, con el formato de fecha de la plantilla y la zona del negocio. */
  | { mode: "today" }
  /** Un texto fijo (sin variables). */
  | { mode: "text"; text: string }
  /** Texto y `{{variables}}` mezclados: `{{answer.nombre}} {{answer.apellido}}`. */
  | { mode: "combine"; text: string };

export interface DesignGenerateNodeData {
  actionType?: string;
  label?: string;
  templateId?: string;
  /** El nombre de la plantilla cuando se eligió (solo para mostrar en la tarjeta). */
  templateName?: string;
  /** Por clave de variable de la plantilla. Lo que no está usa el valor de la plantilla. */
  mappings?: Record<string, VarMapping>;
  missingPolicy?: NodeMissingPolicy;
  /** Publicar con link (prendido por defecto). */
  publish?: boolean;
  /** Esperar el PDF antes de seguir (prendido por defecto). */
  waitForPdf?: boolean;
}

export const DESIGN_GENERATE_TYPE = "designGenerate";
export const DESIGN_GENERATE_LABEL = "Generar desde plantilla";

/** El handle que corta el camino (no hay ninguna conexión con ese nombre): la sesión termina con el paso fallido. */
export const DESIGN_STOP_HANDLE = "handle:design_stopped";

export const MISSING_POLICY_LABELS: Record<NodeMissingPolicy, string> = {
  fail: "No generar y avisarme",
  template_default: "Usar el valor de la plantilla",
  empty: "Dejarlo vacío",
};

/** La ayuda fija del panel. */
export const DESIGN_OUTPUTS_HELP = "Deja para los pasos siguientes: {{design.link}}, {{design.pdf_url}}, {{design.code}}";

/** Las seis salidas del paso (F58), en el orden en que se ofrecen. */
export const DESIGN_OUTPUT_KEYS = ["design.id", "design.link", "design.pdf_url", "design.code", "design.status", "design.doc_type"] as const;

export const DESIGN_STATUS_OPTIONS = [
  { value: "queued", label: "En preparación" },
  { value: "ready", label: "Lista" },
  { value: "failed", label: "Falló" },
  { value: "void", label: "Anulada" },
] as const;

const GROUP = "De pasos anteriores";

/** Lo que el paso deja para comparar en Condiciones e interpolar (F58). */
export function designGenerateOutputs(): ConditionFieldSpec[] {
  return [
    { path: "design.id", label: "Diseño generado: id", type: "text", group: GROUP },
    { path: "design.link", label: "Diseño generado: link", type: "text", group: GROUP },
    { path: "design.pdf_url", label: "Diseño generado: link del PDF", type: "text", group: GROUP },
    { path: "design.code", label: "Diseño generado: código", type: "text", group: GROUP },
    {
      path: "design.status",
      label: "Diseño generado: estado",
      type: "single_select",
      options: DESIGN_STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
      group: GROUP,
    },
    { path: "design.doc_type", label: "Diseño generado: tipo de documento", type: "text", group: GROUP },
  ];
}

/** Los valores por defecto del paso. */
export function designGenerateDefaults(data: DesignGenerateNodeData): Required<Pick<DesignGenerateNodeData, "missingPolicy" | "publish" | "waitForPdf">> {
  return {
    missingPolicy: data.missingPolicy && data.missingPolicy in MISSING_POLICY_LABELS ? data.missingPolicy : "fail",
    publish: data.publish !== false,
    waitForPdf: data.waitForPdf !== false,
  };
}

const VARIABLE_PATH_RE = /^[\w-]+(?:\.[\w-]+)*$/;

/** Una asignación válida, o null (una basura se ignora: queda el valor de la plantilla). */
export function parseMapping(value: unknown): VarMapping | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  switch (v.mode) {
    case "template":
    case "today":
      return { mode: v.mode };
    case "variable":
      return typeof v.path === "string" && VARIABLE_PATH_RE.test(v.path.trim()) ? { mode: "variable", path: v.path.trim() } : null;
    case "text":
    case "combine":
      return typeof v.text === "string" ? { mode: v.mode, text: v.text.slice(0, 2000) } : null;
    default:
      return null;
  }
}

/**
 * Los valores que el paso le pasa a la generación (gana sobre el sujeto y el valor por defecto). Una variable que no
 * resuelve, o que resuelve vacía, NO se pasa: así decide la política de «si falta un dato» y nunca sale un `{{...}}`
 * pegado en el certificado.
 *
 * `interpolate` es el de Automatizaciones (`interpolateVariables`): se recibe por parámetro para que esto siga siendo
 * puro y lo pueda importar el navegador.
 */
export function resolveNodeOverrides(
  mappings: Record<string, unknown> | undefined,
  args: { variables: Record<string, unknown>; today: string; interpolate: (text: string, variables: Record<string, unknown>) => string },
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(mappings ?? {})) {
    const mapping = parseMapping(raw);
    if (!mapping || mapping.mode === "template") continue;
    let value = "";
    if (mapping.mode === "today") value = args.today;
    else if (mapping.mode === "text") value = mapping.text;
    else if (mapping.mode === "variable") value = args.interpolate(`{{${mapping.path}}}`, args.variables);
    else value = args.interpolate(mapping.text, args.variables);
    // Lo que no se pudo resolver queda como `{{...}}`: es ruido, no un dato.
    value = value.replace(/\{\{[^}]*\}\}/g, "").replace(/\s+/g, " ").trim();
    if (value) out[key] = value;
  }
  return out;
}

/** Por qué no se puede publicar un flujo con este paso: sin plantilla, no se publica (F57). */
export function designGenerateProblem(data: DesignGenerateNodeData | undefined): string | null {
  return typeof data?.templateId === "string" && data.templateId.trim() ? null : "Elegí la plantilla del paso «Generar desde plantilla».";
}

/** Si el paso de email puede ofrecer «Adjuntar el PDF del diseño generado» (hay un «Generar desde plantilla» antes). */
export function hasDesignStepBefore(
  nodeId: string,
  nodes: ReadonlyArray<{ id: string; type?: string; data?: unknown }>,
  edges: ReadonlyArray<{ source: string; target: string }>,
): boolean {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const stack = edges.filter((e) => e.target === nodeId).map((e) => e.source);
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = byId.get(id);
    if (node && isDesignGenerateNode(node)) return true;
    for (const e of edges) if (e.target === id) stack.push(e.source);
  }
  return false;
}

export function isDesignGenerateNode(node: { type?: string; data?: unknown }): boolean {
  if (node.type === DESIGN_GENERATE_TYPE) return true;
  return node.type === "action" && (node.data as { actionType?: unknown } | undefined)?.actionType === DESIGN_GENERATE_TYPE;
}

/** Una fila del panel: una variable que usa la plantilla y que el paso puede llenar. */
export interface MappingRow {
  key: string;
  label: string;
  /** "Propias", "Contacto", "Negocio" o el del módulo que la registró. */
  group: string;
  /** Una propia sin valor por defecto: si nadie la llena, decide «si falta un dato». */
  required: boolean;
}

/** Las que completa el sistema solo (el código, el tipo y las fechas): no se asignan en el paso. */
export const AUTO_DESIGN_KEYS: readonly string[] = ["design.code", "design.doc_type", "design.issued_on", "design.today"];

/**
 * Las filas del panel a partir de las variables que usa la plantilla (`docVariables`) y sus variables propias. Las
 * propias van primero (son las que el disparador suele tener que llenar). Puro.
 */
export function mappingRows(
  usedKeys: readonly string[],
  customVars: ReadonlyArray<{ key: string; label: string; default?: string | null }>,
  info: (key: string) => { label: string; group: string },
): MappingRow[] {
  const custom = new Map(customVars.map((v) => [v.key, v]));
  const rows: MappingRow[] = [];
  for (const key of usedKeys) {
    if (AUTO_DESIGN_KEYS.includes(key) || rows.some((r) => r.key === key)) continue;
    const own = custom.get(key);
    if (own) rows.push({ key, label: own.label, group: "Propias", required: !(own.default ?? "").trim() });
    else {
      const meta = info(key);
      rows.push({ key, label: meta.label, group: meta.group, required: false });
    }
  }
  return rows.sort((a, b) => Number(b.group === "Propias") - Number(a.group === "Propias"));
}

/** Los grupos del selector de cada variable (F57), a partir de las variables que el lienzo ofrece en este paso. */
export function groupVariableOptions(available: readonly string[]): Array<{ label: string; vars: string[] }> {
  const trigger: string[] = [];
  const previous: string[] = [];
  const contact: string[] = [];
  const business: string[] = [];
  for (const v of available) {
    if (v.startsWith("contact.")) contact.push(v);
    else if (v.startsWith("workspace.")) business.push(v);
    else if (v.startsWith("design.") || v === "ai_response" || v === "contact_result" || v === "contact_fail_reason" || !v.includes(".")) previous.push(v);
    else trigger.push(v);
  }
  return [
    { label: "Del disparador", vars: trigger },
    { label: "De pasos anteriores", vars: previous },
    { label: "Contacto", vars: contact },
    { label: "Negocio", vars: business },
  ].filter((g) => g.vars.length > 0);
}

/** El valor del `<select>` de una fila: `template`, `today`, `text`, `combine` o `var:<ruta>`. */
export function mappingToSelect(mapping: unknown): string {
  const m = parseMapping(mapping);
  if (!m) return "template";
  return m.mode === "variable" ? `var:${m.path}` : m.mode;
}

/** La asignación que deja elegir una opción del selector (conserva el texto si se pasa entre «Texto fijo» y «Combinar»). */
export function selectToMapping(value: string, previous: unknown): VarMapping {
  const prev = parseMapping(previous);
  const prevText = prev && (prev.mode === "text" || prev.mode === "combine") ? prev.text : "";
  if (value.startsWith("var:")) return parseMapping({ mode: "variable", path: value.slice(4) }) ?? { mode: "template" };
  if (value === "today") return { mode: "today" };
  if (value === "text") return { mode: "text", text: prevText };
  if (value === "combine") return { mode: "combine", text: prevText };
  return { mode: "template" };
}
