// @plantilla-quitar(servicios)

/**
 * El Asistente IA del programa en la ficha del servicio (F86): gasto del mes, su límite y sus conversaciones. Los
 * montos solo con `ai_costs.view`. Las conversaciones las escribe el portal (Parte 2); acá se listan.
 */
export function ServiceAssistantCard({
  detail,
  money,
  creditsName,
  threads,
  formatDate,
}: {
  detail: { limitUsd: number; credits: number; reached: boolean; spentUsd: number } | null;
  money: boolean;
  creditsName: string;
  threads: Array<{ id: string; title: string | null; lastMessageAt: string | null }>;
  formatDate: (iso: string) => string;
}) {
  const usd = (n: number) => `USD ${n.toFixed(2)}`;
  return (
    <section aria-labelledby="asistente" className="space-y-2 rounded-xl border border-border p-4">
      <h3 id="asistente" className="text-sm font-semibold">Asistente IA</h3>
      {detail ? (
        <dl className="grid grid-cols-3 gap-3 text-sm">
          <div><dt className="text-xs text-muted-foreground">Este mes</dt><dd>{money ? usd(detail.spentUsd) : "—"}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Límite</dt><dd>{money ? usd(detail.limitUsd) : "—"}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Le quedan</dt><dd>{detail.credits.toLocaleString("es")} {creditsName}{detail.reached ? " · llegó al límite" : ""}</dd></div>
        </dl>
      ) : (
        <p className="text-sm text-muted-foreground">Sin datos del asistente.</p>
      )}
      {threads.length > 0 ? (
        <ul className="divide-y divide-border rounded-lg border border-border text-sm">
          {threads.map((t) => (
            <li key={t.id} className="flex items-center gap-2 px-3 py-1.5">
              <span className="flex-1 truncate">{t.title || "Conversación"}</span>
              {t.lastMessageAt && <span className="text-xs text-muted-foreground">{formatDate(t.lastMessageAt)}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">Todavía no usó el asistente.</p>
      )}
    </section>
  );
}
