/**
 * Tipos de las acciones del editor (DS2) que no están en el contrato de la Ola 1.
 *
 * Viven acá y no en `lib/actions/designer/designs.ts` porque un archivo `"use server"` solo puede exportar
 * funciones asincrónicas. Solo tipos: se puede importar desde el navegador.
 */

import type { DesignKind } from "./contracts";

/** Por qué la IA no arrancó al crear: `pendiente` = todavía no está construida; `error` = respondió con un error. */
export type AiNotice = "pendiente" | "error";

export interface CreatedDesign {
  id: string;
  kind: DesignKind;
  href: string;
  /** Con IA o «Que la IA me proponga…»: si el pedido a la IA no salió, el diseño igual queda creado y el editor lo avisa. */
  notice: AiNotice | null;
}

/** Una imagen ya subida al negocio (para elegirla en «Agregar»). */
export interface UploadedImage {
  path: string;
  url: string;
}

export interface UploadedFile {
  path: string;
  url: string;
  name: string;
  mime: string;
}
