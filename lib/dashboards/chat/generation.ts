/**
 * Las marcas que hacen vencer la cache del dashboard de Chat.
 *
 * Viven en cookies y no en memoria porque pueden correr varias replicas: una
 * entrada mas vieja que la marca cuenta como vencida en todas (`block-cache.ts`).
 *
 * - `chat_dash_gen`: "Actualizar" pide todo de nuevo.
 * - `chat_dash_pat_gen`: una correccion de categorias pide solo Patrones. Sin esto,
 *   mover un texto parece no haber hecho nada hasta que vence la entrada.
 */

import { cookies } from "next/headers";
import { PATTERN_BLOCKS, type ChatBlockKey } from "./block-keys";

export const CHAT_GEN_COOKIE = "chat_dash_gen";
export const CHAT_PATTERNS_GEN_COOKIE = "chat_dash_pat_gen";

/** "Actualizar" apretado seguido no vuelve a pedir todo. */
export const REFRESH_FLOOR_MS = 15_000;

const COOKIE_MAX_AGE_SECONDS = 60 * 60;

export interface ChatGenerations {
  all: number;
  patterns: number;
}

export function parseGeneration(raw: string | undefined): number {
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

/** La marca que le toca a un bloque. */
export function minStoredAtFor(block: ChatBlockKey, generations: ChatGenerations): number {
  return PATTERN_BLOCKS.includes(block) ? Math.max(generations.all, generations.patterns) : generations.all;
}

/** La marca nueva, o null si la anterior es de hace muy poco. */
export function nextGeneration(current: number, now: number, floorMs: number = REFRESH_FLOOR_MS): number | null {
  return now - current < floorMs ? null : now;
}

export async function readChatGenerations(): Promise<ChatGenerations> {
  const store = await cookies();
  return {
    all: parseGeneration(store.get(CHAT_GEN_COOKIE)?.value),
    patterns: parseGeneration(store.get(CHAT_PATTERNS_GEN_COOKIE)?.value),
  };
}

async function writeGeneration(name: string, value: number) {
  const store = await cookies();
  store.set(name, String(value), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
}

/** Solo para Server Actions. false si se pidio hace muy poco y no hace falta repetir. */
export async function bumpChatGeneration(now: number = Date.now()): Promise<boolean> {
  const { all } = await readChatGenerations();
  const next = nextGeneration(all, now);
  if (next === null) return false;
  await writeGeneration(CHAT_GEN_COOKIE, next);
  return true;
}

/** Solo para Server Actions: una correccion se ve siempre, sin piso. */
export async function bumpChatPatternsGeneration(now: number = Date.now()): Promise<void> {
  await writeGeneration(CHAT_PATTERNS_GEN_COOKIE, now);
}
