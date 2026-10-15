/**
 * Los tipos de lo que devuelven las acciones de apoyo de la pantalla de Comisiones (`lib/actions/commissions-ui.ts`).
 * Van acá porque un archivo `"use server"` solo puede exportar funciones asincrónicas.
 */
import type { SelectedCommission } from "./selection";

export interface SelectAllResult {
  items: SelectedCommission[];
  /** Cuántas comisiones tiene el filtro. */
  total: number;
  /** Cuántas de ellas se pueden pasar a un gasto. */
  selectable: number;
  /** Se eligieron solo las primeras 500 (el tope de una liquidación). */
  capped: boolean;
  /** El filtro tiene más comisiones que el tope de lectura: se tomaron las más nuevas. */
  truncated: boolean;
}

export interface SaleOption {
  id: string;
  /** «Lucía Pérez · Mentoría · 5 oct 2026». */
  label: string;
}

export interface PaymentOption {
  id: string;
  /** «Cuota 2 de 6 · USD 500,00 · 10 oct 2026». */
  label: string;
}
