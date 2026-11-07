import Link from "next/link";
import { BarChart2 } from "lucide-react";
import type { AdsTotals } from "@/lib/dashboards/ads";

/** Lo que muestran el dashboard de Meta Ads y la pantalla Anuncios cuando no hay ninguna cuenta sincronizando. */
export function ConnectMetaAdsCard() {
  return (
    <div className="flex flex-1 items-center justify-center overflow-y-auto p-6">
      <div className="w-full max-w-xl space-y-6 rounded-2xl border border-border bg-card p-6">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10">
          <BarChart2 className="h-7 w-7 text-primary-ink" aria-hidden />
        </div>
        <div className="space-y-2 text-center">
          <h2 className="text-2xl font-bold">Conectar Meta Ads</h2>
          <p className="text-sm text-muted-foreground">
            Todavía no hay ninguna cuenta publicitaria sincronizando. Conectá Meta y elegí cuáles
            querés ver acá para seguir el rendimiento de tus campañas.
          </p>
        </div>
        <Link
          href="/dashboard/settings/integrations"
          className="flex h-10 w-full items-center justify-center rounded-lg bg-primary text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          Ir a Integraciones
        </Link>
      </div>
    </div>
  );
}

/** El aviso de cuando Meta no devolvio el alcance unico del periodo. */
export function UniqueReachNotice({ error }: { error: string }) {
  return (
    <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
      El alcance unico del periodo no se pudo leer: {error}. Lo que se muestra es la
      suma de los dias, que cuenta dos veces a quien vio el anuncio en dos dias distintos.
    </p>
  );
}

/**
 * Lo que aclara las tarjetas cuando el alcance supera a las impresiones. El alcance se le pregunta a Meta ahora y las impresiones llegan
 * hasta la ultima sincronizacion: pasa en una campaña recien prendida, y sin explicarlo se lee como imposible.
 */
export function ReachAheadNote({ totals }: { totals: Pick<AdsTotals, "reach" | "impressions"> }) {
  if (totals.reach === null || totals.impressions === null || totals.reach <= totals.impressions) return null;
  return (
    <p className="text-xs text-muted-foreground">
      El alcance supera a las impresiones porque las dos cifras no son del mismo momento: el alcance y la frecuencia se le preguntan a Meta ahora, y las impresiones llegan hasta la última sincronización. Se emparejan en la próxima.
    </p>
  );
}
