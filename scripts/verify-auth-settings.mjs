#!/usr/bin/env node
/**
 * Seguridad del alta de cuentas (Servicios A1, S0 · F2 y F3).
 *
 * Lee la configuracion de Auth del proyecto vinculado con la Management API (el token
 * de la CLI; nunca se imprime) y:
 *   - FALLA (sale 1) si "Allow new users to sign up" esta prendido: cualquiera podria
 *     crearse una cuenta. Se apaga en Supabase › Authentication › Sign In / Providers.
 *   - AVISA (no falla) si "Leaked password protection" esta apagada.
 *   - Sale 2 si no hay token o la API no responde: no se pudo comprobar.
 *
 * Solo lee. No cambia nada.
 *
 *   node scripts/verify-auth-settings.mjs
 */
import { management, managementToken, projectRef } from "./lib/management-api.mjs";

const ref = projectRef();
if (!managementToken() || !ref) {
  console.error("No hay token de la CLI de Supabase (supabase login) o el proyecto no esta vinculado: no se pudo comprobar.");
  process.exit(2);
}

const { status, body } = await management(`/projects/${ref}/config/auth`);
if (status !== 200 || !body) {
  console.error(`La Management API respondio ${status}: no se pudo comprobar.`);
  process.exit(2);
}

let exit = 0;
if (body.disable_signup === true) {
  console.log("  ok   el registro publico esta apagado");
} else {
  console.error("  FALLA Apagá Allow new users to sign up en Supabase › Authentication");
  exit = 1;
}
if (body.password_hibp_enabled === true) {
  console.log("  ok   la proteccion de contrasenas filtradas esta prendida");
} else {
  console.warn("  AVISO Prendé Leaked password protection en Supabase › Authentication (ver docs/seguridad-despliegue.md)");
}
console.log(exit === 0 ? "\nTodo verde" : "\nHay que cambiar la configuracion de Auth");
process.exit(exit);
