/**
 * Lo que los módulos le suman al Diseñador IA por sus puntos de extensión (`extensions.ts`): sus variables, su origen de
 * sujeto y sus avisos. Se carga en los puntos de entrada del servidor que generan o listan generaciones (las acciones,
 * el nodo de automatizaciones y el arranque de la cola), nunca al importar `generate-core` u otro módulo del Diseñador:
 * así sus tests ven el registro vacío. Cada registro es idempotente.
 */
import { registerServiceDesignExtensions } from "@/lib/services/certificate-extension"; // @plantilla-quitar(servicios)

export function loadModuleDesignExtensions(): void {
  registerServiceDesignExtensions(); // @plantilla-quitar(servicios)
}
