// @plantilla-quitar(servicios)
/**
 * Las clases en vivo (Portal → Calendario) que da cada persona, para la capa «Clases» del calendario de la Agenda.
 *
 * Se lee con el cliente de SERVICIO, filtrando por el workspace de la sesión y por los anfitriones que se piden (quien
 * mira y, en la vista de equipo, las personas elegidas): la persona ve las clases que da, aunque no tenga permisos del
 * Portal. Nunca lanza: si algo falla, la Agenda se ve sin clases.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { svcRpc, svcSchema } from "@/lib/services/db";
import type { AgendaClass } from "@/lib/scheduling/calendar-classes";

interface Occ {
  live_session_id: string;
  occurs_on: string;
  starts_at: string;
  ends_at: string;
  status: "normal" | "cancelled" | "moved";
}

const addDays = (date: string, n: number) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

export async function loadAgendaClasses(
  service: SupabaseClient,
  input: { workspaceId: string; userIds: string[]; range: { from: string; to: string } },
): Promise<AgendaClass[]> {
  const userIds = [...new Set(input.userIds)].filter(Boolean);
  if (!userIds.length) return [];
  try {
    const { data: sessions, error } = await svcSchema(service)
      .from("live_sessions")
      .select("id, title, product_id, host_user_id, meeting_url")
      .eq("workspace_id", input.workspaceId)
      .in("host_user_id", userIds)
      .is("archived_at", null);
    if (error) throw error;
    const list = (sessions ?? []) as Array<{ id: string; title: string; product_id: string; host_user_id: string; meeting_url: string | null }>;
    if (!list.length) return [];
    const byId = new Map(list.map((s) => [s.id, s]));
    const productIds = [...new Set(list.map((s) => s.product_id))];
    const { data: products } = await service.from("products").select("id, name").eq("workspace_id", input.workspaceId).in("id", productIds);
    const productName = new Map(((products ?? []) as Array<{ id: string; name: string }>).map((p) => [p.id, p.name]));
    // Un día de margen a cada lado: el rango es el de quien mira y la fecha de la clase, la de su zona.
    const from = addDays(input.range.from, -1);
    const to = addDays(input.range.to, 1);
    const results = await Promise.all(productIds.map((p) => svcRpc<Occ[]>(service, "live_session_occurrences", { p_product_id: p, p_from: from, p_to: to })));
    const out: AgendaClass[] = [];
    for (const r of results) {
      if (!r.ok) continue;
      for (const o of r.data ?? []) {
        const s = byId.get(o.live_session_id);
        if (!s || o.status === "cancelled") continue;
        out.push({
          key: `${o.live_session_id}|${o.occurs_on}`,
          sessionId: o.live_session_id,
          occursOn: o.occurs_on,
          title: s.title,
          productTitle: productName.get(s.product_id) ?? null,
          hostUserId: s.host_user_id,
          startAt: o.starts_at,
          endAt: o.ends_at,
          meetingUrl: s.meeting_url,
          moved: o.status === "moved",
        });
      }
    }
    return out;
  } catch {
    console.error("[agenda] no se pudieron leer las clases");
    return [];
  }
}
