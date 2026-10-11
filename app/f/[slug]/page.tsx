import type { Metadata } from "next";
import { CheckCircle2 } from "lucide-react";
import { brandLogoUrl, brandName } from "@/lib/brand";
import { createServiceClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth-user";
import { PublicForm } from "@/components/forms/public/public-form";
import { isAlreadyAnswered, loadPreviewFormData, loadPublicFormData } from "@/lib/forms/public-load";
import { isAvailable } from "@/lib/forms/public-client";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

/** Los parámetros de la URL como mapa plano: el primer valor de cada nombre. */
function flatten(params: SearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (typeof first === "string") out[key] = first;
  }
  return out;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const service = await createServiceClient();
  const form = await loadPublicFormData(service, slug);
  const title = isAvailable(form) ? form.design?.title : null;
  return { title: { absolute: title || brandName() } };
}

/**
 * `/f/[slug]` (F9). Lee la definición por `get_public_form` (lista blanca):
 * esta página nunca ve la configuración interna del formulario. Un formulario
 * en borrador, pausado, archivado o inexistente se ve igual: "no disponible".
 *
 * `?preview=1` muestra el borrador, pero solo a quien tiene sesión y puede ver
 * formularios (lo decide la RLS); para los demás es la página de siempre.
 */
export default async function PublicFormPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { slug } = await params;
  const query = flatten(await searchParams);

  const service = await createServiceClient();
  let form = await loadPublicFormData(service, slug);
  let preview = false;

  if (query.preview === "1") {
    const { supabase, user } = await getAuthUser();
    if (user) {
      const draft = await loadPreviewFormData(supabase, slug);
      if (draft) {
        form = draft;
        preview = true;
      }
    }
  }

  const embed = query.embed === "1" || query.embed === "true";

  if (!isAvailable(form)) {
    return (
      <main className="flex min-h-dvh items-center justify-center px-4">
        <p className="text-center text-muted-foreground">Este formulario no está disponible.</p>
      </main>
    );
  }

  // Una encuesta de "una vez por contacto" con el link firmado de quien ya respondió: se dice antes del formulario.
  if (!preview && form.type === "survey" && query.c && (await isAlreadyAnswered(service, slug, query.c))) {
    return (
      <main className={embed ? "px-1 py-1" : "px-4 py-8"}>
        <div className="mx-auto w-full max-w-[640px] py-10 text-center">
          <CheckCircle2 className="mx-auto h-12 w-12 text-green-500" aria-hidden="true" />
          <h1 className="mt-3 text-xl font-semibold">Ya respondiste, ¡gracias!</h1>
        </div>
      </main>
    );
  }

  const logo = form.design?.showLogo ? brandLogoUrl() : null;

  return (
    <main className={embed ? "px-1 py-1" : "px-4 py-8"}>
      {logo && !embed && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logo} alt={brandName()} className="mx-auto mb-6 h-10 w-auto" />
      )}
      <PublicForm form={form} params={query} mode={embed ? "embed" : "public_page"} preview={preview} linkToken={query.c} />
    </main>
  );
}
