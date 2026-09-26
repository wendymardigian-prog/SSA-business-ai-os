/**
 * Que dice y que ofrece la barra superior de cada pantalla (F7).
 *
 * Hasta la etapa 2 cada pagina escribia su propio encabezado: un h1, a veces un
 * subtitulo, y los filtros y botones metidos adentro del contenido. Eso daba
 * dos barras en el celular (la del workspace y la de la pagina) y ningun lugar
 * donde ver, todo junto, que ofrece cada pantalla y a quien.
 *
 * Aca vive esa decision, como datos puros:
 *   - `PAGE_META`: el titulo y la explicacion (el ⓘ) de cada ruta.
 *   - `pageActions`: que botones y filtros van a la derecha, ya filtrados por
 *     el rol de quien mira.
 *
 * Las pantallas solo lo componen. Asi "un Member no ve Programar" es una linea
 * que se puede probar, y no algo escondido en el medio de un JSX.
 */

/** Como se muestra una accion en la barra. */
export type ActionKind = "primary" | "secondary" | "toggle" | "link";

export interface PageAction {
  /** Identificador estable, para que la pantalla sepa que renderizar. */
  id: string;
  label: string;
  kind: ActionKind;
  /** Solo para `link`. */
  href?: string;
  /** Solo lo ven Owner y Admin. */
  adminOnly?: boolean;
}

export interface PageMeta {
  title: string;
  /** Lo que antes era subtitulo: ahora va en el ⓘ. */
  tooltip: string;
}

/**
 * Titulo y explicacion por ruta.
 *
 * Las rutas con parametro se guardan con el patron (`/dashboard/contacts/[id]`)
 * y se resuelven con `pageMetaFor`, que normaliza el pathname real.
 */
export const PAGE_META: Record<string, PageMeta> = {
  "/dashboard/dashboards/chat": {
    title: "Dashboards",
    tooltip: "Como viene la operacion de chat: cuanto se responde, que tan rapido y quien.",
  },
  "/dashboard/flows": {
    title: "Flows",
    tooltip: "Automatizaciones que responden solas segun lo que escribe el contacto.",
  },
  "/dashboard/flows/templates": {
    title: "Plantillas de flows",
    tooltip: "Automatizaciones armadas para copiar y ajustar.",
  },
  "/dashboard/inbox": {
    title: "Inbox",
    tooltip: "Todas las conversaciones de todos los canales, en un solo lugar.",
  },
  "/dashboard/broadcasts": {
    title: "Broadcasts",
    tooltip: "Un mensaje a muchos contactos a la vez.",
  },
  "/dashboard/sequences": {
    title: "Sequences",
    tooltip: "Seguimientos automaticos que se pausan solos cuando el contacto contesta.",
  },
  "/dashboard/sequences/[sequenceId]": {
    title: "Secuencia",
    tooltip: "Los pasos del seguimiento y quienes estan inscriptos.",
  },
  "/dashboard/growth": {
    title: "Growth",
    tooltip: "Automatizaciones por comentario: una palabra en un post dispara un mensaje.",
  },
  "/dashboard/contacts": {
    title: "Contactos",
    tooltip: "El CRM: cada persona con su historial, sus etiquetas y quien la atiende.",
  },
  "/dashboard/contacts/[contactId]": {
    title: "Contacto",
    tooltip: "Todo lo que sabemos de esta persona y todo lo que paso con ella.",
  },
  "/dashboard/contacts/import": {
    title: "Importar contactos",
    tooltip: "Subir un CSV. Los repetidos se unen por telefono o email, nunca por nombre.",
  },
  "/dashboard/drafts": {
    title: "Borradores",
    tooltip: "Respuestas que escribio el agente y esperan que alguien las apruebe.",
  },
  "/dashboard/channels": {
    title: "Canales",
    tooltip: "Las cuentas conectadas por las que entran y salen los mensajes.",
  },
  "/dashboard/agents": {
    title: "Agentes",
    tooltip: "El agente de IA: que sabe, que puede hacer y que hizo.",
  },
  "/dashboard/agents/[agentId]": {
    title: "Agente",
    tooltip: "Configuracion, herramientas, historial y costos de este agente.",
  },
  "/dashboard/agents/runs/[runId]": {
    title: "Turno del agente",
    tooltip: "Paso por paso de lo que hizo el agente en este turno.",
  },
  "/dashboard/knowledge": {
    title: "Conocimiento",
    tooltip: "Los documentos que el agente puede consultar para responder.",
  },
  "/dashboard/knowledge/[documentId]": {
    title: "Documento",
    tooltip: "Como quedo partido este documento para que el agente lo busque.",
  },
  "/dashboard/settings": {
    title: "Ajustes",
    tooltip: "Configuracion del negocio: equipo, integraciones, campos y plantillas.",
  },
  "/dashboard/settings/team": {
    title: "Equipo",
    tooltip: "Quienes tienen acceso y con que permisos.",
  },
  "/dashboard/settings/integrations": {
    title: "Integraciones",
    tooltip:
      "Todo lo que este sistema conecta con afuera: canales, redes, email e IA. Las claves se guardan encriptadas y nunca se muestran.",
  },
  "/dashboard/settings/custom-fields": {
    title: "Campos personalizados",
    tooltip: "Los datos propios que se guardan de cada contacto.",
  },
  "/dashboard/settings/templates": {
    title: "Respuestas rapidas",
    tooltip: "Textos guardados para contestar sin volver a escribirlos.",
  },
  "/dashboard/settings/background": {
    title: "Tareas en segundo plano",
    tooltip: "Que trabajos de IA corren solos, cuando y con que modelo.",
  },
};

