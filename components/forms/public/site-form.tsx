"use client";

import { useMemo } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { PublicForm } from "./public-form";
import { flattenSearchParams } from "@/lib/forms/site-submit";
import type { PublicFormData } from "@/lib/forms/public-client";

/**
 * El formulario dentro de una página del sitio (F31). Lee la URL del lado del cliente
 * (`useSearchParams`, que el padre envuelve en `Suspense`) para que la página pueda
 * seguir siendo estática. Lo que fija el código (`prefill`) gana sobre la URL.
 */
export function SiteForm({ form, prefill }: { form: PublicFormData; prefill?: Record<string, string | number> }) {
  const search = useSearchParams();
  const pathname = usePathname();
  const params = useMemo(() => flattenSearchParams(search), [search]);
  return <PublicForm form={form} params={params} mode="site" sitePath={pathname} explicitPrefill={prefill} linkToken={params.c} />;
}
