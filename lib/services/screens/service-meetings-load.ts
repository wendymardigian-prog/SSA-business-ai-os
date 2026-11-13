// @plantilla-quitar(servicios)
/**
 * Lee lo que necesita el bloque «Reuniones» de la ficha del servicio (Servicios A4, F137). Solo servidor.
 *
 * Las grabaciones y las agendas se leen con la SESIÓN de quien mira (la RLS de `calls` y `bookings` decide qué ve);
 * las categorías (área y tipo) no tienen datos de nadie. La regla de qué entra y en qué estado vive en
 * `service-meetings.ts`.
 */
import { serviceMeetings, type MeetingBooking, type MeetingCall, type MeetingRow } from "./service-meetings";

type AnyDb = { from: (t: string) => unknown };
type Q = {
  select: (c: string) => Q;
  eq: (k: string, v: unknown) => Q;
  in: (k: string, v: unknown[]) => Q;
  gte: (k: string, v: unknown) => Q;
  is: (k: string, v: null) => Q;
  order: (k: string, o: { ascending: boolean }) => Q;
  limit: (n: number) => Promise<{ data: unknown; error: { message: string } | null }>;
};

export async function loadServiceMeetings(
  db: AnyDb,
  input: { workspaceId: string; serviceId: string; contactId: string; createdAt: string; endsOn: string | null; itemIds: string[]; now?: Date },
): Promise<MeetingRow[]> {
  const from = (t: string) => db.from(t) as unknown as Q;
  const [callsRes, bookingsRes, catsRes] = await Promise.all([
    from("calls")
      .select("id, booking_id, recorded_at, title, recorded_by_user_id, category_snapshot, no_show, analysis_status, closer_score, service_link, proposals")
      .eq("workspace_id", input.workspaceId)
      .eq("service_id", input.serviceId)
      .is("archived_at", null)
      .order("recorded_at", { ascending: false })
      .limit(100),
    from("bookings")
      .select("id, start_at, end_at, status, title, host_user_id, category_id, utm")
      .eq("workspace_id", input.workspaceId)
      .eq("contact_id", input.contactId)
      .order("start_at", { ascending: false })
      .limit(200),
    from("booking_categories").select("id, parent_id, name, system_key").eq("workspace_id", input.workspaceId).limit(500),
  ]);
  const cats = ((catsRes.data ?? []) as Array<{ id: string; parent_id: string | null; name: string; system_key: string | null }>);
  const catById = new Map(cats.map((c) => [c.id, c]));
  const keysOf = (id: string | null) => {
    const c = id ? catById.get(id) : undefined;
    if (!c) return { areaKey: null, typeKey: null, label: null };
    if (c.parent_id) return { areaKey: catById.get(c.parent_id)?.system_key ?? null, typeKey: c.system_key, label: c.name };
    return { areaKey: c.system_key, typeKey: null, label: c.name };
  };
  const items = new Set(input.itemIds);
  const bookings: MeetingBooking[] = ((bookingsRes.data ?? []) as Array<{ id: string; start_at: string; end_at: string; status: string; title: string | null; host_user_id: string | null; category_id: string | null; utm: Record<string, unknown> | null }>).map((b) => {
    const k = keysOf(b.category_id);
    const svcItem = typeof b.utm?.svc_item === "string" ? (b.utm.svc_item as string) : null;
    return {
      id: b.id,
      startAt: b.start_at,
      endAt: b.end_at,
      status: b.status,
      title: b.title,
      hostUserId: b.host_user_id,
      areaKey: k.areaKey,
      typeKey: k.typeKey,
      typeLabel: k.label,
      itemOfThisService: svcItem !== null && items.has(svcItem),
    };
  });
  const calls: MeetingCall[] = ((callsRes.data ?? []) as Array<{ id: string; booking_id: string | null; recorded_at: string; title: string; recorded_by_user_id: string | null; category_snapshot: { name?: string } | null; no_show: boolean; analysis_status: string; closer_score: number | null; service_link: string | null; proposals: unknown }>).map((c) => ({
    id: c.id,
    bookingId: c.booking_id,
    recordedAt: c.recorded_at,
    title: c.title,
    recorderUserId: c.recorded_by_user_id,
    typeLabel: c.category_snapshot?.name ?? null,
    noShow: c.no_show,
    analysisStatus: c.analysis_status,
    score: c.closer_score,
    serviceLink: c.service_link,
    pendingProposals: Array.isArray(c.proposals) ? c.proposals.filter((p) => (p as { status?: string })?.status === "pending").length : 0,
  }));
  return serviceMeetings({ calls, bookings, window: { createdAt: input.createdAt, endsOn: input.endsOn }, now: input.now ?? new Date() });
}
