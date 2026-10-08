import { getPermissionContext } from "@/lib/auth/guards";
import { getWorkspaceMembers } from "@/lib/workspace-members";
import { listCategories, listEventTypes, toCategoryRow } from "@/lib/scheduling/data/event-types";
import { eventDefaults } from "@/lib/scheduling/data/event-context";
import { publicBaseUrl } from "@/lib/scheduling/public-url";
import { EventsView, type EventCard } from "@/components/scheduling/events/events-view";

export const dynamic = "force-dynamic";

/** Configuracion de agenda > Eventos (F17). */
export default async function AgendaEventosPage({ searchParams }: { searchParams: Promise<{ persona?: string }> }) {
  const ctx = await getPermissionContext();
  const params = await searchParams;
  const canManageOthers = ctx.can("scheduling.manage_others");
  // Sin manage_others solo se ven los propios; con el permiso, "Todo el equipo".
  const targetUserId = canManageOthers ? (params.persona ?? null) : ctx.user.id;

  const [categories, events, defaults, members, profiles, googleRows] = await Promise.all([
    listCategories(ctx.supabase, ctx.workspace.id),
    listEventTypes(ctx.supabase, ctx.workspace.id, { ownerUserId: targetUserId }),
    // Creando para otra persona (manage_others), el diálogo tiene que mostrar
    // SU horario, SU calendario y SU usuario por defecto, no los de quien
    // está mirando. Con "Todo el equipo" (targetUserId null) cae en uno mismo.
    eventDefaults(ctx.supabase, ctx.workspace as { id: string; scheduling_auto_create_flows?: boolean }, targetUserId ?? ctx.user.id),
    canManageOthers ? getWorkspaceMembers(ctx.workspace.id) : Promise.resolve([]),
    ctx.supabase.from("scheduling_profiles").select("user_id, username, display_name").eq("workspace_id", ctx.workspace.id),
    canManageOthers
      ? ctx.supabase.from("oauth_connections").select("user_id").eq("workspace_id", ctx.workspace.id).eq("provider", "google_calendar").eq("status", "active")
      : Promise.resolve({ data: [] }),
  ]);

  const byUser = new Map((profiles.data ?? []).map((p) => [p.user_id, p]));
  const memberLabel = new Map(members.map((m) => [m.userId, m.name || m.email]));
  const hasGoogleByUser = new Set((googleRows.data ?? []).map((c) => c.user_id));

  const cards: EventCard[] = events.map((e) => ({
    id: e.id,
    title: e.title,
    slug: e.slug,
    categoryId: e.category_id,
    durationMinutes: e.duration_minutes,
    color: e.color,
    locationType: e.location_type,
    status: e.status,
    ownerUserId: e.owner_user_id,
    ownerLabel: byUser.get(e.owner_user_id)?.display_name ?? memberLabel.get(e.owner_user_id) ?? "Anfitrión",
    ownerUsername: byUser.get(e.owner_user_id)?.username ?? null,
  }));

  return (
    <EventsView
      events={cards}
      categories={categories.map(toCategoryRow)}
      publicBase={`${publicBaseUrl(ctx.workspace as { scheduling_public_base_url?: string | null })}/calendario/`}
      canCreate={ctx.can("scheduling.use")}
      hasProfile={defaults.hasProfile}
      hasCalendar={defaults.hasCalendar}
      username={defaults.username ?? ""}
      defaults={defaults}
      members={members.map((m) => ({ userId: m.userId, label: m.name || m.email, hasGoogle: hasGoogleByUser.has(m.userId) }))}
      targetUserId={targetUserId}
      canManageOthers={canManageOthers}
    />
  );
}
