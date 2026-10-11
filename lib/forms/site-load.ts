/**
 * La definición pública de un formulario para una página del SITIO (F31). SOLO servidor.
 *
 * Una página del sitio puede ser estática: la definición se lee con la misma puerta de
 * siempre (`get_public_form`, lista blanca) pero con caché por etiqueta `form:<slug>`.
 * Publicar, pausar o archivar el formulario invalida esa etiqueta desde su Server Action,
 * así la página muestra la versión vigente sin volver a desplegar.
 *
 * Con un respaldo de 1 hora por si una invalidación se perdiera (un deploy, un reinicio).
 */
import { unstable_cache } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { loadPublicFormData } from "./public-load";
import type { PublicFormResult } from "./public-client";

export const SITE_FORM_REVALIDATE_SECONDS = 3600;

/** La etiqueta de caché de un formulario. */
export function formCacheTag(slug: string): string {
  return `form:${slug.toLowerCase()}`;
}

export function loadSiteForm(slug: string): Promise<PublicFormResult> {
  return unstable_cache(
    async (): Promise<PublicFormResult> => {
      const service = await createServiceClient();
      return loadPublicFormData(service, slug);
    },
    ["site-form", slug.toLowerCase()],
    { tags: [formCacheTag(slug)], revalidate: SITE_FORM_REVALIDATE_SECONDS },
  )();
}
