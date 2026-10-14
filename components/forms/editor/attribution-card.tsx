import { AUTO_ATTRIBUTION_GROUPS } from "@/lib/forms/prefill";

/**
 * "Atribución · Siempre activa" (plano formularios-ui, F14): de donde llego cada persona se guarda sola en cada
 * respuesta. No hay nada que configurar: es solo la explicacion y la lista de lo que se registra.
 */
export function AttributionCard() {
  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-5" aria-labelledby="atribucion">
      <div>
        <h2 id="atribucion" className="flex items-center gap-2 text-sm font-semibold">
          Atribución
          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">Siempre activa</span>
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          De dónde llegó cada persona se guarda sola en cada respuesta y en su ficha de contacto. No tenés que agregar preguntas ocultas ni parámetros para eso.
        </p>
      </div>
      <ul className="space-y-1.5 text-xs text-muted-foreground">
        <li>
          <span className="font-medium text-foreground">Por dónde entró: </span>
          la dirección completa de la página, con sus parámetros (<span className="font-mono">entry_url</span>)
        </li>
        {AUTO_ATTRIBUTION_GROUPS.map((group) => (
          <li key={group.title}>
            <span className="font-medium text-foreground">{group.title}: </span>
            <span className="font-mono">{group.keys.join(", ")}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
