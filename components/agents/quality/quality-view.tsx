import Link from "next/link";
import { BarChart3 } from "lucide-react";
import { formatRate, type QualityWeek } from "@/lib/ai-learning/quality";

/**
 * Panel de calidad. Un Server Component: solo dibuja. Colores de estado solo verde, amarillo y rojo; un dato
 * que no existe es «Sin dato». Los filtros viven en la URL (`?agente=`, `?semanas=`).
 */

function weekLabel(weekStart: string): string {
  const [y, m, d] = weekStart.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return `Semana del ${date.toLocaleDateString("es-AR", { day: "numeric", month: "short", timeZone: "UTC" })}`;
}

function Bar({ approved, edited, rejected, decided }: { approved: number; edited: number; rejected: number; decided: number }) {
  if (!decided) return <div className="h-2 w-full rounded-full bg-muted" aria-hidden />;
  const pct = (n: number) => `${(n / decided) * 100}%`;
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
      <span className="bg-emerald-500" style={{ width: pct(approved) }} />
      <span className="bg-amber-400" style={{ width: pct(edited) }} />
      <span className="bg-red-500" style={{ width: pct(rejected) }} />
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function QualityView({
  weeks,
  totals,
  agents,
  agentId,
  weeksCount,
  failed,
}: {
  weeks: QualityWeek[];
  totals: Omit<QualityWeek, "weekStart">;
  agents: Array<{ id: string; name: string }>;
  agentId: string | null;
  weeksCount: number;
  failed: boolean;
}) {
  const href = (next: { agente?: string | null; semanas?: number }) => {
    const sp = new URLSearchParams();
    const a = next.agente === undefined ? agentId : next.agente;
    if (a) sp.set("agente", a);
    const w = next.semanas ?? weeksCount;
    if (w !== 8) sp.set("semanas", String(w));
    const q = sp.toString();
    return `/dashboard/agents/calidad${q ? `?${q}` : ""}`;
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <nav aria-label="Filtros" className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-xs text-muted-foreground">Agente:</span>
        <FilterLink href={href({ agente: null })} active={!agentId}>Todos</FilterLink>
        {agents.map((a) => (
          <FilterLink key={a.id} href={href({ agente: a.id })} active={agentId === a.id}>
            {a.name}
          </FilterLink>
        ))}
        <span className="ml-2 text-xs text-muted-foreground">Período:</span>
        {[4, 8, 12].map((w) => (
          <FilterLink key={w} href={href({ semanas: w })} active={weeksCount === w}>
            {w} semanas
          </FilterLink>
        ))}
      </nav>

      {failed && <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">No se pudo leer la calidad ahora. Probá de nuevo en un rato.</p>}

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Aprobadas tal cual" value={formatRate(totals.approvalRate)} hint={totals.decided ? `${totals.approved} de ${totals.decided}` : "Todavía no hay decisiones"} />
        <Stat label="Aprobadas con edición" value={formatRate(totals.editRate)} hint={totals.decided ? `${totals.edited} de ${totals.decided}` : undefined} />
        <Stat label="Rechazadas" value={formatRate(totals.rejectionRate)} hint={totals.decided ? `${totals.rejected} de ${totals.decided}` : undefined} />
      </div>

      {weeks.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center">
          <BarChart3 className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden />
          <p className="mt-3 text-sm font-medium">Sin decisiones en este período</p>
          <p className="mt-1 text-sm text-muted-foreground">El panel se llena con cada propuesta o borrador que se aprueba, se edita o se rechaza.</p>
        </div>
      ) : (
        <section aria-labelledby="por-semana" className="rounded-xl border border-border bg-card">
          <h2 id="por-semana" className="border-b border-border px-4 py-3 text-sm font-semibold">
            Por semana
          </h2>
          <p className="flex flex-wrap gap-3 px-4 pt-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden /> Aprobada</span>
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-400" aria-hidden /> Con edición</span>
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-500" aria-hidden /> Rechazada</span>
          </p>
          <ul className="divide-y divide-border">
            {weeks.map((w) => (
              <li key={w.weekStart} className="grid gap-2 px-4 py-3 text-sm md:grid-cols-[10rem_1fr_16rem] md:items-center">
                <div>
                  <p className="font-medium">{weekLabel(w.weekStart)}</p>
                  <p className="text-xs text-muted-foreground">{w.decided} decididas</p>
                </div>
                <div className="space-y-1">
                  <Bar approved={w.approved} edited={w.edited} rejected={w.rejected} decided={w.decided} />
                  <p className="text-xs text-muted-foreground tabular-nums">
                    Aprobación {formatRate(w.approvalRate)} · Edición {formatRate(w.editRate)} · Rechazo {formatRate(w.rejectionRate)}
                  </p>
                </div>
                <p className="text-xs text-muted-foreground">
                  {w.reasons.length === 0 ? "Sin rechazos" : w.reasons.map((r) => `${r.label}: ${r.count}`).join(" · ")}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {totals.reasons.length > 0 && (
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">Motivos de rechazo del período</h2>
          <ul className="mt-3 space-y-2">
            {totals.reasons.map((r) => (
              <li key={r.reason} className="flex items-center gap-3 text-sm">
                <span className="w-56 shrink-0">{r.label}</span>
                <span className="h-2 rounded-full bg-red-500" style={{ width: `${Math.max(4, (r.count / totals.rejected) * 100)}%`, maxWidth: "60%" }} aria-hidden />
                <span className="tabular-nums text-muted-foreground">{r.count}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function FilterLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={active ? "rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground" : "rounded-full border border-border px-3 py-1 text-xs hover:bg-accent"}
    >
      {children}
    </Link>
  );
}
