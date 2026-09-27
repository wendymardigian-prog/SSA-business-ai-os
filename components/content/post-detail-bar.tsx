"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { archivePost } from "@/lib/actions/content-review";

/**
 * Editar y Archivar, en la barra del detalle (C16).
 *
 * Estaban al final del cuerpo, después de todo lo demás: en una pieza con
 * cinco redes había que bajar hasta abajo para editarla. Son las dos cosas
 * que se hacen desde acá, así que van arriba.
 */
export function PostDetailBar({
  postId,
  canArchive,
}: {
  postId: string;
  canArchive: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <div className="flex items-center gap-2">
      <Link
        href={`/dashboard/content/${postId}/edit`}
        className="inline-flex h-9 items-center rounded-lg border border-border px-3 text-sm font-medium hover:bg-accent"
      >
        Editar
      </Link>
      {canArchive && (
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (!window.confirm("¿Archivar esta pieza? Sale del tablero y queda en el historial.")) {
              return;
            }
            start(async () => {
              const result = await archivePost({ postId });
              if (result.ok) router.push("/dashboard/content");
              else window.alert(result.error);
            });
          }}
          className="inline-flex h-9 items-center rounded-lg px-3 text-sm text-muted-foreground hover:bg-accent disabled:opacity-50"
        >
          Archivar
        </button>
      )}
    </div>
  );
}
