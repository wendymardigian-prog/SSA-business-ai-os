/**
 * Los tipos de «Crear una tarea cuando un pago vence» (R5), en un archivo SIN importaciones: lo leen los componentes del
 * navegador (la tarjeta de Ajustes) y no pueden traer detras el registro del motor de flujos, que es codigo de servidor.
 */

export const TASK_PAYMENT_TEMPLATE_KEYS = ["task_payment_overdue", "task_payment_paid_close"] as const;
export type TaskPaymentTemplateKey = (typeof TASK_PAYMENT_TEMPLATE_KEYS)[number];

export interface TaskPaymentFlow {
  key: TaskPaymentTemplateKey;
  id: string;
  name: string;
  status: string;
}

export interface TaskPaymentState {
  /** Prendido = el flujo que crea la tarea esta publicado. */
  enabled: boolean;
  flows: TaskPaymentFlow[];
}
