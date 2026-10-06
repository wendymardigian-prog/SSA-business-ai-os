"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { BoardIdea } from "@/lib/content/board";
import { closeHref, drawerHref, type DrawerTarget } from "@/lib/content/drawer-url";
import type { PieceData } from "@/lib/content/load-piece";
import type { TaxonomyOptions } from "../classification-fields";
import { IdeaDrawer } from "./idea-drawer";
import { PieceDrawer } from "./piece-drawer";
import { ToastProvider, useToast } from "./toast";

/**
 * El cascaron de Contenido: los avisos y los drawers (F95, F96).
 *
 * Que drawer esta abierto lo dice la URL (`?idea=` / `?piece=`), y los datos de
 * la pieza vienen leidos por el servidor en esa misma pagina. Aca solo se
 * dibuja lo que la URL pide y se pasa de uno a otro:
 *
 *  - Pasar a otra idea, o de una idea a la pieza recien generada, REEMPLAZA la
 *    entrada del historial: apretar "atras" tiene que cerrar el drawer, no
 *    recorrer las veinte ideas que se revisaron.
 *  - Los avisos viven aca, afuera de los drawers: cuando uno se cierra (al
 *    descartar la ultima idea) el aviso tiene que seguir a la vista.
 *  - Al cerrar, el foco vuelve a la tarjeta que lo abrio. La tarjeta se
 *    recuerda al hacer clic (`data-card-id`) y no con `document.activeElement`:
 *    Safari no le da el foco a un link al clickearlo.
 */
export function ContentShell({
  target,
  ideas,
  piece,
  notice,
  userId,
  perms,
  platforms,
  taxonomy,
  aiAvailable,
  aiReason,
  children,
}: {
  target: DrawerTarget;
  /** Las ideas sin decidir, en el orden del tablero. */
  ideas: BoardIdea[];
  /** La pieza del drawer, ya leida; null si no hay o no se pudo leer. */
  piece: PieceData | null;
  /** Un aviso para mostrar al cargar (una pieza que no existe, por ejemplo). */
  notice?: string | null;
  userId: string;
  perms: { approve: boolean; ai: boolean };
  platforms: string[];
  taxonomy: TaxonomyOptions;
  aiAvailable: boolean;
  aiReason?: string;
  children: React.ReactNode;
}) {
  return (
    <ToastProvider>
      <Shell
        target={target}
        ideas={ideas}
        piece={piece}
        notice={notice}
        userId={userId}
        perms={perms}
        platforms={platforms}
        taxonomy={taxonomy}
        aiAvailable={aiAvailable}
        aiReason={aiReason}
      >
        {children}
      </Shell>
    </ToastProvider>
  );
}

function Shell({
  target,
  ideas,
  piece,
  notice,
  userId,
  perms,
  platforms,
  taxonomy,
  aiAvailable,
  aiReason,
  children,
}: Parameters<typeof ContentShell>[0]) {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();

  // La tarjeta que se toco por ultima vez: a ella vuelve el foco al cerrar.
  const lastCard = useRef<HTMLElement | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  const wasOpen = useRef(false);
  useEffect(() => {
    const open = target !== null;
    // Al abrirse (no al cambiar de una a otra) se fija a donde vuelve el foco.
    if (open && !wasOpen.current) {
      returnFocus.current = lastCard.current ?? (document.activeElement as HTMLElement | null);
    }
    wasOpen.current = open;
  }, [target]);

  // El aviso de la pagina (algo que se pidio y no existe) sale una vez.
  const shown = useRef<string | null>(null);
  useEffect(() => {
    if (notice && shown.current !== notice) {
      shown.current = notice;
      toast.push({ tone: "warning", text: notice });
    }
  }, [notice, toast]);

  const replaceTo = useCallback(
    (next: DrawerTarget) => router.replace(drawerHref(new URLSearchParams(params.toString()), next), { scroll: false }),
    [router, params],
  );

  const close = useCallback(
    () => router.replace(closeHref(new URLSearchParams(params.toString())), { scroll: false }),
    [router, params],
  );

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      onClickCapture={(event) => {
        const card = (event.target as HTMLElement).closest<HTMLElement>("[data-card-id]");
        if (card) lastCard.current = card;
      }}
    >
      {children}

      {target?.kind === "idea" && ideas.some((i) => i.id === target.id) && (
        <IdeaDrawer
          ideas={ideas}
          currentId={target.id}
          taxonomy={taxonomy}
          platforms={platforms}
          perms={perms}
          aiAvailable={aiAvailable}
          aiReason={aiReason}
          userId={userId}
          returnFocus={returnFocus}
          onOpenIdea={(id) => replaceTo({ kind: "idea", id })}
          onOpenPiece={(id) => replaceTo({ kind: "piece", id })}
          onClose={close}
        />
      )}

      {target?.kind === "piece" && piece && (
        <PieceDrawer key={piece.post.id} data={piece} returnFocus={returnFocus} onClose={close} />
      )}
    </div>
  );
}
