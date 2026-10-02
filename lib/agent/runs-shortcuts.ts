/**
 * Los cinco atajos de un clic de Corridas (R2): los que se usan de verdad al
 * auditar. "Solo errores" y "Escaladas" son el filtro de resultado que ya
 * existe, nada nuevo. "Sin precio" y "Más caras" necesitan `ai_costs.view`
 * (leen `cost_usd`); "Más lentas" no, `latency_ms` es publica.
 *
 * Puro: valida y arma los parametros de la URL. No toca la base.
 */

export type RunShortcutKey = "errores" | "escaladas" | "sin_precio" | "lentas" | "caras";

export interface RunShortcutDef {
  key: RunShortcutKey;
  label: string;
  /** Si hace falta `ai_costs.view` para verlo y aplicarlo. */
  needsCost: boolean;
}

export const RUN_SHORTCUTS: RunShortcutDef[] = [
  { key: "errores", label: "Solo errores", needsCost: false },
  { key: "escaladas", label: "Escaladas", needsCost: false },
  { key: "sin_precio", label: "Sin precio", needsCost: true },
  { key: "lentas", label: "Más lentas de 30 s", needsCost: false },
  { key: "caras", label: "Más caras", needsCost: true },
];

/** Los parametros de la URL que pone cada atajo. Los demas filtros no se tocan. */
export function shortcutParams(key: RunShortcutKey): Record<string, string> {
  switch (key) {
    case "errores":
      return { resultado: "error" };
    case "escaladas":
      return { resultado: "escalated" };
    case "sin_precio":
      return { sin_precio: "1" };
    case "lentas":
      return { lentas: "1" };
    case "caras":
      return { caras: "1" };
  }
}

/** Si ESTE atajo es el que esta activo ahora mismo, para resaltarlo. */
export function isShortcutActive(
  key: RunShortcutKey,
  current: { resultado: string; sinPrecio: boolean; masLentas: boolean; masCaras: boolean },
): boolean {
  switch (key) {
    case "errores":
      return current.resultado === "error";
    case "escaladas":
      return current.resultado === "escalated";
    case "sin_precio":
      return current.sinPrecio;
    case "lentas":
      return current.masLentas;
    case "caras":
      return current.masCaras;
  }
}
