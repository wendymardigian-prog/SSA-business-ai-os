/**
 * Los leads de una pieza, por el camino del comentario (F104, D3).
 *
 * Un lead de una publicacion es un contacto cuyo PRIMER toque fue un comentario
 * en esa publicacion. Eso es lo unico que hoy se puede afirmar con honestidad:
 * el sistema registra el comentario con la publicacion exacta (F86). **No** se
 * intenta atribuir desde un mensaje directo por palabra clave: no hay forma
 * confiable de saber que publicacion origino un DM, y adivinarlo seria peor que
 * no mostrarlo.
 *
 * Reglas del archivo:
 *
 * 1. **Primer toque, no cualquier toque.** Si la persona ya era contacto (llego
 *    por un DM el mes pasado), su comentario de hoy no la trajo: no cuenta.
 * 2. **Una persona cuenta una vez por pieza.** Quien comento dos publicaciones
 *    de la misma pieza es un lead, no dos, y se queda con la publicacion donde
 *    llego primero.
 * 3. **Sin red que lo registre, no hay cero.** Instagram y TikTok vinculan
 *    comentarios con contactos; YouTube, LinkedIn y Threads no. Un cero ahi
 *    diria "nadie llego", cuando la verdad es "no lo medimos".
 *
 * Modulo PURO: recibe los toques ya leidos.
 */

/** Un toque de un contacto, con lo que hace falta para atribuirlo. */
export interface LeadTouch {
  contactId: string;
  /** ISO 8601. */
  occurredAt: string;
  origin: string | null;
  medium: string | null;
  socialPostId: string | null;
  contentPostId: string | null;
}

export interface PieceLeads {
  /** Contactos distintos que llegaron por esta pieza. */
  total: number;
  /** Cuantos llegaron por cada publicacion (id de `social_posts`). */
  byPublication: Record<string, number>;
  /** Llegaron por la pieza pero su publicacion ya no esta entre las conocidas. */
  unassigned: number;
}

/**
 * Las redes cuyos comentarios el sistema vincula con un contacto.
 *
 * Tiene que coincidir con `lib/comments/attribution.ts`: ahi se decide en que
 * redes un comentario puede ser un toque. No se importa de ahi a proposito: ese
 * modulo trae el cliente del servidor y esto lo usa la pantalla.
 */
export const LEAD_TRACKED_PLATFORMS: readonly string[] = ["instagram", "tiktok"];

export function leadsTracked(platform: string): boolean {
  return LEAD_TRACKED_PLATFORMS.includes(platform);
}

const isComment = (touch: LeadTouch) => touch.origin === "comment" || touch.medium === "comment";

/** El primer toque de cada contacto: el mas antiguo (con empate, el primero que llego). */
function firstTouches(touches: LeadTouch[]): LeadTouch[] {
  const byContact = new Map<string, LeadTouch>();
  for (const touch of touches) {
    const current = byContact.get(touch.contactId);
    if (!current || touch.occurredAt < current.occurredAt) byContact.set(touch.contactId, touch);
  }
  return [...byContact.values()];
}

export function pieceLeads(params: {
  pieceId: string;
  /** Los `social_posts.id` de las publicaciones de la pieza. */
  publicationIds: string[];
  touches: LeadTouch[];
}): PieceLeads {
  const known = new Set(params.publicationIds);
  const byPublication: Record<string, number> = {};
  let total = 0;
  let unassigned = 0;

  for (const touch of firstTouches(params.touches)) {
    if (!isComment(touch)) continue;

    const ofThisPiece =
      touch.contentPostId === params.pieceId || (touch.socialPostId !== null && known.has(touch.socialPostId));
    if (!ofThisPiece) continue;

    total += 1;
    if (touch.socialPostId !== null && known.has(touch.socialPostId)) {
      byPublication[touch.socialPostId] = (byPublication[touch.socialPostId] ?? 0) + 1;
    } else {
      unassigned += 1;
    }
  }

  return { total, byPublication, unassigned };
}

/**
 * El numero de una publicacion, o null para mostrar el hueco.
 *
 * Una publicacion que ya salio en una red que lo mide, con cero leads, es un
 * cero real. Una red que no lo mide no es un cero: es un hueco.
 */
export function leadsForPublication(
  leads: PieceLeads,
  socialPostId: string,
  options: { tracked?: boolean } = {},
): number | null {
  if (options.tracked === false) return null;
  return leads.byPublication[socialPostId] ?? 0;
}

/** Suma lo que hay y deja el hueco si no hay nada que sumar. */
export function sumLeads(values: Array<number | null>): number | null {
  const present = values.filter((v): v is number => v !== null);
  return present.length > 0 ? present.reduce((a, b) => a + b, 0) : null;
}
