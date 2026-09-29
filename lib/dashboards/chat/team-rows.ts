/**
 * Las filas de "Quién responde".
 *
 * Lo que arregla: flows, secuencias y broadcasts salian como TRES filas, las
 * tres con la etiqueta "Automatizaciones", y al tocar cualquiera se filtraba por
 * `author=flow`, un valor que `chat_author_match` no reconoce: el dashboard
 * quedaba en blanco. Ahora la funcion SQL ya devuelve una sola fila
 * `automations`, que es el valor que el filtro entiende, y esto solo la etiqueta.
 */

import { isAuthorFilterGroup } from "./types";

/** Una fila de `chat_dashboard_team`. */
export interface TeamSqlRow {
  author: string;
  conversations: number;
  messages_out: number;
  first_response_median_seconds: number | null;
  reply_median_seconds: number | null;
  replies_under_1h_pct: number | null;
  escalations_received: number | null;
  drafts_approved: number | null;
  drafts_approved_unedited_pct: number | null;
}

export interface TeamRow {
  /** El valor que va al filtro. Siempre uno que el SQL reconoce. */
  author: string;
  label: string;
  /** El rol o la explicacion, abajo del nombre. */
  sublabel: string;
  /** Iniciales para el avatar. */
  initials: string;
  color: string;
  isPerson: boolean;
  conversations: number;
  messagesOut: number;
  firstResponseMedianSeconds: number | null;
  replyMedianSeconds: number | null;
  repliesUnder1hPct: number | null;
  escalationsReceived: number | null;
  draftsApproved: number | null;
  draftsApprovedUneditedPct: number | null;
  /** Las automatizaciones responden en el acto: el tiempo no dice nada. */
  instant: boolean;
}

const GROUP_META: Record<string, { label: string; sublabel: string; initials: string; color: string }> = {
  agent: { label: "Agente IA", sublabel: "Envío directo y borradores aprobados", initials: "IA", color: "var(--c-agent)" },
  automations: { label: "Automatizaciones", sublabel: "Flows, secuencias y broadcasts", initials: "⚡", color: "var(--c-auto)" },
  external: { label: "Fuera del sistema", sublabel: "App de Instagram, ManyChat u otra herramienta", initials: "?", color: "var(--c-ext)" },
  user: { label: "Alguien del equipo", sublabel: "Sin identificar", initials: "?", color: "var(--c-team)" },
};

/** Iniciales de un nombre: dos letras como maximo. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Arma las filas con el nombre y el rol de cada persona.
 *
 * `members` viene vacio para un Member (no puede listar al equipo): su propia
 * fila se marca con "Vos" y las demas quedan como "Alguien del equipo".
 */
export function buildTeamRows(
  rows: TeamSqlRow[],
  members: Array<{ id: string; label: string; role: string }>,
  currentUserId?: string,
): TeamRow[] {
  const byId = new Map(members.map((m) => [m.id, m]));

  const built = rows.map((r): TeamRow => {
    const group = GROUP_META[r.author];
    const member = byId.get(r.author);
    const isPerson = !group || r.author === "user" ? !group : false;
    const isMe = currentUserId !== undefined && r.author === currentUserId;

    const label = group
      ? group.label
      : (member?.label ?? (isMe ? "Vos" : "Alguien del equipo"));
    const sublabel = group ? group.sublabel : (isMe && !member ? "Vos" : (member?.role ?? "Del equipo"));

    return {
      author: r.author,
      label: isMe && member ? `${member.label} (vos)` : label,
      sublabel,
      initials: group ? group.initials : initialsOf(member?.label ?? label),
      color: group ? group.color : "var(--c-team)",
      isPerson: !group,
      conversations: Number(r.conversations ?? 0),
      messagesOut: Number(r.messages_out ?? 0),
      firstResponseMedianSeconds: toNum(r.first_response_median_seconds),
      replyMedianSeconds: toNum(r.reply_median_seconds),
      repliesUnder1hPct: toNum(r.replies_under_1h_pct),
      escalationsReceived: toNum(r.escalations_received),
      draftsApproved: toNum(r.drafts_approved),
      draftsApprovedUneditedPct: toNum(r.drafts_approved_unedited_pct),
      instant: r.author === "automations",
    };
  });

  // El agente primero (es el que se mira), despues por mensajes enviados.
  return built.sort((a, b) => {
    if (a.author === "agent") return -1;
    if (b.author === "agent") return 1;
    return b.messagesOut - a.messagesOut || a.label.localeCompare(b.label, "es");
  });
}

function toNum(v: number | null | undefined): number | null {
  return v === null || v === undefined ? null : Number(v);
}

/**
 * El valor de filtro de una fila, o null si esa fila no se puede filtrar.
 *
 * Es la guarda contra el bug: cualquier valor que no sea un grupo conocido ni un
 * uuid no se manda a la URL, porque el SQL lo rechazaria y la pantalla quedaria
 * vacia sin explicacion.
 */
const UUID = /^[0-9a-f-]{36}$/i;

export function filterValueFor(row: TeamRow): string | null {
  if (isAuthorFilterGroup(row.author)) return row.author;
  if (UUID.test(row.author)) return row.author;
  return null;
}

/** El color y el icono del tiempo: mas de 1 h ambar, mas de 4 h rojo. */
export type TimeTone = "ok" | "warn" | "bad";

export function timeTone(seconds: number | null): TimeTone {
  if (seconds === null || !Number.isFinite(seconds)) return "ok";
  if (seconds >= 4 * 3600) return "bad";
  if (seconds >= 3600) return "warn";
  return "ok";
}
