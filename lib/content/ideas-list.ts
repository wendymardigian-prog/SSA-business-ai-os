import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { STATUS_LABELS } from "./status";

/**
 * Contenido › Ideas: todas las ideas del banco con su estado, la pieza que salió de cada una y de dónde salió (la
 * grabación, un agente o una persona). Traído de RER (B-IA-31).
 *
 *  - Por defecto, las aprobadas; se puede ver las nuevas (esperan que alguien las apruebe en el tablero), las
 *    descartadas o todas.
 *  - Lo que proponen las grabaciones llega como idea «nueva» solo después de que una persona aprueba la propuesta
 *    en la reunión. Las propuestas que todavía esperan se listan aparte, arriba (`lib/calls/content-proposals-load.ts`).
 *  - Se lee con la sesión: la RLS de `content_ideas`, `content_posts` y `calls` decide qué ve cada persona. Una
 *    grabación que quien mira no puede ver se nombra sin título ni link.
 */

export const IDEA_FILTERS = ["aprobada", "nueva", "descartada", "todas"] as const;
export type IdeaFilter = (typeof IDEA_FILTERS)[number];

export const IDEA_FILTER_LABELS: Record<IdeaFilter, string> = {
  aprobada: "Aprobadas",
  nueva: "Nuevas",
  descartada: "Descartadas",
  todas: "Todas",
};

export const IDEA_STATUS_LABELS: Record<string, string> = {
  nueva: "Nueva",
  aprobada: "Aprobada",
  descartada: "Descartada",
};

export type IdeaTone = "green" | "yellow" | "red";
export const IDEA_STATUS_TONE: Record<string, IdeaTone> = {
  aprobada: "green",
  nueva: "yellow",
  descartada: "red",
};

export function parseIdeaFilter(raw: string | undefined | null): IdeaFilter {
  return (IDEA_FILTERS as readonly string[]).includes(raw ?? "") ? (raw as IdeaFilter) : "aprobada";
}

type CallEmbed = { id: string; title: string | null; recorded_at: string | null };

export interface IdeaSourceRow {
  id: string;
  title: string;
  status: string;
  source: string;
  call_id?: string | null;
  discarded_reason: string | null;
  approved_at: string | null;
  created_at: string;
  calls?: CallEmbed | CallEmbed[] | null;
}

export interface IdeaPostRow {
  id: string;
  idea_id: string | null;
  title: string;
  status: string;
}

export type IdeaOrigin =
  | { kind: "call"; callId: string; label: string; recordedAt: string | null; visible: boolean }
  | { kind: "agent" | "manual"; label: string };

export interface IdeaListRow {
  id: string;
  title: string;
  status: string;
  statusLabel: string;
  tone: IdeaTone;
  /** Las piezas que salieron de la idea, con su estado. Vacío si todavía no hay ninguna. */
  pieces: Array<{ id: string; title: string; statusLabel: string }>;
  origin: IdeaOrigin;
  discardedReason: string | null;
  /** Cuándo se aprobó (o se creó, si todavía no). */
  date: string;
}

export function ideaListRow(idea: IdeaSourceRow, posts: readonly IdeaPostRow[]): IdeaListRow {
  const call = Array.isArray(idea.calls) ? (idea.calls[0] ?? null) : (idea.calls ?? null);
  const origin: IdeaOrigin = idea.call_id
    ? {
        kind: "call",
        callId: idea.call_id,
        // Sin acceso a la grabación (o borrada), se dice que salió de una, sin su título.
        label: call?.title?.trim() || "Una grabación",
        recordedAt: call?.recorded_at ?? null,
        visible: Boolean(call),
      }
    : idea.source === "call"
      ? { kind: "manual", label: "Una grabación borrada" }
      : idea.source === "agent"
        ? { kind: "agent", label: "Un agente de IA" }
        : { kind: "manual", label: "Una persona" };
  return {
    id: idea.id,
    title: idea.title,
    status: idea.status,
    statusLabel: IDEA_STATUS_LABELS[idea.status] ?? idea.status,
    tone: IDEA_STATUS_TONE[idea.status] ?? "yellow",
    pieces: posts
      .filter((p) => p.idea_id === idea.id)
      .map((p) => ({ id: p.id, title: p.title, statusLabel: STATUS_LABELS[p.status as keyof typeof STATUS_LABELS] ?? p.status })),
    origin,
    discardedReason: idea.discarded_reason,
    date: idea.approved_at ?? idea.created_at,
  };
}

