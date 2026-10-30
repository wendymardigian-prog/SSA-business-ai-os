"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Las fotos del equipo (Mi cuenta, 00273), para todo el panel.
 *
 * El layout del dashboard las carga UNA vez (id de la persona → URL publica,
 * solo las que tienen foto) y cualquier circulo de una persona
 * (`Avatar` con `userId`) la busca aca. Asi una foto nueva aparece en las
 * tareas, la bandeja y el contenido sin pasar la URL por cada pantalla.
 *
 * Sin proveedor (paginas publicas, tests), no hay fotos: quedan las iniciales.
 */
const MemberAvatarsContext = createContext<Readonly<Record<string, string>>>({});

export function MemberAvatarsProvider({ avatars, children }: { avatars: Readonly<Record<string, string>>; children?: ReactNode }) {
  return <MemberAvatarsContext.Provider value={avatars}>{children}</MemberAvatarsContext.Provider>;
}

/** La foto de una persona del equipo, o null. */
export function useMemberAvatar(userId: string | null | undefined): string | null {
  const avatars = useContext(MemberAvatarsContext);
  return userId ? (avatars[userId] ?? null) : null;
}
