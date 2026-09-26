import { createClient } from "@/lib/supabase/server";
import { getWorkspace } from "@/lib/workspace";
import { formatDuration, formatUnedited, loadDraftMetrics } from "@/lib/agent/drafts/metrics-query";
import { MetricsScopeToggle } from "./metrics-scope-toggle";

/**
 * La franja de medicion arriba de la cola (Bloque 2c). Cinco numeros, y los
 * tres tiempos separados a proposito: el que se puede mejorar es el del medio
 * (lo que tarda la aprobacion), y si se muestra uno solo no se ve cual es.
 *
 * Un Member ve sus numeros. Owner/Admin ven el equipo (o los suyos) y, debajo,
 * el desglose por persona: un promedio de equipo esconde a quien tarda seis
 * horas detras de tres que tardan cinco minutos.
 */
export async function MetricsStrip({
  workspaceId,
  isAdmin,
  members,
  onlyMine = false,
}: {
  workspaceId: string;
  isAdmin: boolean;
  members: Array<{ userId: string; label: string }>;
  onlyMine?: boolean;
}) {
  const { user } = await getWorkspace();
  const supabase = await createClient();
  const view = await loadDraftMetrics(supabase, { workspaceId, isAdmin, userId: user.id, onlyMine });
  const labels = new Map(members.map((m) => [m.userId, m.label]));

  const tiles: Array<{ label: string; value: string; hint: string; highlight?: boolean }> = [
    {
      label: "Respuesta (mediana de hoy)",
      value: formatDuration(view.today?.responseMedianS ?? null),
      hint: "Desde el último mensaje del lead hasta que la respuesta salió. Lo que percibe el lead.",
    },
    {
      label: "Lo que tarda el agente",
      value: formatDuration(view.today?.agentMedianS ?? null),
      hint: "Incluye la espera de la ráfaga (la ventana de silencio): no es la velocidad del modelo.",
    },
    {
      label: "Lo que tarda la aprobación",
      value: formatDuration(view.today?.approvalMedianS ?? null),
      hint: "Desde que el borrador estuvo listo hasta que alguien lo envió. El único tiempo que se puede mejorar.",
      highlight: true,
    },
    {
      label: "Ventanas perdidas (7 días)",
      value: String(view.week?.windowsMissed ?? 0),
      hint: "Borradores que quedaron sin enviar hasta que cerró la ventana. Descartar a propósito no cuenta.",
    },
    {
      label: "Aprobados sin editar (7 días)",
      value: formatUnedited(view.week),
      hint: "Qué parte de lo que se envió salió tal cual lo escribió el agente. Es el dato para pasar a envío directo.",
    },
  ];

  return (
    <section aria-label="Medición de la cola" className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {view.scope === "team" ? "Números de todo el equipo." : "Tus números: los borradores de tus contactos y lo que decidiste vos."}
        </p>
        {isAdmin && <MetricsScopeToggle onlyMine={onlyMine} />}
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5">
        {tiles.map((t) => (
          <div
            key={t.label}
            className={`rounded-xl border p-3 ${t.highlight ? "border-primary/40 bg-primary/5" : "border-border"}`}
            title={t.hint}
          >
            <p className="text-[11px] font-medium text-muted-foreground">{t.label}</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">{t.value}</p>
            {/* En el telefono la explicacion queda en el title: con las cinco
                abiertas, la cola arrancaria dos pantallas mas abajo. */}
            <p className="mt-0.5 hidden text-[11px] leading-snug text-muted-foreground queue:block">{t.hint}</p>
          </div>
        ))}
      </div>

      {isAdmin && view.byPerson && view.byPerson.length > 0 && (
        <details className="rounded-xl border border-border">
          <summary className="cursor-pointer px-3 py-2 text-xs font-medium">Por persona (últimos 7 días)</summary>
          <div className="overflow-x-auto px-3 pb-3">
            <table className="w-full text-left text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="py-1.5 pr-3 font-medium">Persona</th>
                  <th className="py-1.5 pr-3 font-medium">Aprobación (mediana)</th>
                  <th className="py-1.5 pr-3 font-medium">Sin editar</th>
                  <th className="py-1.5 pr-3 font-medium">Descartados</th>
                  <th className="py-1.5 pr-3 font-medium">Ventanas perdidas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {view.byPerson.map((p) => (
                  <tr key={p.userId ?? "sin-asignar"}>
                    <td className="py-1.5 pr-3">{p.userId ? (labels.get(p.userId) ?? "Ex miembro") : "Sin asignar"}</td>
                    <td className="py-1.5 pr-3 tabular-nums">{formatDuration(p.approvalMedianS)}</td>
                    <td className="py-1.5 pr-3 tabular-nums">{formatUnedited(p)}</td>
                    <td className="py-1.5 pr-3 tabular-nums">{p.discarded}</td>
                    <td className="py-1.5 pr-3 tabular-nums">{p.windowsMissed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  );
}
