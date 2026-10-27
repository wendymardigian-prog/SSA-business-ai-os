#!/usr/bin/env node
// Limpia la historia de los comentarios de la base de referencia de la plantilla.
//
//   node scripts/plantilla/clean-history.mjs [--db-url=postgresql://...] [--dry-run]
//
// Las migraciones de la plantilla copian tal cual el codigo de cada funcion y los
// comentarios de la base (COMMENT ON). Muchos de esos textos cuentan historia del
// proyecto: numeros de migracion ("(00256)"), codigos de requerimiento ("F16"),
// fechas, "desde la 00136", modulos que la plantilla no tiene. Este script los
// limpia EN LA BASE DE REFERENCIA (ya podada), asi lo que genera
// generate-migrations.mjs sale limpio y la comparacion de las dos bases sigue dando
// cero diferencias.
//
// Que toca, y nada mas:
//   - Los comentarios `--` y `/* */` del cuerpo de las funciones. El cuerpo se lee
//     con un analizador lexico (lexSql): un `--` adentro de un texto entre comillas
//     o entre $$ no es un comentario y no se toca. La funcion se vuelve a crear con
//     CREATE OR REPLACE y el mismo texto, cambiando solo esos comentarios.
//   - Los COMMENT ON de tablas, columnas, indices y funciones.
//   - La descripcion de las filas de private.system_config.
//
// Las reglas son explicitas (RULES y REWRITES, abajo). Una linea de comentario que
// queda vacia se borra entera. Con --dry-run muestra cada cambio sin escribir nada.
//
// Exporta lexSql, cleanComment, findHistory y HISTORY_PATTERNS para el generador y el
// verificador.
import pg from "pg";
import { pathToFileURL } from "node:url";

// ---------------------------------------------------------------------------
// Analizador lexico de SQL (lo justo para separar codigo, textos y comentarios).
// ---------------------------------------------------------------------------
// Devuelve una lista de piezas { type, text } que, juntas, dan el texto original:
//   code, line_comment ("-- ..." sin el salto de linea), block_comment ("/* ... */",
//   anidables), string ('...', con '' adentro), estring (E'...', con \' adentro),
//   dollar ($tag$ ... $tag$, con su etiqueta), ident ("...").
export function lexSql(src) {
  const out = [];
  let i = 0;
  let code = "";
  const flush = () => {
    if (code) out.push({ type: "code", text: code });
    code = "";
  };
  const isIdentChar = (c) => /[A-Za-z0-9_$]/.test(c ?? "");
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === "-" && n === "-") {
      flush();
      let j = src.indexOf("\n", i);
      if (j === -1) j = src.length;
      out.push({ type: "line_comment", text: src.slice(i, j) });
      i = j;
      continue;
    }
    if (c === "/" && n === "*") {
      flush();
      let depth = 0;
      let j = i;
      while (j < src.length) {
        if (src[j] === "/" && src[j + 1] === "*") {
          depth++;
          j += 2;
        } else if (src[j] === "*" && src[j + 1] === "/") {
          depth--;
          j += 2;
          if (depth === 0) break;
        } else j++;
      }
      out.push({ type: "block_comment", text: src.slice(i, j) });
      i = j;
      continue;
    }
    if (c === "'") {
      // E'...' si la letra anterior es una E suelta (no el final de un identificador).
      const prev = code.slice(-1);
      const isE = (prev === "E" || prev === "e") && !isIdentChar(code.slice(-2, -1));
      if (isE) code = code.slice(0, -1);
      flush();
      let j = i + 1;
      while (j < src.length) {
        if (isE && src[j] === "\\") {
          j += 2;
          continue;
        }
        if (src[j] === "'") {
          if (src[j + 1] === "'") {
            j += 2;
            continue;
          }
          j++;
          break;
        }
        j++;
      }
      out.push({ type: isE ? "estring" : "string", text: (isE ? src[i - 1] : "") + src.slice(i, j) });
      i = j;
      continue;
    }
    if (c === '"') {
      flush();
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === '"') {
          if (src[j + 1] === '"') {
            j += 2;
            continue;
          }
          j++;
          break;
        }
        j++;
      }
      out.push({ type: "ident", text: src.slice(i, j) });
      i = j;
      continue;
    }
    if (c === "$" && !isIdentChar(code.slice(-1))) {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(src.slice(i));
      if (m) {
        flush();
        const tag = m[0];
        const end = src.indexOf(tag, i + tag.length);
        const j = end === -1 ? src.length : end + tag.length;
        out.push({ type: "dollar", tag, text: src.slice(i, j) });
        i = j;
        continue;
      }
    }
    code += c;
    i++;
  }
  flush();
  return out;
}

// El SQL sin comentarios (los textos quedan): para buscar dependencias y nombres.
export function stripComments(src) {
  return lexSql(src)
    .filter((t) => t.type !== "line_comment" && t.type !== "block_comment")
    .map((t) => t.text)
    .join("");
}

