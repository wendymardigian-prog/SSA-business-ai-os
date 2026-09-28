/**
 * El formato de un identificador de campo del formulario (F18).
 *
 * Solo: minúsculas, números y guión bajo, empezando con letra, hasta 40.
 *
 * Vive solo, sin dependencias, porque lo usan tanto la validación (con Zod)
 * como el script de embed, que se compila aparte para la página de cualquiera
 * y no puede arrastrar Zod.
 */
export const IDENTIFIER_RE = /^[a-z][a-z0-9_]{0,39}$/;
