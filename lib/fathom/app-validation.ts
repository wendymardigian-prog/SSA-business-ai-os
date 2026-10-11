/**
 * Validacion de la app OAuth de Fathom (Client ID y Secret). Vive aparte de la
 * accion porque un archivo "use server" solo puede exportar funciones async.
 */
export function validateFathomApp(input: { clientId: string; clientSecret: string }): string | null {
  const id = input.clientId.trim();
  const secret = input.clientSecret.trim();
  if (id.length < 8 || id.length > 200 || /\s/.test(id)) return "El Client ID no parece válido";
  if (secret.length < 8 || secret.length > 400 || /\s/.test(secret)) return "El Client Secret no parece válido";
  return null;
}
