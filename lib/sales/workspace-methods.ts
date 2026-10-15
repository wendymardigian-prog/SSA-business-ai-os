/**
 * Los métodos de pago de un workspace, leídos de su fila (`workspaces.payment_methods`). UN solo lugar:
 * todo el que antes leía `enabled_payment_methods` pasa por acá. Nunca lanza; si la columna no está
 * (base sin la 00224) o viene rota, devuelve el catálogo de arranque.
 */
import { activeMethodKeys, methodDefs, parsePaymentMethods, type PaymentMethodConfig } from "./payment-methods-config";
import type { PaymentMethodDef } from "./payment-methods";

export interface WorkspaceMethods {
  /** Todos los métodos del negocio, activos o no, tal como están guardados. */
  configs: PaymentMethodConfig[];
  /** Los mismos, en el formato de `fees.ts` y los selectores. Incluye los inactivos: un pago viejo los usa. */
  defs: PaymentMethodDef[];
  /** Las claves activas: lo que se ofrece en pagos nuevos. */
  enabledKeys: string[];
}

export function workspaceMethods(workspace: unknown): WorkspaceMethods {
  const raw = workspace && typeof workspace === "object" ? (workspace as { payment_methods?: unknown }).payment_methods : undefined;
  const configs = parsePaymentMethods(raw);
  return { configs, defs: methodDefs(configs), enabledKeys: activeMethodKeys(configs) };
}
