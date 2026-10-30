/**
 * La foto de perfil de una persona del equipo (00273, bucket `user-avatars`).
 *
 * PURO y sin dependencias de servidor: lo importan el menu, la pantalla de
 * Equipo y los circulos de los asignados, que son Client Components.
 *
 * El bucket es publico (la foto se ve en toda la app), y la ruta siempre
 * empieza por el id de la persona: es lo que exige el CHECK
 * `user_profiles_avatar_path_check`, y lo que impide borrar un archivo ajeno.
 */

export const USER_AVATARS_BUCKET = "user-avatars";

/** La URL publica de una foto, o null si no hay foto o no se sabe la URL de Supabase. */
export function userAvatarPublicUrl(path: string | null | undefined): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/+$/, "");
  if (!base || !path) return null;
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return `${base}/storage/v1/object/public/${USER_AVATARS_BUCKET}/${encoded}`;
}

/** Una ruta NUEVA por cada foto (nunca se pisa una): asi no queda una foto vieja en el cache del navegador. */
export function userAvatarPath(userId: string, id: string, ext: "png" | "jpg" | "webp"): string {
  return `${userId}/${id}.${ext}`;
}

/** Si una ruta es una foto de ESA persona (para no borrar nunca un archivo de otro). */
export function isOwnAvatarPath(userId: string, path: string | null | undefined): path is string {
  return typeof path === "string" && path.startsWith(`${userId}/`) && !path.includes("..");
}
