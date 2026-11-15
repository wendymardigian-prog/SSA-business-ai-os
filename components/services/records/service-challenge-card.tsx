// @plantilla-quitar(servicios)
/**
 * El bloque Reto de la ficha del servicio (F127.1, F127.5, F127.6): si aceptó las reglas, la fecha límite para empezar
 * y el control semanal (total, video, por debajo del mínimo y los días con algo en «Trabado en»). Lee
 * `app_servicio.svc_challenge_view`; las semanas las arma `svc_challenge_weeks_plan` (gemela de challengeWeeks).
 */
import type { WeekView } from "@/lib/services/challenge";

export interface ChallengeViewData {
  phase_name: string;
  status: string;
  awaiting_start: boolean;
  started_on: string | null;
  days: number | null;
  accepted: { at: string; items: string[] } | null;
  start_by: string | null;
  weekly: { min?: number | null; video?: boolean; number_field_key?: string | null; stuck_field_key?: string | null };
  weeks: WeekView[];
}

const civil = (d: string) => new Intl.DateTimeFormat("es", { timeZone: "UTC", day: "numeric", month: "short" }).format(new Date(`${d}T00:00:00Z`));

export function ServiceChallengeCard({ data, today, timeZone }: { data: ChallengeViewData; today: string; timeZone: string }) {
  const hasWeekly = !!data.weekly && (data.weekly.min != null || data.weekly.video || !!data.weekly.number_field_key || !!data.weekly.stuck_field_key);
  const late = data.awaiting_start && data.start_by && data.start_by < today;
  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4" aria-label="Reto">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">Reto · {data.phase_name}</h3>
        <span className="text-xs text-muted-foreground">
          {data.awaiting_start ? "Sin empezar" : data.started_on ? `Empezó el ${civil(data.started_on)}${data.days ? ` · ${data.days} días` : ""}` : ""}
        </span>
      </div>
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        {data.start_by && (
          <div>
            <dt className="text-xs text-muted-foreground">Fecha límite para empezar</dt>
            <dd className={late ? "text-bad" : undefined}>
              {civil(data.start_by)}
              {late ? " · se pasó" : ""}
            </dd>
          </div>
        )}
        <div>
          <dt className="text-xs text-muted-foreground">Reglas</dt>
          <dd>
            {data.accepted
              ? `Aceptadas el ${new Intl.DateTimeFormat("es", { timeZone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(data.accepted.at))} (${data.accepted.items.length})`
              : data.awaiting_start
                ? "Todavía no las aceptó"
                : "—"}
          </dd>
        </div>
      </dl>
      {hasWeekly && data.weeks.length > 0 && (
        <div>
          <ul className="divide-y divide-border text-sm" aria-label="Control semanal">
            {data.weeks.map((w) => (
              <li key={w.week} className={`flex flex-wrap items-baseline gap-x-4 gap-y-1 py-1.5 ${w.future ? "text-muted-foreground" : ""}`}>
                <span className="w-40 tabular-nums">
                  Semana {w.week} · {civil(w.from)}–{civil(w.to)}
                  {w.current ? <span className="ml-1 text-xs text-muted-foreground">(esta)</span> : null}
                </span>
                <span className={`tabular-nums ${w.below && !w.missingVideo ? "text-bad" : ""}`}>
                  {w.future ? "—" : w.total}
                  {data.weekly.min != null ? <span className="text-xs text-muted-foreground"> de {data.weekly.min}</span> : null}
                </span>
                {data.weekly.video && <span className={w.missingVideo ? "text-bad" : ""}>{w.future ? "" : w.video ? "Con video" : "Sin video"}</span>}
                {w.stuck.length > 0 && (
                  <span className="basis-full text-xs text-warn">
                    {w.stuck.map((x) => `Trabado ${civil(x.on)}: ${x.text}`).join(" · ")}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {data.weeks.some((w) => w.below) && <p className="mt-2 text-xs text-bad">Hay semanas por debajo del mínimo o sin video.</p>}
        </div>
      )}
    </section>
  );
}
