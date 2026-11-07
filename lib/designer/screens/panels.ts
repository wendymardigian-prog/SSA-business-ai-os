/**
 * Las pestañas del panel izquierdo del editor (§11.4): IA · Agregar · Capas · Variables (esta última solo en plantillas).
 * En el celular son la barra inferior fija y cada una abre una hoja. La pestaña elegida vive en la URL (`?panel=`).
 *
 * Módulo puro.
 */

export type PanelId = "ia" | "agregar" | "capas" | "variables";

export const PANEL_LABELS: Record<PanelId, string> = { ia: "IA", agregar: "Agregar", capas: "Capas", variables: "Variables" };

/** Las pestañas que tiene el editor: Variables solo en una plantilla. */
export function panelTabs(isTemplate: boolean): PanelId[] {
  return isTemplate ? ["ia", "agregar", "capas", "variables"] : ["ia", "agregar", "capas"];
}

/** Lee `?panel=`: una pestaña que no existe (o Variables fuera de una plantilla) cae en la de siempre. */
export function parsePanel(value: string | null, isTemplate: boolean, origin: string): PanelId {
  const tabs = panelTabs(isTemplate);
  if (value && (tabs as string[]).includes(value)) return value as PanelId;
  // Con IA se arranca en la conversación; a mano, en Agregar.
  return origin === "ai" ? "ia" : "agregar";
}

/** El aviso de arriba del editor cuando se vuelve de crear y la IA no arrancó (`?ia=pendiente|error`). */
export function aiNoticeText(code: string | null): string | null {
  if (code === "pendiente") return "La IA todavía no está disponible en esta versión: el diseño quedó creado y lo podés armar a mano.";
  if (code === "error") return "No pudimos pedirle el diseño a la IA. El diseño quedó creado: probá de nuevo desde la pestaña IA.";
  return null;
}
