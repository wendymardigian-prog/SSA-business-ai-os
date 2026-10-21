/**
 * La barra superior del editor de un formulario (plano formularios-ui, F7). Puro: decide que pestañas hay,
 * como se llaman, cual esta marcada, que boton de publicar corresponde y que estado se muestra. El componente
 * (`components/forms/editor/editor-bar.tsx`) solo lo dibuja.
 */
import { FORM_STATUS_LABELS, type FormStatus, type FormType } from "./fields";

/** Las pestañas que viven dentro del editor y se eligen con `?tab=`. */
/**
 * `campos` es la pestaña Diseño (el lienzo con las preguntas y, en un contrato, el texto y la firma). La clave no
 * cambió para no romper links; `contrato` ya no es una pestaña: un link viejo con `?tab=contrato` abre Diseño.
 */
export type EditorSection = "campos" | "contacto" | "flows" | "publicar" | "configuracion" | "canales";

/** Donde esta parado el editor: la pantalla principal o una de sus rutas hermanas. */
export type EditorRoute = "editor" | "respuestas" | "metricas" | "encuesta" | "reportes";

export type SaveState = "saved" | "pending" | "saving" | "error" | "conflict";

export interface BarForm {
  id: string;
  type: FormType;
  status: FormStatus;
  /** Solo un reporte de fin de dia: si lleva canales (setters) o no. */
  eodVariant?: "setter" | "general" | null;
  /** Lo que esta en el borrador no es lo que esta en linea. */
  hasUnpublishedChanges: boolean;
  /** Respuestas (o reportes) para el numerito de la pestaña; null si no se midio. */
  responseCount: number | null;
}

export interface BarTab {
  key: string;
  label: string;
  href: string;
  active: boolean;
  /** Dentro del editor (se cambia sin recargar) o una ruta propia (se navega). */
  kind: "section" | "route";
  count?: number;
}

export type PublishKind = "publish" | "publish_changes" | "published" | "none";

export interface EditorBarView {
  backHref: string;
  tabs: BarTab[];
  status: { label: string; tone: FormStatus };
  /** "Cambios sin publicar": solo si esta publicado y el borrador es distinto. */
  unpublishedBadge: boolean;
  /** El guardado automatico: solo donde hay borrador que guardar. */
  save: { state: SaveState; label: string; retry: "none" | "retry" | "reload" } | null;
  metrics: { href: string; active: boolean };
  showPreview: boolean;
  publish: { kind: PublishKind; label: string };
  /** El nombre interno se edita en la barra (solo en el editor, con permiso y sin archivar). */
  nameEditable: boolean;
}

const LIST_HREF = "/dashboard/formularios";

export function sectionsFor(type: FormType, eodVariant?: "setter" | "general" | null): Array<{ key: EditorSection; label: string }> {
  if (type === "eod") {
    return [
      { key: "configuracion", label: "Configuración" },
      { key: "campos", label: "Preguntas" },
      ...(eodVariant === "setter" ? [{ key: "canales" as const, label: "Canales" }] : []),
      { key: "flows", label: "Flows" },
      { key: "publicar", label: "Publicar" },
    ];
  }
  return [
    { key: "campos", label: "Diseño" },
    { key: "contacto", label: "Contacto" },
    { key: "flows", label: "Flows" },
    { key: "publicar", label: "Publicar" },
  ];
}

/** La pestaña de `?tab=`. Un valor invalido (o de otro tipo de formulario) cae en la primera. */
export function parseEditorTab(type: FormType, eodVariant: "setter" | "general" | null | undefined, raw: unknown): EditorSection {
  const sections = sectionsFor(type, eodVariant);
  const value = Array.isArray(raw) ? raw[0] : raw;
  // La vieja pestaña Contrato vive ahora dentro de Diseño.
  const wanted = value === "contrato" ? "campos" : value;
  return sections.find((s) => s.key === wanted)?.key ?? sections[0].key;
}

/** La direccion de una pestaña del editor: la primera es la pantalla sin `?tab=`. */
export function sectionHref(formId: string, key: EditorSection, first: EditorSection): string {
  const base = `${LIST_HREF}/${formId}`;
  return key === first ? base : `${base}?tab=${key}`;
}

export function publishButton(form: Pick<BarForm, "status" | "hasUnpublishedChanges">, canManage: boolean): { kind: PublishKind; label: string } {
  if (!canManage || form.status === "archived") return { kind: "none", label: "" };
  if (form.status === "published") {
    return form.hasUnpublishedChanges ? { kind: "publish_changes", label: "Publicar cambios" } : { kind: "published", label: "Publicado" };
  }
  return { kind: "publish", label: "Publicar" };
}

const SAVE_LABEL: Record<SaveState, string> = {
  saved: "Guardado ✓",
  pending: "Guardando…",
  saving: "Guardando…",
  error: "No se guardó",
  conflict: "Alguien más cambió este formulario",
};

export function editorBarView(
  form: BarForm,
  options: { canManage: boolean; route: EditorRoute; section?: EditorSection; saveState?: SaveState },
): EditorBarView {
  const sections = sectionsFor(form.type, form.eodVariant);
  const first = sections[0].key;
  const isEod = form.type === "eod";
  const base = `${LIST_HREF}/${form.id}`;
  const active = options.route === "editor" ? (options.section ?? first) : null;

  const tabs: BarTab[] = [];
  for (const s of sections) {
    tabs.push({ key: s.key, label: s.label, href: sectionHref(form.id, s.key, first), active: active === s.key, kind: "section" });
    // La encuesta es una ruta propia (su panel de NPS y su configuracion); va justo despues de Diseño.
    if (form.type === "survey" && s.key === "campos") {
      tabs.push({ key: "encuesta", label: "Encuesta", href: `${base}/encuesta`, active: options.route === "encuesta", kind: "route" });
    }
  }
  tabs.push({
    key: isEod ? "reportes" : "respuestas",
    label: isEod ? "Reportes" : "Respuestas",
    href: `${base}/${isEod ? "reportes" : "respuestas"}`,
    active: options.route === (isEod ? "reportes" : "respuestas"),
    kind: "route",
    ...(form.responseCount !== null ? { count: form.responseCount } : {}),
  });

  const editing = options.route === "editor" && options.canManage && form.status !== "archived";
  const state = options.saveState ?? "saved";
  return {
    backHref: LIST_HREF,
    tabs,
    status: { label: FORM_STATUS_LABELS[form.status], tone: form.status },
    unpublishedBadge: form.status === "published" && form.hasUnpublishedChanges,
    save: editing ? { state, label: SAVE_LABEL[state], retry: state === "error" ? "retry" : state === "conflict" ? "reload" : "none" } : null,
    metrics: { href: `${base}/metricas`, active: options.route === "metricas" },
    // Un reporte de fin de dia no tiene pagina publica que previsualizar.
    showPreview: !isEod,
    publish: publishButton(form, options.canManage),
    nameEditable: editing,
  };
}
