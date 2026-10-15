/**
 * Los errores de la base de Comisiones, en palabras de una persona (Extra I). Puro.
 *
 * La migración 00231 usa tres códigos propios: `CM001` (un rol o una persona que no corresponde), `CM002` (la
 * configuración de roles) y `CM003` (una comisión que no se toca). Los textos de la base están escritos para
 * leerse, pero sin tildes y a veces técnicos: acá se reemplazan por los de la pantalla. Lo que no se reconoce
 * cae en el mensaje genérico de quien llama, y el detalle técnico NO se le muestra a la persona.
 */

export interface DbErrorLike {
  code?: string | null;
  message?: string | null;
}

const RULES: Array<{ code: string; test: RegExp; message: string }> = [
  { code: "CM001", test: /no existe o esta desactivado/i, message: "Ese rol está desactivado: activalo antes de crear reglas para él." },
  { code: "CM001", test: /persona fija necesita/i, message: "Elegí a quién se le paga: este rol es de una persona fija." },
  { code: "CM001", test: /parte del equipo/i, message: "Esa persona no es del equipo." },
  { code: "CM001", test: /no existe/i, message: "Ese rol no existe." },
  { code: "CM002", test: /no se borra/i, message: "Un rol de comisión no se borra: se desactiva." },
  { code: "CM002", test: /no se cambia/i, message: "A quién se le paga un rol no se puede cambiar una vez creado." },
  { code: "CM002", test: /precargado/i, message: "Un rol precargado sigue siendo precargado." },
  { code: "CM002", test: /misma clave/i, message: "Hay dos roles con la misma clave." },
  { code: "CM002", test: /clave/i, message: "La clave del rol no es válida." },
  { code: "CM002", test: /valido/i, message: "A quién se le paga el rol no es válido." },
  { code: "CM003", test: /las escribe el servidor/i, message: "Las comisiones solo las escribe el sistema." },
  { code: "CM003", test: /gasto pagado/i, message: "Esa comisión está en un gasto ya pagado: no se suelta." },
  { code: "CM003", test: /no cambia de monto/i, message: "Una comisión no cambia de monto, pago, regla ni tipo: anulala y cargá un ajuste." },
];

/** Dos escrituras a la vez chocaron en la posición de una regla (restricción de exclusión o única). */
const CLASH_CODES = new Set(["23P01", "23505"]);

export function isPositionClash(error: DbErrorLike | null | undefined): boolean {
  return !!error?.code && CLASH_CODES.has(error.code);
}

/** El mensaje para la persona. `fallback` es lo que se dice si el error no es de los conocidos. */
export function commissionDbError(error: DbErrorLike | null | undefined, fallback: string): string {
  const code = error?.code ?? "";
  const message = error?.message ?? "";
  for (const rule of RULES) if (rule.code === code && rule.test.test(message)) return rule.message;
  if (isPositionClash(error)) return "Otra persona estaba cambiando las reglas al mismo tiempo. Probá de nuevo.";
  return fallback;
}
