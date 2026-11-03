/**
 * Nombres que no son nombres.
 *
 * Cuando alguien le escribe a la cuenta sin haber interactuado antes,
 * Instagram no le da a Zernio el perfil de esa persona y Zernio manda
 * "Instagram User" en el nombre. No es un dato: es la forma que tiene la
 * plataforma de decir "no tengo el dato".
 *
 * La lista importa en dos lugares y por eso vive aca:
 *
 * 1. Para decidir si un contacto es anonimo (el filtro de la lista de
 *    contactos, y la columna is_anonymous que la base calcula sola).
 * 2. Para decidir si vale la pena pisar el nombre guardado cuando llega uno
 *    mejor. Un nombre de verdad no se pisa nunca; un placeholder si.
 *
 * La misma lista esta escrita en SQL en la migracion que define is_anonymous.
 * El test de este archivo compara las dos, porque una lista duplicada que se
 * desincroniza es exactamente el tipo de bug que no avisa.
 */

/** Ya normalizados: minusculas y sin espacios de sobra. */
export const PLACEHOLDER_NAMES = [
  "instagram user",
  "facebook user",
  "whatsapp user",
  "unknown commenter",
] as const;

function normalize(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/**
 * Un nombre que es un id de la plataforma o un telefono: solo digitos (con un
 * "+" opcional), 8 o mas. Es lo que guardaban los receptores cuando el canal no
 * mandaba el nombre (el id de Instagram, "1860383452043344"), y como no estaba
 * en la lista de arriba, el nombre real que llegaba despues nunca lo pisaba.
 * Misma expresion, letra por letra, en `public.is_placeholder_name` (00284).
 */
export const ID_NAME_PATTERN = "^\\+?[0-9]{8,}$";

/**
 * Un nombre que es el @usuario: lo que se guarda cuando el canal manda el
 * usuario pero no el nombre (`fallbackContactName`). Se ve mejor que un id y
 * deja que el nombre real lo reemplace cuando llegue.
 */
export const HANDLE_NAME_PATTERN = "^@[A-Za-z0-9._]+$";

const ID_NAME = new RegExp(ID_NAME_PATTERN);
const HANDLE_NAME = new RegExp(HANDLE_NAME_PATTERN);

/** Vacio o uno de la lista: lo mismo que mira la columna generada `is_anonymous` (00032). */
function isListedPlaceholder(name: string | null | undefined): boolean {
  const clean = normalize(name);
  return clean === "" || (PLACEHOLDER_NAMES as readonly string[]).includes(clean);
}

/** true si el nombre es un placeholder de la plataforma y no algo que alguien escribio. */
export function isPlaceholderName(name: string | null | undefined): boolean {
  const trimmed = (name ?? "").trim();
  return isListedPlaceholder(name) || ID_NAME.test(trimmed) || HANDLE_NAME.test(trimmed);
}

/**
 * El nombre con el que nace un contacto cuando el canal no manda uno: el
 * nombre si viene, si no "@usuario", si no el respaldo (el id de la
 * plataforma o un relleno). Los dos ultimos son placeholders: el nombre real
 * los reemplaza cuando la persona escribe.
 */
export function fallbackContactName(
  name: string | null | undefined,
  username: string | null | undefined,
  fallback: string,
): string {
  const nombre = (name ?? "").trim();
  if (nombre) return nombre;
  const usuario = (username ?? "").trim().replace(/^@+/, "");
  if (usuario) return `@${usuario}`;
  return fallback;
}

export interface ContactIdentity {
  display_name?: string | null;
  email?: string | null;
  secondary_email?: string | null;
  phone?: string | null;
  whatsapp_phone?: string | null;
  instagram_username?: string | null;
}

/**
 * Un contacto es anonimo cuando no hay con que reconocerlo: sin nombre propio
 * y sin ningun dato de contacto.
 *
 * Es sobre la IDENTIDAD, no sobre el trabajo hecho: un contacto anonimo con
 * tags, notas y vendedor asignado sigue siendo anonimo, porque sigue sin
 * saberse quien es.
 */
export function isAnonymousContact(contact: ContactIdentity): boolean {
  // La lista sola, sin el id ni el @usuario: es lo que calcula la columna
  // generada `is_anonymous`, y las dos tienen que decir lo mismo. Un contacto
  // con un @usuario como nombre ademas tiene `instagram_username`.
  return (
    isListedPlaceholder(contact.display_name) &&
    !contact.email &&
    !contact.secondary_email &&
    !contact.phone &&
    !contact.whatsapp_phone &&
    !contact.instagram_username
  );
}

export interface ProfileUpdate {
  display_name?: string;
  instagram_username?: string;
  avatar_url?: string;
}

/**
 * Que conviene actualizar de un contacto cuando llega un perfil nuevo del canal.
 *
 * La regla, en una linea: el canal escribe donde hay un hueco o donde el valor
 * que hay lo puso el propio canal como placeholder. Lo que escribio una
 * persona no se toca nunca.
 *
 * Devuelve solo lo que cambia. Un objeto vacio significa "no escribas": un
 * UPDATE que setea los mismos valores igual dispara el trigger de updated_at,
 * un evento de realtime y una entrada de audit por cada mensaje que entra.
 */
export function profileUpdateFor(
  actual: {
    display_name?: string | null;
    instagram_username?: string | null;
    avatar_url?: string | null;
  },
  entrante: {
    name?: string | null;
    username?: string | null;
    picture?: string | null;
  },
): ProfileUpdate {
  const update: ProfileUpdate = {};

  const nombre = (entrante.name ?? "").trim();
  if (nombre && !isPlaceholderName(nombre) && isPlaceholderName(actual.display_name)) {
    update.display_name = nombre;
  }

  // El @usuario solo se completa: uno tipeado por una persona gana siempre.
  const usuario = (entrante.username ?? "").trim().replace(/^@/, "").toLowerCase();
  if (usuario && !actual.instagram_username) {
    update.instagram_username = usuario;
  }

  // La foto tambien solo se completa. Las URLs del CDN de Instagram vencen,
  // asi que refrescarlas seria util, pero desde la columna no se distingue
  // una foto que importamos de una que subio alguien: mejor no pisar.
  const foto = (entrante.picture ?? "").trim();
  if (foto && !actual.avatar_url) {
    update.avatar_url = foto;
  }

  return update;
}
