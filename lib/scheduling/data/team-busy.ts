/**
 * El ocupado REAL de cada persona del equipo para la vista «Día» de equipo. Solo servidor.
 *
 * - Sale de los calendarios que cada persona marcó «Revisar conflictos» (`calendars.check_conflicts`), los mismos que
 *   usa la página de reservas, con freeBusy de Google: solo horarios, NUNCA títulos ni invitados.
 * - Quien llama ya comprobó el permiso (`canSeeTeamAvailability`) y saca el workspace de la sesión.
 * - Nunca lanza: si Google no responde, la persona queda `unavailable` (la columna avisa: nunca se muestra libre).
 * - Caché de 60 s por (conexión, calendarios, rango), como el motor de horarios.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { getBusy, type BusyInterval } from "@/lib/google-calendar/client";
import type { TeamBusyStatus } from "@/lib/scheduling/team-view";

type Db = SupabaseClient<Database>;

export interface TeamBusy {
  userId: string;
  status: TeamBusyStatus;
  busy: Array<{ startAt: string; endAt: string }>;
}

const CACHE_MS = 60_000;
const TIMEOUT_MS = 5_000;
const cache = new Map<string, { at: number; busy: BusyInterval[] }>();

export function resetTeamBusyCache(): void {
  cache.clear();
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);
}

export async function loadTeamBusy(
  service: Db,
  input: { workspaceId: string; userIds: string[]; fromUtc: string; toUtc: string; now?: () => number },
): Promise<TeamBusy[]> {
  const userIds = [...new Set(input.userIds)];
  if (userIds.length === 0) return [];
  const now = input.now ?? Date.now;

  const { data: cals } = await service
    .from("calendars")
    .select("user_id, connection_id, external_calendar_id")
    .eq("workspace_id", input.workspaceId)
    .in("user_id", userIds)
    .eq("is_active", true)
    .eq("check_conflicts", true);
  const calendars = cals ?? [];
  const connectionIds = [...new Set(calendars.map((c) => c.connection_id))];
  const { data: conns } = connectionIds.length
    ? await service.from("oauth_connections").select("id, status").in("id", connectionIds)
    : { data: [] as Array<{ id: string; status: string }> };
  const connStatus = new Map((conns ?? []).map((c) => [c.id, c.status]));

  return Promise.all(
    userIds.map(async (userId): Promise<TeamBusy> => {
      const mine = calendars.filter((c) => c.user_id === userId);
      if (mine.length === 0) return { userId, status: "no_google", busy: [] };
      const byConn = new Map<string, string[]>();
      for (const c of mine) byConn.set(c.connection_id, [...(byConn.get(c.connection_id) ?? []), c.external_calendar_id]);
      const usable = [...byConn.entries()].filter(([id]) => {
        const s = connStatus.get(id);
        return s === "active" || s === "attention";
      });
      if (usable.length === 0) return { userId, status: "broken", busy: [] };

      let failed = false;
      const busy: TeamBusy["busy"] = [];
      await Promise.all(
        usable.map(async ([connectionId, externalIds]) => {
          const key = `${connectionId}|${[...externalIds].sort().join(",")}|${input.fromUtc}|${input.toUtc}`;
          const hit = cache.get(key);
          let intervals: BusyInterval[];
          if (hit && now() - hit.at < CACHE_MS) {
            intervals = hit.busy;
          } else {
            try {
              intervals = await withTimeout(getBusy({ supabase: service }, connectionId, externalIds, input.fromUtc, input.toUtc), TIMEOUT_MS);
              cache.set(key, { at: now(), busy: intervals });
            } catch {
              failed = true;
              return;
            }
          }
          for (const b of intervals) busy.push({ startAt: b.startUtc, endAt: b.endUtc });
        }),
      );
      busy.sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
      return { userId, status: failed ? "unavailable" : "ok", busy };
    }),
  );
}