export type IdeaSortKey = "title" | "status" | "date";

/** Lo que espera una decisión primero, después lo aprobado, al final lo descartado. */
const STATUS_RANK: Record<string, number> = { nueva: 0, aprobada: 1, descartada: 2 };

/** El orden de la tabla. Empates por fecha más reciente y, al final, por id (el orden no salta entre cargas). */
export function sortIdeaRows(rows: readonly IdeaListRow[], key: IdeaSortKey, dir: "asc" | "desc"): IdeaListRow[] {
  const sign = dir === "asc" ? 1 : -1;
  const byDateDesc = (a: IdeaListRow, b: IdeaListRow) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id.localeCompare(b.id));
  return [...rows].sort((a, b) => {
    let c = 0;
    if (key === "title") c = a.title.localeCompare(b.title, "es", { sensitivity: "base" });
    else if (key === "status") c = (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9);
    else c = a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
    return c !== 0 ? c * sign : byDateDesc(a, b);
  });
}

export interface IdeasListData {
  rows: IdeaListRow[];
  counts: Record<IdeaFilter, number>;
  error: string | null;
}

const PAGE_SIZE = 200;

// @plantilla-desde(llamadas)
const IDEA_COLUMNS = "id, title, status, source, call_id, discarded_reason, approved_at, created_at, calls(id, title, recorded_at)";
// @plantilla-hasta(llamadas)
// @plantilla-sin(llamadas): const IDEA_COLUMNS = "id, title, status, source, discarded_reason, approved_at, created_at";

/** Con el cliente de la persona: la RLS decide qué ve. */
export async function loadIdeasList(supabase: SupabaseClient<Database>, workspaceId: string, filter: IdeaFilter): Promise<IdeasListData> {
  let query = supabase
    .from("content_ideas")
    .select(IDEA_COLUMNS)
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .order(filter === "aprobada" ? "approved_at" : "created_at", { ascending: false, nullsFirst: false })
    .limit(PAGE_SIZE);
  if (filter !== "todas") query = query.eq("status", filter);

  const [ideasRes, countsRes] = await Promise.all([
    query,
    supabase.from("content_ideas").select("status").eq("workspace_id", workspaceId).is("deleted_at", null),
  ]);
  const counts: Record<IdeaFilter, number> = { aprobada: 0, nueva: 0, descartada: 0, todas: 0 };
  for (const r of (countsRes.data ?? []) as Array<{ status: string }>) {
    counts.todas++;
    if (r.status in counts) counts[r.status as IdeaFilter]++;
  }
  if (ideasRes.error) {
    console.error("[ideas] no pude leer las ideas:", ideasRes.error.message);
    return { rows: [], counts, error: "No pudimos cargar las ideas. Recargá la página en un momento." };
  }
  const ideas = (ideasRes.data ?? []) as unknown as IdeaSourceRow[];
  const ids = ideas.map((i) => i.id);
  let posts: IdeaPostRow[] = [];
  if (ids.length > 0) {
    const { data, error } = await supabase.from("content_posts").select("id, idea_id, title, status").eq("workspace_id", workspaceId).in("idea_id", ids);
    if (error) console.error("[ideas] no pude leer las piezas de las ideas:", error.message);
    posts = (data ?? []) as IdeaPostRow[];
  }
  return { rows: ideas.map((i) => ideaListRow(i, posts)), counts, error: null };
}
