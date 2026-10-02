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
  "/dashboard/dashboards/ads": {
    title: "Dashboards",
    tooltip: "Como rinden tus anuncios de Meta: gasto, clics, leads y que campaña los trae.",
  },
  "/dashboard/dashboards/unified": {
    title: "Dashboards",
    tooltip: "Lo organico y lo pago del mismo periodo, uno al lado del otro.",
  },
  "/dashboard/dashboards/ads/campaigns/[id]": {
    title: "Campaña",
    tooltip: "Como rinde esta campaña, con sus conjuntos y sus anuncios.",
  },
  "/dashboard/dashboards/ads/adsets/[id]": {
    title: "Conjunto de anuncios",
    tooltip: "Como rinde este conjunto y cada uno de sus anuncios.",
  },
  "/dashboard/dashboards/ads/ads/[id]": {
    title: "Anuncio",
    tooltip: "Como rinde este anuncio, con su creativo y sus rankings.",
  },
  "/dashboard/dashboards/content": {
    title: "Dashboards",
    tooltip:
      "Como rinde lo que publicas: seguidores, alcance, engagement y que formato funciona en cada red.",
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
    title: "Bandeja",
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
  "/dashboard/content": {
    title: "Contenido",
    tooltip:
      "De la idea a la publicacion: el guion, el caption, la media y en que redes sale cada pieza.",
  },
  "/dashboard/content/new": {
    title: "Nueva pieza",
    tooltip: "Una idea o una pieza nueva. Lo minimo para no perderla; el resto se completa despues.",
  },
  "/dashboard/content/[postId]/edit": {
    title: "Editar pieza",
    tooltip:
      "El guion, el caption, la media y cuando sale en cada red. Se guarda solo cada 10 segundos.",
  },
  "/dashboard/content/[postId]": {
    title: "Pieza",
    tooltip: "Como quedo en cada red, que se puede reintentar y que metricas tuvo.",
  },
  "/dashboard/social": {
    title: "Social",
    tooltip: "Tu perfil de cada red y sus publicaciones, con las metricas que la red no muestra.",
  },
  "/dashboard/settings/roles": {
    title: "Roles",
    tooltip: "Que puede hacer cada persona del equipo, y que leads ve.",
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
    tooltip: "Configuracion del negocio: equipo, integraciones, campos y recursos.",
  },
  "/dashboard/settings/team": {
    title: "Equipo",
    tooltip: "Quienes tienen acceso y con que permisos.",
  },
  // ── Agenda (Etapa 4) ──────────────────────────────────────────────────
  "/dashboard/agenda": {
    title: "Agenda",
    tooltip: "Las llamadas agendadas por tus leads y clientes: en lista, kanban o calendario. La configuracion esta en el engranaje.",
  },
  "/dashboard/agenda/configuracion/eventos": {
    title: "Eventos",
    tooltip: "Los tipos de llamada que se pueden agendar, con su link y su embed.",
  },
  "/dashboard/agenda/configuracion/eventos/[id]": {
    title: "Evento",
    tooltip: "Todo lo que define este evento: detalles, disponibilidad, formulario, limites, mensajes y flujos.",
  },
  "/dashboard/agenda/configuracion/eventos/[id]/flujos/[flowId]": {
    title: "Flujo del evento",
    tooltip: "Un flujo lineal: cuando se dispara, condiciones y los mensajes que envia. Se guarda como un flow mas y se puede abrir en el canvas.",
  },
  "/dashboard/agenda/configuracion/disponibilidad": {
    title: "Disponibilidad",
    tooltip: "Tus horarios, sus excepciones por fecha y tu tiempo fuera.",
  },
  "/dashboard/agenda/configuracion/calendarios": {
    title: "Calendarios de Google",
    tooltip: "Tus cuentas de Google conectadas: en cuales se revisan conflictos y en cual se crean las agendas.",
  },
  "/dashboard/agenda/configuracion/categorias": {
    title: "Categorias",
    tooltip: "Areas y tipos con los que se clasifican los eventos y las agendas.",
  },
  "/dashboard/agenda/configuracion/ajustes": {
    title: "Ajustes",
    tooltip: "Tu usuario (va en los links), nombre, foto, zona horaria y formato de hora.",
  },
  "/dashboard/settings/integrations": {
    title: "Integraciones",
    tooltip:
      "Todo lo que este sistema conecta con afuera: canales, redes, email e IA. Las claves se guardan encriptadas y nunca se muestran.",
  },
  "/dashboard/settings/integrations/[providerId]": {
    title: "Integracion",
    tooltip: "Credenciales, cuentas conectadas y actividad de esta integracion.",
  },
  "/dashboard/settings/custom-fields": {
    title: "Campos personalizados",
    tooltip: "Los datos propios que se guardan de cada contacto.",
  },
  "/dashboard/settings/recursos": {
    title: "Banca de recursos",
    tooltip: "Textos y audios guardados para mandar en la bandeja con un clic, o que el agente los use solo.",
  },
  "/dashboard/settings/background": {
    title: "Tareas en segundo plano",
    tooltip: "Que trabajos de IA corren solos, cuando y con que modelo.",
  },
};

/** Rutas que a proposito NO llevan barra superior, y por que. */
export const PAGES_WITHOUT_HEADER: Record<string, string> = {
  "/dashboard/agenda/configuracion":
    "Solo redirige a la seccion por defecto (Eventos); nunca se dibuja.",
  "/dashboard":
    "Redirige al dashboard de chat: no llega a dibujarse.",
  "/dashboard/flows/[flowId]":
    "El editor de flows es un lienzo a pantalla completa con su propia barra. Es zona intocable de la etapa 2.",
  "/dashboard/channels/callback":
    "Pantalla de paso del OAuth de un canal: se cierra sola.",
  "/dashboard/settings/templates":
    "Solo redirige a la banca de recursos unificada (/dashboard/settings/recursos); nunca se dibuja.",
  "/dashboard/settings/audios":
    "Solo redirige a la banca de recursos unificada (/dashboard/settings/recursos); nunca se dibuja.",
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
  "/dashboard/content": () => [
    { id: "new_idea", label: "Nueva idea", kind: "secondary" },
    { id: "new_post", label: "Nuevo post", kind: "primary" },
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
  "/dashboard/settings/recursos": () => [
    { id: "new", label: "Nuevo recurso", kind: "primary", adminOnly: true },
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