// ---------------------------------------------------------------------------
// Que cuenta como historia. Lo usan la limpieza (para avisar) y el verificador.
// ---------------------------------------------------------------------------
export const HISTORY_PATTERNS = [
  { name: "numero de migracion", re: /(?<![\w-])0\d{4}(?![\w-])/ },
  { name: "fecha", re: /\b\d{1,2}\/\d{1,2}\/(?:19|20)\d{2}\b|\b20\d{2}-\d{2}-\d{2}\b/ },
  { name: "produccion", re: /producci[oó]n/i },
  { name: "se aplico", re: /\bse aplic[oó]\b|\bal aplicarla\b|\baplicar (?:la|esta) migraci|\bya aplicad/i },
  { name: "PR", re: /\bPR\s*#\s*\d+/ },
  { name: "nombre propio", re: /\bWendy\b/i },
  { name: "modulo sacado", re: /\bFathom\b|\bEOD\b|fin de d[ií]a|\bcomisi[oó]n|\bfinanzas\b|\bcontratos?\b|webhooks? entrantes?/i },
  { name: "codigo de requerimiento", re: /(?<![\w./-])(?:F|[A-E])\d{1,3}(?![\w-])|§\s?\d/ },
  { name: "etapa o bloque", re: /\b(?:Etapa|Fase|Bloque)\s+\d|\bExtra [A-Z]\b|\bContenido v\d|\bAgenda v\d|\bplano [a-z]+-[\w-]+/i },
  { name: "migracion vieja", re: /\bdesde la migraci|\bmigraci[oó]n (?:vieja|anterior|aparte)|\bla cabecera de (?:esta|la) migraci/i },
];

// Palabras de los modulos que se sacaron, en castellano. Solo se buscan en comentarios
// (el codigo lo revisa check-residue.mjs). Antes de buscar se borran las frases que son
// de lo que se queda.
const MODULE_WORDS = /\b(?:ventas?|pagos?|tareas?|formularios?|llamadas?|cobranza|cobrad[oa]s?|cierres?)\b/i;
const MODULE_SAFE = [
  /tareas? (?:de IA|en segundo plano|del sistema)/gi,
  /llamadas? de WhatsApp/gi,
  /llamadas? (?:al modelo|a IA|a la IA|a una herramienta)/gi,
  /\bllamad[ao]s? (?:a|por) [a-z_.]+\(?/gi,
  /tipos de llamada/gi,
  /antes de cada llamada/gi,
  /la llamada recien quedo sin atender/gi,
  /"<tarea>"/gi,
  /tier pago/gi,
  /Formulario de reserva/gi,
  /formulario \| agenda \| pago/gi,
  /Ventas, Servicio, Equipo y Otros/gi,
  /regla de cierre|al cierre|clasificaci[oó]n al cierre|el cierre de la conversaci[oó]n|un cierre/gi,
];

export function findHistory(text, { comment = true } = {}) {
  const hits = [];
  for (const p of HISTORY_PATTERNS) {
    const m = text.match(p.re);
    if (m) hits.push({ rule: p.name, snippet: around(text, m.index, m[0].length) });
  }
  if (comment) {
    const clean = MODULE_SAFE.reduce((t, re) => t.replace(re, " "), text);
    const m = clean.match(MODULE_WORDS);
    if (m) hits.push({ rule: "palabra de un modulo sacado", snippet: around(clean, m.index, m[0].length) });
  }
  return hits;
}

function around(text, at, len) {
  return text.slice(Math.max(0, at - 50), at + len + 50).replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Las reglas de limpieza. Se aplican, en orden, sobre el texto de un comentario
// (un bloque de lineas `--` seguidas se limpia junto, con "\n" entre lineas).
// ---------------------------------------------------------------------------
// Una referencia suelta: numero de migracion, codigo de requerimiento, seccion del
// plano, bloque, etapa...
const REF = String.raw`(?:migraci[oó]n\s+)?0\d{4}|F\d{1,3}(?:/F\d{1,3})*|[A-E]\d{1,3}|§\s?\d+(?:\.\d+)*|PR\s*#\s*\d+|Bloque\s+\w+|Extra\s+[A-Z]|Contenido\s+v\d|Agenda\s+v\d|plano\s+[\w-]+|Fase\s+\d|Etapa\s+\d|C2`;

export const RULES = [
  // "(00249)", "(F26)", "(F9/F12)", "(Contenido v3, F87; Agenda v2)", "(C2, 00200)", "(§11.4)".
  { re: new RegExp(String.raw`[ \t]*\((?:\s*(?:${REF})\s*[,;/]?\s*(?:y\s+)?)+\)`, "g"), to: "" },
  // Una referencia al final de una lista entre parentesis: "(contacts_automation_changes, 00039)".
  { re: new RegExp(String.raw`,\s*(?:${REF})(?=\s*\))`, "g"), to: "" },
  // "00256: " o "F16: " al principio de un comentario (y la frase sigue en mayuscula).
  { re: new RegExp(String.raw`(^|\n)([ \t]*)(?:${REF}):\s+(\S)`, "g"), to: (_m, a, b, c) => a + b + c.toUpperCase() },
  // Una referencia suelta al final: "... missed_while_assigned_to). 00260."
  { re: new RegExp(String.raw`\s+(?:${REF})\.(\s*)$`, "g"), to: "$1" },
];

// Reescrituras puntuales: texto exacto (o expresion) que necesita otra redaccion para
// no contar historia. Cada una con lo que decia y lo que dice.
export const REWRITES = [
  // --- Cuerpos de funciones ---
  { from: "-- Las cuatro ultimas columnas (cierres y plata) vuelven en NULL: en la plantilla no hay de donde sacarlas.",
    to: "-- Las cuatro ultimas columnas vuelven siempre en NULL: se conservan para que la pantalla no cambie de forma." },
  { from: "  -- 00256: el chat de un conocido va a la persona de esa cuenta, sin reglas y\n  -- sin tocar el setter.",
    to: "  -- El chat de un conocido va a la persona de esa cuenta, sin reglas y\n  -- sin tocar el setter." },
  { from: "-- `archived_at` acompana siempre al estado (CHECK de la 00159): el cambio que se lee es el del estado.",
    to: "-- `archived_at` acompana siempre al estado (lo exige un CHECK): el cambio que se lee es el del estado." },
  { from: "  -- Ver un chat deja ver la ficha (00249): si el contacto tiene una conversacion en una cuenta donde mi rol",
    to: "  -- Ver un chat deja ver la ficha: si el contacto tiene una conversacion en una cuenta donde mi rol" },
  { from: "  -- a. El contacto. Si viene dado (agendar manual, agente), se usa tal cual. Si no, la regla central\n  -- (C2, 00200): busca",
    to: "  -- a. El contacto. Si viene dado (agendar manual, agente), se usa tal cual. Si no, la regla central\n  -- (find_or_create_contact): busca" },
  { from: "  -- b. La asignacion (F22): solo si el campo esta vacio. El UPDATE dispara el\n  -- trigger de la 00039, que emite assignment_changed en automation_events.",
    to: "  -- b. La asignacion: solo si el campo esta vacio. El UPDATE dispara el\n  -- disparador de contacts que emite assignment_changed en automation_events." },
  { from: "  -- c2. El toque de atribucion (Contenido v3, F87; Agenda v2). Vale para el",
    to: "  -- c2. El toque de atribucion. Vale para el" },
  { from: "      -- F16: una foto external se refresca con la URL fresca que trae este mensaje. storage y manual\n      -- no se pisan nunca.",
    to: "      -- Una foto external se refresca con la URL fresca que trae este mensaje. storage y manual\n      -- no se pisan nunca." },
  { from: "  -- Mismo chequeo que match_knowledge_chunks (ver el comentario de la 00049\n  -- sobre por que va el coalesce).",
    to: "  -- Mismo chequeo que match_knowledge_chunks (ver ahi por que va el coalesce)." },
  { from: "    -- de arriba del dashboard los usa (F17).", to: "    -- de arriba del dashboard los usa." },
  { from: "    -- La URL de entrada completa (plano formularios-ui, F18). Un formulario la manda como `entry_url`; la Agenda,\n    -- dentro de `raw.utm` (create_booking pasa `p_utm` entero ahi), asi que `create_booking` NO se toca.",
    to: "    -- La URL de entrada completa. Puede venir como `entry_url` o, desde la Agenda,\n    -- dentro de `raw.utm` (create_booking pasa `p_utm` entero ahi)." },
  { from: "  -- La URL tiene que ser la publica de produccion. Una local no falla: los",
    to: "  -- La URL tiene que ser la publica de la app. Una local no falla: los" },
  { from: "  -- 2) Referido (lo deja el selector de la venta)", to: "  -- 2) Referido" },
  { from: "    -- Facebook solo busca cuando el que llama lo pide (un canal de Facebook): sus ids no son\n    -- confiables para formularios, que nunca lo mandan como parte de la identidad.",
    to: "    -- Facebook solo busca cuando el que llama lo pide (un canal de Facebook): sus ids no son\n    -- confiables como dato de identidad suelto." },
  { from: "  -- eventos assignment_changed de mas (contacts_automation_changes, 00039).",
    to: "  -- eventos assignment_changed de mas (contacts_automation_changes)." },
  { from: "    -- verify-rls, que es justo para lo que esta).", to: "    -- verify-rls, que es justo para lo que esta)." },
];

// Comentarios de la base (COMMENT ON) que se reescriben enteros. Clave: el objeto como
// lo nombra describeComment(); valor: el texto nuevo.
export const COMMENT_REWRITES = {
  "column public.agent_drafts.window_missed_at":
    "Cuando la ventana cerro con el borrador todavia sin enviar. El borrador pasa a expired en el mismo momento.",
  "column public.audit_log.actor_type":
    "Quien hizo la accion: user (una persona), agent (agente de IA), system (proceso interno) o webhook (un proveedor). Para leerlo, usar effectiveActorType().",
  "column public.automation_events.source_type":
    "Que origino el evento. Un evento sin contacto lo exige: la base lo completa para contacto y persona.",
  "column public.agents.max_replies_per_conversation":
    "Tope de respuestas del agente por conversacion desde la ultima intervencion humana. NULL = sin tope (el default). El guardarrail solo actua con un numero cargado.",
  "column public.channels.provider":
    "De donde sale la conexion: zernio (Instagram, Facebook, ...) o evolution (WhatsApp por Baileys).",
  "column public.contacts.ai_conversation_summary":
    "Memoria acumulativa del agente de IA: el resumen de las conversaciones con este contacto.",
  "column public.contacts.ai_summary_updated_at":
    "Cuando se actualizo por ultima vez ai_conversation_summary (la memoria del agente). NULL si todavia no hay memoria.",
  "column public.contacts.assignment_locked_at":
    "Se escribe cuando alguien asigna a mano setter o vendedor: desde ahi la asignacion automatica no toca a este contacto.",
  "column public.contacts.avatar_source":
    "De donde sale avatar_url. external: la URL cruda del proveedor (vence, se puede refrescar con el proximo mensaje). storage: ya se copio a nuestro bucket avatars (se refresca cada 30 dias desde TypeScript). manual: alguien la cargo a mano (nunca se pisa).",
  "column public.contacts.avatar_updated_at":
    "Cuando se actualizo avatar_url por ultima vez. Decide si refrescar una foto storage (cada 30 dias) y la retencion (borra la de un contacto storage sin mensajes en 6 meses).",
  "column public.contacts.is_known":
    "Conocido: alguien personal. Apaga el agente, pausa secuencias y sus chats van a la persona de cada cuenta (workspaces.known_contacts_settings).",
  "column public.contacts.next_followup_date": "Proximo seguimiento. Se carga a mano o lo programa el agente.",
  "column public.contacts.notes":
    "Notas internas del contacto, en un solo texto. Quien cambio que queda en audit_log.",
  "column public.contacts.setter_id":
    "Quien contacta y califica. Junto con vendedor_id define el alcance de leads de un Member.",
  "column public.content_ideas.content": "El texto unico de la idea.",
  "column public.content_ideas.source": "manual: la escribio una persona. agent: la propuso un agente.",
  "column public.content_post_versions.updated_at":
    "Cuando se toco por ultima vez esta fila. Con reason=edit y menos de 10 minutos, el proximo cambio del mismo autor actualiza esta misma version en vez de crear otra.",
  "column public.content_posts.recording_notes": "Instrucciones para grabar la pieza.",
  "column public.content_posts.script": "El guion completo para grabar.",
  "column public.conversations.agent_disabled_by_known":
    "El agente lo apago la marca de conocido. Se limpia sola si una persona cambia el estado del agente.",
  "column public.conversations.agent_disabled_by_tag_id":
    "La etiqueta que apago el agente aca. Se limpia sola si una persona cambia el estado del agente.",
  "column public.conversations.awaiting_last_inbound_at":
    "Ultimo mensaje del lead sin responder: de aca corre la ventana de mensajeria. Lo mantiene el trigger de messages.",
  "column public.conversations.awaiting_reply_since":
    "Primer mensaje del lead sin responder. NULL = el ultimo mensaje que importa es nuestro. Lo mantiene el trigger de messages.",
  "column public.conversations.last_message_direction":
    "Si el ultimo mensaje de la conversacion fue del contacto (inbound) o nuestro (outbound). Lo mantiene el trigger messages_zz_last_message.",
  "column public.conversations.no_reply_needed_reason":
    "Quien lo decidio: rule (regla de cierre), agent (el agente) o manual (una persona).",
  "column public.email_log.contact_id":
    "El contacto al que se refiere el email (el que lo recibe, o sobre quien trata un aviso al equipo). NULL en los emails del sistema.",
  "column public.event_types.booking_fields":
    "Formulario de reserva, validado con Zod: [{id, type, system, label, visibility, options?, identifier, ...}].",
  "column public.event_types.unavailable_messages": "Que ve el invitado cuando no puede agendar. null = textos por defecto.",
  "column public.flows.event_type_id": "El evento de agenda al que pertenece este flujo. null = flujo general.",
  "column public.flows.template_key": "Cual de las 7 plantillas precreadas es: confirmation, reminder_24h, ...",
  "column public.knowledge_base.internal_only":
    "Uso interno: nunca llega al prompt de un agente, tenga el tag que tenga. El filtro va dentro de match_knowledge_chunks_filtered.",
  "column public.knowledge_chunks.embedding":
    "Embedding de Voyage AI voyage-4-lite, 1024 dimensiones (su default). Cambiar la dimension obliga a reindexar todo.",
  "column public.messages.media_description":
    "Descripcion de la imagen generada por el modelo de vision. Es lo que lee el agente cuando el lead manda una captura sin texto.",
  "column public.messages.origin":
    "De donde salio el saliente: agent, user, flow, sequence, broadcast o external. null en entrantes. Lo escribe cada camino de envio; el trigger messages_fill_origin lo deriva si falta.",
  "column public.messages.send_error":
    "Por que no salio un envio (status failed), en castellano. El texto queda con lo que se quiso mandar.",
  "column public.messages.sent_by_agent_id": "Que agente de IA mando este mensaje.",
  "column public.product_variants.event_date":
    "La fecha fija de un evento. Null en los demas tipos: su duracion empieza el dia que compra cada cliente.",
  "column public.product_variants.price":
    "Precio de la variante, siempre en USD. 0 = sin precio. Cada cambio queda en audit_log.",
  "column public.response_assets.usage_count": "Cuantas veces se mando. Lo suma touch_response_asset.",
  "column public.sequence_enrollments.paused_reason":
    "contact_replied = el lead contesto | opt_out = pidio no ser contactado | sequence_paused = se pauso la secuencia | no_conversation = no hay hilo abierto por donde escribir | collision = un admin la freno por colision. Solo las tres primeras y collision se reanudan.",
  "column public.sequence_enrollments.status":
    "active = corriendo | paused = frenada porque el contacto pidio no ser contactado; no se reanuda sola, ni siquiera al sacar la marca | completed = termino | cancelled = la secuencia dejo de estar activa.",
  "column public.sequences.status":
    "draft = todavia no corre | active = inscribe y manda | paused = frenada; sus inscripciones se pausan, no se cancelan.",
  "column public.social_posts.origin":
    "system: la publico el sistema. external: la trajo la sincronizacion. manual: la subio una persona por fuera de la app y la marco como publicada.",
  "column public.social_posts.publish_progress":
    "Que pasos de la publicacion ya salieron, para que un reintento no los repita. Lo escribe solo el publicador.",
  "column public.tags.assigns_to":
    "Etiqueta con efecto: al ponerla, setter y vendedor del contacto pasan a esta persona.",
  "column public.tags.disables_agent":
    "Etiqueta con efecto: el agente queda forzado apagado en las conversaciones del contacto.",
  "column public.workspace_members.role_id":
    "El rol con los permisos finos. `role` sigue siendo owner/admin/member y es lo que leen varias politicas.",
  "column public.workspaces.brand_name":
    "Nombre del negocio que ven los leads (agenda, emails). NULL = el de la instalacion (NEXT_PUBLIC_BRAND_NAME).",
  "column public.workspaces.known_contacts_settings":
    'A quien van los chats de un conocido: {"by_channel": {"<channel_id>": "<user_id>"}, "default_user_id": "<user_id>"}. Sin nada, al Owner.',
  "column public.workspaces.opt_out_phrases":
    'Frases que marcan un contacto como "no contactar" cuando aparecen en un mensaje entrante. Se editan desde Ajustes. Se comparan por palabra completa, sin acentos ni mayusculas.',
  "column public.workspaces.scheduling_auto_create_flows": "Crear los 7 flujos sugeridos (apagados) al crear un evento.",
  "column public.workspaces.scheduling_public_base_url":
    "Dominio propio de las paginas publicas de agenda. null = NEXT_PUBLIC_APP_URL.",
  "column public.workspaces.timezone":
    "Zona horaria IANA del negocio. Los dashboards cortan dias y semanas con esta zona. Default UTC.",
  "column public.contact_touches.entry_url":
    "La URL de entrada completa de la visita (con todos sus parametros, sin sensibles ni fragmento). La escribe record_contact_touch. Puede traer datos de la persona: nunca se loguea.",
  "function public.approve_content_idea_v2":
    "Crea la pieza y marca la idea aprobada en una sola transaccion, heredando clasificacion y plataformas. SECURITY INVOKER: la RLS decide si puede.",
  "function public.assign_new_conversation":
    "Aplica conversation_assignment_rules a una conversacion recien creada. Solo service_role. Nunca pisa un responsable que ya tiene.",
  "function public.can_see_contact":
    'Se ve un contacto si es del workspace y: sos Admin, o tu rol tiene alcance leads=all, o es tuyo (setter, vendedor o conversacion asignada), o tu rol tiene leads=own_unassigned y nadie lo tiene asignado, o tiene una conversacion que ves por su cuenta con "todas" o con "asignadas + sin asignar" y nadie lo tiene.',
  "function public.can_see_conversation":
    "Se ve la conversacion si sos Admin, o si tu rol tiene acceso a esa CUENTA (permissions.channels): todas, las asignadas (setter, vendedor o conversacion a cargo) o las asignadas + las que nadie tiene.",
  "function public.can_see_notification":
    "Alcance de leads aplicado a las notificaciones. Owner/Admin ven todo el workspace; un Member ve las suyas y las que apuntan a un lead que le corresponde. Delega en can_see_conversation / can_see_contact.",
  "function public.catalog_audit":
    "Escribe el historial (audit_log) de products y product_variants: alta, estado, precio, archivado y el resto de los campos.",
  "function public.claim_agent_reply":
    "Bajo un advisory lock por conversación: true si ya hay un saliente posterior al inbound del turno que no es el propio run.",
  "function public.conversation_people":
    "Responsable del chat + setter + vendedor del contacto. Lo usa el filtro de asignacion de la bandeja.",
  "function public.find_or_link_contact":
    "Dedup cross-canal. Solo service_role: no valida permisos, solo deriva el workspace del canal. Las rutas que la usan validan el rol antes y llaman con service client (lib/inbox-sync.ts). El avatar_url de un contacto external se refresca con cada mensaje; storage y manual no se pisan nunca (avatar_source).",
  "function public.match_knowledge_chunks":
    "Busqueda semantica sobre la base de conocimiento. Recibe el embedding de la consulta (Voyage voyage-4-lite, 1024 dim, input_type=query) y devuelve los fragmentos mas parecidos.",
  "function public.normalize_for_grouping":
    "Normaliza para AGRUPAR mensajes por lo que significan (colapsa letras repetidas: siii=si). Distinta de normalize_message_text, que detecta frases de no contactar. Espejo exacto de lib/text/normalize.ts.",
  "function public.pause_sequences_on_reply":
    "Pausa las secuencias activas del contacto en ESE canal cuando responde. La llaman los dos receptores de webhook con service role.",
  "function private.alert_draft_windows":
    "Avisos de ventana de los borradores: agregados por persona y corte (mitad, cuarto, octavo de la ventana del canal), idempotentes por agent_drafts.alerted_thresholds, solo para borradores creados despues de draft_alerts_since (private.system_config). Los sin asignar van a Owner/Admin.",
  "function private.refresh_conversation_awaiting":
    "Recalcula awaiting_*, reply_window_until y la marca de la regla de cierre de una conversacion a partir de sus mensajes.",
  "function private.sweep_agent_drafts":
    "Barrido de borradores cada 5 minutos: envios colgados pasan a failed, y un borrador cuya ventana cerro sin enviarse pasa a expired (con window_missed_at y missed_while_assigned_to).",
  "function public.chat_response_turns":
    "Cada espera del lead (tanda de mensajes seguidos) con quien la cerro y cuanto tardo, desde el primer mensaje sin responder. Base del tiempo de respuesta.",
  "function public.chat_waiting_now_v2":
    "Esperando respuesta ahora, en tres: se puede responder desde el sistema, la ventana ya cerro, y no necesita respuesta. Lee las columnas que mantiene el trigger de messages.",
  "function public.purge_old_messages":
    'Borra los mensajes de mas de N meses (default 12). No distingue canal ni contacto: un mensaje de un contacto "no contactar" vence igual que cualquier otro, y los de un contacto borrado ya se van por cascade con purge_soft_deleted. La llama el cron diario.',
  "function public.purge_zernio_inbound_messages":
    "Borra TODOS los mensajes entrantes ya guardados de los canales de Zernio, para cuando haya que deshacer su guardado. No toca los salientes ni WhatsApp. Con p_apply en false solo cuenta. No la llama ningun cron: se corre a mano con scripts/purge-zernio-inbound.mjs.",
  "function public.push_debounced_job(text, text, jsonb, timestamp with time zone, timestamp with time zone)":
    "Version de cinco parametros: delega en la de seis sin claves volatiles. Solo service role.",
  "function public.read_secret":
    "Devuelve el valor desencriptado de un secret del workspace. Solo service_role: el servidor lee con createServiceClient(); ningun usuario, tampoco el Owner, puede leer una clave desde el navegador.",
  "function public.record_whatsapp_call":
    "Registra un evento CALL de Evolution. Atomica; devuelve si la llamada recien quedo sin atender. Solo service_role.",
  "table public.agent_drafts":
    "Respuestas del agente que esperan aprobacion humana (modo borrador). No son mensajes: nada de aca se envia ni cuenta como salida hasta que una persona lo aprueba.",
  "table public.agent_runs":
    "Una fila por llamada a IA del sistema (source). Para el agente, un run = un turno. Solo la escribe el service role. Las columnas de tokens y costo solo son legibles por Owner/Admin via servidor (privilegio de columna).",
  "table public.contact_notes":
    "Notas sueltas de un contacto, aparte de contacts.notes (el texto de la ficha). Las lee la herramienta del agente que consulta el CRM (campo notes); la fusion de contactos las mueve y purge_soft_deleted purga las borradas.",
  "table public.contact_touches": "Cada interaccion atribuible de un contacto. Solo la escribe el servidor.",
  "table public.conversation_assignment_rules":
    "Reglas de asignacion de conversaciones nuevas por cuenta conectada. Gana la primera activa que coincide (position). Escribe solo el servidor.",
  "table public.csv_imports":
    "Una fila por importacion de CSV: contadores, detalle de los errores y quien la corrio. Sin soft delete, como el audit log.",
  "table public.event_types":
    "Los tipos de llamada que se pueden agendar. El anfitrion es owner_user_id.",
  "table public.knowledge_base":
    'Documentos de la base de conocimiento. El archivo original vive en el bucket privado "knowledge"; content_md es su conversion a markdown. Soft delete con deleted_at (retencion 30 dias, purga por cron).',
  "table public.messages":
    "Mensajes de todos los canales, entrantes y salientes. SELECT e INSERT exigen ver la conversacion (de ahi sale el alcance de leads) ademas de ser miembro del workspace. UPDATE y DELETE no tienen policy a proposito: solo el service role escribe estados y solo la purga borra.",
  "table public.meta_ads": "Catalogo de anuncios de Meta. Los escribe el sync con el service role.",
  "table public.meta_adsets": "Catalogo de conjuntos de anuncios de Meta. Los escribe el sync con el service role.",
  "table public.meta_campaigns": "Catalogo de campañas de Meta. Las escribe el sync con el service role.",
  "table public.notifications":
    "Centro de notificaciones in-app. Las escribe solo el service role. Un Member ve las de sus leads; Owner/Admin, las del workspace.",
  "table public.product_variants":
    "Como se vende un producto: duracion, facturacion y PRECIO. El historial de cambios vive en audit_log.",
  "table public.provider_media":
    "Que archivo de content-media corresponde a que URL del proveedor, para no subirlo dos veces.",
  "table public.social_account_metrics_daily":
    "Seguidores y alcance de una cuenta, por dia. Es la base del grafico de crecimiento y del salto de seguidores por post.",
  "table public.stickers":
    "Biblioteca de stickers de WhatsApp: los mandados se agregan solos, los recibidos se guardan con un boton, y se pueden subir. Archivo en chat-media/<ws>/stickers/<sha>.webp.",
};

// Texto de la descripcion de private.system_config, por clave.
export const SYSTEM_CONFIG_REWRITES = {
  draft_alerts_since:
    "Los avisos de ventana de los borradores ignoran los creados antes de esto, para que la primera corrida no avise por el historial.",
};

// Limpia un texto de comentario. Devuelve el texto nuevo (puede ser "").
export function cleanComment(text) {
  let t = text;
  for (const r of RULES) t = t.replace(r.re, r.to);
  return t;
}

// Limpia el cuerpo de una funcion: solo los comentarios.
export function cleanBody(body) {
  // 1. Reescrituras puntuales sobre el cuerpo entero, pero solo si el texto a cambiar
  //    cae entero dentro de comentarios (se comprueba con el lexer).
  let src = body;
  for (const rw of REWRITES) {
    let at = src.indexOf(rw.from);
    while (at !== -1) {
      if (!insideComments(src, at, rw.from.length)) {
        throw new Error(`La reescritura "${rw.from.slice(0, 60)}..." cae fuera de un comentario`);
      }
      src = src.slice(0, at) + rw.to + src.slice(at + rw.from.length);
      at = src.indexOf(rw.from, at + rw.to.length);
    }
  }
  // 2. Reglas generales, comentario por comentario.
  const toks = lexSql(src);
  let out = "";
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.type === "line_comment") {
      const content = t.text.slice(2);
      const cleaned = cleanComment(content);
      if (cleaned.trim() === "") {
        // Comentario vacio: si ocupa la linea entera, se borra la linea.
        const lineStart = out.lastIndexOf("\n") + 1;
        if (out.slice(lineStart).trim() === "") {
          out = out.slice(0, lineStart);
          // Saltear el salto de linea que sigue.
          const next = toks[k + 1];
          if (next && next.type === "code" && next.text.startsWith("\n")) next.text = next.text.slice(1);
        } else {
          out = out.replace(/[ \t]+$/, "");
        }
      } else {
        out += "--" + cleaned;
      }
    } else if (t.type === "block_comment") {
      out += "/*" + cleanComment(t.text.slice(2, -2)) + "*/";
    } else {
      out += t.text;
    }
  }
  return out;
}

function insideComments(src, at, len) {
  let pos = 0;
  for (const t of lexSql(src)) {
    const start = pos;
    const end = pos + t.text.length;
    pos = end;
    if (end <= at || start >= at + len) continue;
    // La pieza toca el tramo: tiene que ser un comentario, o codigo que sea solo espacio
    // (el sangrado entre dos lineas de comentario).
    if (t.type === "line_comment" || t.type === "block_comment") continue;
    if (t.type === "code") {
      const a = Math.max(at, start) - start;
      const b = Math.min(at + len, end) - start;
      if (t.text.slice(a, b).trim() === "") continue;
    }
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Lo que corre cuando se llama al script.
// ---------------------------------------------------------------------------
const COMMENTS_SQL = `
  select 'table ' || n.nspname || '.' || c.relname as key,
         case c.relkind when 'i' then 'INDEX' else 'TABLE' end as kind,
         quote_ident(n.nspname) || '.' || quote_ident(c.relname) as target, d.description as text
    from pg_description d join pg_class c on c.oid = d.objoid and d.classoid = 'pg_class'::regclass and d.objsubid = 0
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('public', 'private')
  union all
  select 'column ' || n.nspname || '.' || c.relname || '.' || a.attname, 'COLUMN',
         quote_ident(n.nspname) || '.' || quote_ident(c.relname) || '.' || quote_ident(a.attname), d.description
    from pg_description d join pg_class c on c.oid = d.objoid and d.classoid = 'pg_class'::regclass and d.objsubid > 0
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum = d.objsubid
   where n.nspname in ('public', 'private')
  union all
  select 'function ' || n.nspname || '.' || p.proname || '(' || oidvectortypes(p.proargtypes) || ')', 'FUNCTION',
         quote_ident(n.nspname) || '.' || quote_ident(p.proname) || '(' || pg_get_function_identity_arguments(p.oid) || ')', d.description
    from pg_description d join pg_proc p on p.oid = d.objoid and d.classoid = 'pg_proc'::regclass
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private')`;

const lit = (s) => "'" + String(s).replace(/'/g, "''") + "'";

async function main() {
  const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const dry = process.argv.includes("--dry-run");
  const dbUrl = arg("db-url") ?? "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  // Con search_path vacio, pg_get_functiondef y compania nombran todo con su esquema.
  await client.query("set search_path = ''");
  let changedFns = 0;
  let changedComments = 0;
  const leftovers = [];
  try {
    await client.query("begin");
    // 1. Cuerpos de funciones.
    const { rows: fns } = await client.query(`
      select p.oid, n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as key,
             pg_get_functiondef(p.oid) as def, p.prosrc
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'private') and p.prosqlbody is null
         and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
       order by 2`);
    for (const f of fns) {
      const cleaned = cleanBody(f.prosrc);
      for (const t of lexSql(cleaned)) {
        if (t.type === "line_comment" || t.type === "block_comment") {
          for (const h of findHistory(t.text)) leftovers.push(`funcion ${f.key}: [${h.rule}] ${h.snippet}`);
        }
      }
      if (cleaned === f.prosrc) continue;
      changedFns++;
      const first = f.def.indexOf(f.prosrc);
      if (first === -1 || f.def.indexOf(f.prosrc, first + 1) !== -1) throw new Error(`No se ubica el cuerpo de ${f.key}`);
      const newDef = f.def.slice(0, first) + cleaned + f.def.slice(first + f.prosrc.length);
      if (dry) {
        console.log(`\n=== ${f.key}`);
        printDiff(f.prosrc, cleaned);
      } else {
        await client.query(newDef);
      }
    }
    // 2. COMMENT ON.
    const { rows: comments } = await client.query(COMMENTS_SQL);
    for (const c of comments) {
      const rw = COMMENT_REWRITES[c.key] ?? COMMENT_REWRITES[c.key.replace(/\(.*\)$/, "")];
      let text = rw ?? cleanComment(c.text);
      text = text.replace(/[ \t]+$/g, "");
      for (const h of findHistory(text)) leftovers.push(`comentario ${c.key}: [${h.rule}] ${h.snippet}`);
      if (text === c.text) continue;
      changedComments++;
      if (dry) console.log(`\n=== ${c.key}\n- ${c.text}\n+ ${text}`);
      else await client.query(`COMMENT ON ${c.kind} ${c.target} IS ${lit(text)}`);
    }
    const unknown = Object.keys(COMMENT_REWRITES).filter((k) => !comments.some((c) => c.key === k || c.key.replace(/\(.*\)$/, "") === k));
    if (unknown.length) throw new Error(`Reescrituras de comentarios sin objeto: ${unknown.join(", ")}`);
    // 3. private.system_config.
    const { rows: cfg } = await client.query("select key, description from private.system_config order by key");
    for (const r of cfg) {
      const text = SYSTEM_CONFIG_REWRITES[r.key] ?? cleanComment(r.description ?? "");
      for (const h of findHistory(text)) leftovers.push(`system_config ${r.key}: [${h.rule}] ${h.snippet}`);
      if (text === r.description) continue;
      changedComments++;
      if (dry) console.log(`\n=== system_config ${r.key}\n- ${r.description}\n+ ${text}`);
      else await client.query("update private.system_config set description = $1 where key = $2", [text, r.key]);
    }
    await client.query(dry ? "rollback" : "commit");
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    await client.end();
  }
  console.log(`\n${dry ? "(simulacro) " : ""}Funciones limpiadas: ${changedFns}. Comentarios limpiados: ${changedComments}.`);
  if (leftovers.length) {
    console.log(`\nQuedan ${leftovers.length} textos con historia (sumar una regla o una reescritura):`);
    for (const l of leftovers) console.log("  " + l);
    process.exitCode = 1;
  }
}

function printDiff(a, b) {
  const al = a.split("\n");
  const bl = b.split("\n");
  const setB = new Set(bl);
  const setA = new Set(al);
  for (const l of al) if (!setB.has(l)) console.log(`- ${l}`);
  for (const l of bl) if (!setA.has(l)) console.log(`+ ${l}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