/** Rutas que a proposito NO llevan barra superior, y por que. */
export const PAGES_WITHOUT_HEADER: Record<string, string> = {
  "/dashboard":
    "Redirige al dashboard de chat: no llega a dibujarse.",
  "/dashboard/flows/[flowId]":
    "El editor de flows es un lienzo a pantalla completa con su propia barra. Es zona intocable de la etapa 2.",
  "/dashboard/channels/callback":
    "Pantalla de paso del OAuth de un canal: se cierra sola.",
};

/** Convierte un pathname real en el patron con el que se guarda. */
export function routePattern(pathname: string): string {
  const clean = pathname.replace(/\/+$/, "") || "/dashboard";
  if (PAGE_META[clean] || PAGES_WITHOUT_HEADER[clean]) return clean;

  // Un segmento que parece un id (uuid o cualquier cosa larga sin sentido de
  // ruta) se reemplaza por su patron.
  const patterns = [...Object.keys(PAGE_META), ...Object.keys(PAGES_WITHOUT_HEADER)].filter((p) =>
    p.includes("["),
  );
  for (const pattern of patterns) {
    const regex = new RegExp(`^${pattern.replace(/\[[^\]]+\]/g, "[^/]+")}$`);
    if (regex.test(clean)) return pattern;
  }
  return clean;
}

export function pageMetaFor(pathname: string): PageMeta | null {
  return PAGE_META[routePattern(pathname)] ?? null;
}

export interface PageActionState {
  isAdmin: boolean;
  /** Vista elegida, para las pantallas que tienen varias. */
  view?: string;
  /** Hay algo para filtrar (si no, el filtro no se ofrece). */
  hasData?: boolean;
}

/** Lo que va a la derecha de la barra, ya filtrado por rol. */
const ACTIONS: Record<string, (state: PageActionState) => PageAction[]> = {
  "/dashboard/settings/integrations": () => [
    { id: "attention", label: "Requiere atencion", kind: "toggle", adminOnly: true },
  ],
  "/dashboard/settings/team": () => [
    { id: "invite", label: "Invitar", kind: "primary", adminOnly: true },
  ],
  "/dashboard/contacts": () => [
    { id: "import", label: "Importar", kind: "secondary", href: "/dashboard/contacts/import", adminOnly: false },
    { id: "new", label: "Nuevo contacto", kind: "primary" },
  ],
  "/dashboard/flows": () => [
    { id: "templates", label: "Plantillas", kind: "link", href: "/dashboard/flows/templates" },
    { id: "new", label: "Nuevo flow", kind: "primary" },
  ],
  "/dashboard/sequences": () => [
    { id: "new", label: "Nueva secuencia", kind: "primary", adminOnly: true },
  ],
  "/dashboard/broadcasts": () => [{ id: "new", label: "Nuevo broadcast", kind: "primary" }],
  "/dashboard/channels": () => [
    { id: "connect", label: "Conectar canal", kind: "primary", adminOnly: true },
  ],
  "/dashboard/knowledge": () => [
    { id: "upload", label: "Subir documento", kind: "primary", adminOnly: true },
  ],
  "/dashboard/settings/custom-fields": () => [
    { id: "new", label: "Nuevo campo", kind: "primary", adminOnly: true },
  ],
  "/dashboard/settings/templates": () => [
    { id: "new", label: "Nueva respuesta", kind: "primary", adminOnly: true },
  ],
};

/**
 * Las acciones de una pantalla para quien la esta mirando.
 *
 * Devuelve solo lo que esa persona puede usar: un Member no recibe la accion
 * de administrador, asi no hay que acordarse de esconderla en el JSX.
 */
export function pageActions(pathname: string, state: PageActionState): PageAction[] {
  const build = ACTIONS[routePattern(pathname)];
  if (!build) return [];
  return build(state).filter((action) => !action.adminOnly || state.isAdmin);
}
