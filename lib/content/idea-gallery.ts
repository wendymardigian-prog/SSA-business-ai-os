/**
 * La galeria de ideas del drawer (F95).
 *
 * Se revisan las ideas una atras de otra sin cerrar el drawer: descartar o
 * aprobar abre la siguiente. Aca esta lo que decide eso, sin React ni base:
 * donde esta la persona ("2 de 3"), cual se abre despues, y el aviso de cada
 * accion. La pantalla solo lo ejecuta.
 */

export interface GalleryPosition {
  index: number;
  total: number;
  /** "2 de 3" */
  label: string;
  prevId: string | null;
  nextId: string | null;
}

export function galleryPosition(ids: string[], currentId: string): GalleryPosition | null {
  const index = ids.indexOf(currentId);
  if (index === -1) return null;

  return {
    index,
    total: ids.length,
    label: `${index + 1} de ${ids.length}`,
    prevId: index > 0 ? ids[index - 1] : null,
    nextId: index < ids.length - 1 ? ids[index + 1] : null,
  };
}

/**
 * Cual se abre despues de sacar una (descartada o aprobada).
 *
 * La que sigue; si era la ultima de la lista pero quedan otras, la anterior:
 * cerrar el drawer con ideas todavia por revisar seria cortar la secuencia sin
 * motivo. Null solo cuando no queda ninguna.
 */
export function nextAfterRemoval(ids: string[], removedId: string): string | null {
  const index = ids.indexOf(removedId);
  const rest = ids.filter((id) => id !== removedId);
  if (rest.length === 0) return null;
  if (index === -1) return rest[0];
  return rest[Math.min(index, rest.length - 1)];
}

export type GalleryAction = "approve" | "approve_and_generate" | "discard";

export interface GalleryToast {
  tone: "ok" | "info" | "warning";
  text: string;
}

export type GalleryStep =
  | { kind: "idea"; id: string; toast: GalleryToast }
  | { kind: "piece"; id: string; toast: GalleryToast }
  | { kind: "close"; toast: GalleryToast };

/**
 * Que hace el drawer despues de una accion.
 *
 *  - Descartar y Aprobar siguen con la proxima idea; si no queda ninguna, el
 *    drawer se CIERRA con un aviso y no queda en blanco.
 *  - "Aprobar y producir copy" rompe la secuencia: abre la PIEZA generada en
 *    el mismo drawer, aunque queden ideas, porque lo que sigue es revisar el
 *    guion que escribe la IA.
 */
export function stepAfter(
  action: GalleryAction,
  ids: string[],
  currentId: string,
  result: { postId?: string; copyQueued?: boolean; copyError?: string },
): GalleryStep {
  if (action === "approve_and_generate" && result.postId) {
    const failed = result.copyQueued === false && result.copyError;
    return {
      kind: "piece",
      id: result.postId,
      toast: failed
        ? { tone: "warning", text: `Aprobada, pero el copy no salió: ${result.copyError}` }
        : { tone: "ok", text: "Aprobada. El copywriter está escribiendo el guion." },
    };
  }

  const next = nextAfterRemoval(ids, currentId);
  const done = action === "discard" ? "Idea descartada" : "Pieza creada en Borrador";

  if (next) return { kind: "idea", id: next, toast: { tone: "ok", text: done } };

  return {
    kind: "close",
    toast: {
      tone: "ok",
      text:
        action === "discard"
          ? "Descartaste la última idea: no quedan ideas por revisar."
          : "Aprobaste la última idea: no quedan ideas por revisar.",
    },
  };
}

/**
 * Si se puede editar esa idea: quien aprueba edita cualquiera, y un Member las
 * suyas (es lo que dejan hacer las policies de la 00083; la pantalla solo evita
 * ofrecer campos que van a fallar).
 */
export function canEditIdea(input: { approve: boolean; createdBy: string | null; userId: string }): boolean {
  return input.approve || input.createdBy === input.userId;
}
