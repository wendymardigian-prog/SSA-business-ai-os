/**
 * WhatsApp (Evolution) simulado para el servidor de desarrollo, los verify y las capturas: con
 * `EVOLUTION_FAKE_API=1` la app no le habla al Evolution de verdad sino a `lib/evolution/testing/fake-evolution.ts`, que
 * anota cada envío en memoria y no sale de la PC.
 *
 * Es el ADAPTADOR del envío: va en un solo lugar (`request()` de `lib/evolution-client.ts`), así que cubre todo lo que
 * manda por WhatsApp (texto, archivos, grupos, encuestas, «¿tiene WhatsApp?», el estado de la sesión). Con el simulado
 * prendido, `getEvolutionConfig` devuelve una configuración de mentira: nunca se lee ni se usa una clave real.
 *
 * CANDADO: en producción (`NODE_ENV === "production"`) se ignora SIEMPRE, aunque la variable esté puesta.
 * `fake-mode.test.ts` lo comprueba. La variable nunca va en Railway.
 */
import type { EvolutionConfig } from "@/lib/evolution-client";
import { fakeEvolutionFetch } from "./testing/fake-evolution";

type Env = Record<string, string | undefined>;

/** La dirección del Evolution simulado. No resuelve a ningún sitio: el `fetch` simulado la atiende antes. */
export const FAKE_EVOLUTION_URL = "http://evolution.simulado.invalid";

/** ¿Hay que usar el Evolution simulado? Solo con la variable en «1» y fuera de producción. */
export function evolutionFakeEnabled(env: Env = process.env): boolean {
  return env.EVOLUTION_FAKE_API === "1" && env.NODE_ENV !== "production";
}

/** El fetch simulado, o `undefined` para usar el de verdad. */
export function evolutionFakeFetch(env: Env = process.env): typeof fetch | undefined {
  return evolutionFakeEnabled(env) ? fakeEvolutionFetch : undefined;
}

/** La configuración de mentira (sin ninguna clave real), o null si el simulado está apagado. */
export function fakeEvolutionConfig(env: Env = process.env): EvolutionConfig | null {
  if (!evolutionFakeEnabled(env)) return null;
  return { baseUrl: FAKE_EVOLUTION_URL, apiKey: "simulado", instancePrefix: env.EVOLUTION_INSTANCE_PREFIX?.trim() || "ssa" };
}
