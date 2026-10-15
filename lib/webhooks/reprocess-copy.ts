/**
 * Los textos del reproceso (Tirón 2, C2): lo que explica el panel de confirmación y la casilla
 * «Volver a correr también los flujos que ya corrieron». Puro: el componente solo los pinta.
 */

export const RERUN_LABEL = "Volver a correr también los flujos que ya corrieron";

/** La advertencia de la casilla. Siempre visible: es lo que hay que leer ANTES de marcarla. */
export const RERUN_WARNING = "Puede mandar mensajes repetidos: los flujos que ya corrieron vuelven a empezar desde el principio.";

export function reprocessIntro(args: { count: number; alreadyProcessed?: boolean }): string {
  const what = args.count === 1 ? "este envío" : `estos ${args.count} envíos`;
  const base = `Vuelve a mapear el contacto y corre los flujos que todavía no corrieron (o que fallaron) con ${what}. Los flujos que ya corrieron no se repiten.`;
  return args.count === 1 && args.alreadyProcessed ? `${base} Este envío ya se procesó bien.` : base;
}

/** Lo que se le cuenta a la persona cuando terminó, según si marcó la casilla. */
export function reprocessDone(args: { reprocessed: number; skipped: number; rerunCompleted: boolean }): string {
  const { reprocessed, skipped, rerunCompleted } = args;
  if (reprocessed === 0) return "Otro reproceso se adelantó: recargá para ver el resultado.";
  const base = reprocessed === 1 ? "Reprocesado." : `Reprocesados ${reprocessed}.`;
  const extra = rerunCompleted ? " Se volvieron a correr también los flujos que ya habían corrido." : "";
  const left = skipped === 1 ? " 1 no se pudo reprocesar." : skipped > 1 ? ` ${skipped} no se pudieron reprocesar.` : "";
  return `${base}${extra}${left}`;
}
