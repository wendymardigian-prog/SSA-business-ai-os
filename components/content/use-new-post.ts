"use client";

import { useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createPost } from "@/lib/actions/content";
import { drawerHref } from "@/lib/content/drawer-url";
import { NEW_POST_TITLE } from "@/lib/content/new-post";
import { useToast } from "./drawer/toast";

/**
 * "Nuevo post": crea el borrador y abre su drawer, sin formulario aparte.
 *
 * Lo usan el boton de la barra y el "+ Post" del tablero. Todo lo que antes
 * pedia el modal (formato, redes, idea de origen, generar con IA) se elige ya
 * adentro del drawer, con el guardado automatico de siempre. Los avisos salen
 * por el `ToastProvider` del cascaron de Contenido, que queda a la vista si el
 * drawer no llega a abrirse.
 */
export function useNewPost() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const [pending, start] = useTransition();

  function create() {
    if (pending) return;
    start(async () => {
      const result = await createPost({ title: NEW_POST_TITLE });
      if (!result.ok) {
        toast.push({ tone: "error", text: result.error });
        return;
      }
      router.push(drawerHref(new URLSearchParams(params.toString()), { kind: "piece", id: result.data.id }), {
        scroll: false,
      });
      router.refresh();
    });
  }

  return { create, pending };
}
