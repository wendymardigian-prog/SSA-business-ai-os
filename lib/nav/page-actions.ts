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
  /**
   * Lo ve quien tiene este permiso (Owner y Admin los tienen todos). Para
   * las acciones que un rol personalizado puede hacer sin ser Admin.
   */
  permission?: string;
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
  "/dashboard/dashboards/agenda": {
    title: "Dashboards",
    tooltip: "Las reuniones del periodo: cuántas se agendaron, quién las pide, de dónde vienen y cómo terminaron.",
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
    title: "Agentes IA",
    tooltip: "Los agentes y las tareas de IA del negocio: que saben, que pueden hacer y que hicieron.",
  },
  "/dashboard/agents/[agentId]": {
    title: "Agente",
    tooltip: "Configuracion, herramientas, historial y costos de este agente.",
  },
  "/dashboard/agents/tareas/[task]": {
    title: "Tarea de IA",
    tooltip: "Cuando corre, sus instrucciones (si las tiene) y sus corridas.",
  },
  "/dashboard/agents/runs": {
    title: "Corridas",
    tooltip: "Todas las corridas de IA del workspace, de cualquier agente, tarea u origen.",
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
  // ── Llamadas (Fathom + analizador) ────────────────────────────────────
  "/dashboard/llamadas": {
    title: "Llamadas",
    tooltip: "Las llamadas de venta que entran desde Fathom, con su tipo, su análisis y su puntaje. Se consulta Fathom cada 10 minutos.",
  },
  "/dashboard/llamadas/[id]": {
    title: "Llamada",
    tooltip: "La transcripción de la llamada y su análisis. El análisis se puede corregir; lo que dijo la IA queda guardado aparte.",
  },
  "/dashboard/llamadas/mi-fathom": {
    title: "Mi Fathom",
    tooltip: "Conectá tu cuenta de Fathom para que tus llamadas de venta entren solas al sistema.",
  },
  "/dashboard/dashboards/llamadas": {
    title: "Dashboards",
    tooltip: "La calidad de las llamadas de venta: puntaje por criterio, foco de cada closer y objeciones más frecuentes.",
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
    tooltip: "Textos, audios, videos, imágenes, archivos y enlaces guardados para mandar desde la bandeja con un clic, o para que el asistente los use solo.",
  },
  "/dashboard/settings/productos": {
    title: "Productos",
    tooltip: "Lo que vendes, con su precio en dolares y su estado. Se usan para clasificar tus ideas y piezas. No se borran: se ponen inactivos o discontinuados.",
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
  "/dashboard/settings/contenido":
    "Solo redirige a Productos (/dashboard/settings/productos); los pilares se mudaron a la pagina de Contenido.",
  "/dashboard/settings/background":
    "Solo redirige a Agentes IA (/dashboard/agents); las tareas de IA se mudaron ahi.",
  "/dashboard/content/[postId]":
    "Solo redirige al tablero con el drawer de esa pieza abierto (F99); nunca se dibuja.",
  "/dashboard/content/[postId]/edit":
    "Solo redirige al tablero con el drawer de esa pieza abierto (F99); nunca se dibuja.",
};

/**
 * El ⓘ de la barra de Contenido: lo que puede hacer QUIEN mira (F98).
 *
 * Es distinto para cada rol: un Member propone ideas y crea piezas, y aprobar,
 * programar y publicar es de quien tiene esos permisos. Decirlo aca evita que
 * alguien busque un boton que no esta y no sepa por que.
 */
export function contentTooltip(perms: { approve: boolean; publish: boolean; ai: boolean }, timeZoneLabel?: string): string {
  const can = ["proponés ideas", "creás y editás tus piezas"];
  if (perms.approve) can.push("aprobás ideas y piezas");
  if (perms.ai) can.push("generás el guion y los captions con IA");
  if (perms.publish) can.push("programás y publicás");

  const cannot: string[] = [];
  if (!perms.approve) cannot.push("aprobar");
  if (!perms.publish) cannot.push("programar y publicar");
  if (!perms.ai) cannot.push("generar con IA");

  const parts = [`Con tu rol ${can.join(", ")}.`];
  if (cannot.length > 0) {
    parts.push(`${cannot.join(", ")} ${cannot.length === 1 ? "es" : "son"} de quien tiene ese permiso (Owner y Admin, o un rol que lo incluya).`);
  }
  if (timeZoneLabel) parts.push(`Zona horaria del negocio: ${timeZoneLabel}.`);
  return parts.join(" ");
}

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
  /** Las claves del rol resuelto, para las acciones con `permission`. */
  permissionKeys?: string[];
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
    // Banca v2 (F4): no es por cargo, es por permiso.
    { id: "new", label: "Nuevo recurso", kind: "primary", permission: "templates.manage" },
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
  return build(state).filter((action) => {
    if (action.adminOnly && !state.isAdmin) return false;
    if (action.permission && !state.isAdmin) return (state.permissionKeys ?? []).includes(action.permission);
    return true;
  });
}
