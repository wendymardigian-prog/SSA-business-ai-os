import { getPermissionContext } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { BackLink } from "@/components/forms/back-link";
import { EodFill } from "@/components/eod/fill/eod-fill";
import { loadFillPage } from "@/lib/eod/load";

export const dynamic = "force-dynamic";

/**
 * Completar un reporte de fin de día (E6). La persona es la de la sesión, nunca un selector.
 * `?fecha=AAAA-MM-DD` opcional; sin fecha, es HOY en la zona horaria de la persona.
 */
export default async function EodFillPage({ params, searchParams }: { params: Promise<{ formId: string }>; searchParams: Promise<{ fecha?: string }> }) {
  const ctx = await getPermissionContext();
  const [{ formId }, { fecha }] = await Promise.all([params, searchParams]);
  const service = await createServiceClient();
  const result = await loadFillPage(service, { workspaceId: ctx.workspace.id, userId: ctx.user.id, formId, fecha: fecha ?? null });

  if (!result.ok) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <PageHeader route="/dashboard/eod/[formId]" backHref={<BackLink href="/dashboard/eod" label="Volver a Mi reporte del día" />} />
        <div className="mx-auto max-w-md px-4 py-16 text-center">
          <p className="font-medium">{result.reason === "date" ? "Ese día no se puede reportar" : "Este reporte no está disponible para vos"}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {result.reason === "date" ? "Elegí un día dentro del rango permitido (nunca un día futuro)." : "Puede que no esté publicado o que no te toque completarlo."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title={result.data.form.name} route="/dashboard/eod/[formId]" backHref={<BackLink href="/dashboard/eod" label="Volver a Mi reporte del día" />} />
      <EodFill key={`${result.data.form.id}:${result.data.reportDate}`} page={result.data} />
    </div>
  );
}
