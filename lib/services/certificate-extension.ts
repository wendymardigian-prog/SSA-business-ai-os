// @plantilla-quitar(servicios)
/**
 * Lo que el módulo de Servicios le suma al Diseñador IA (§9.3 del Diseñador, F66 y F68), por sus puntos de extensión:
 *   - el grupo de variables «Servicio» (`service.*`) y el origen de sujeto «Servicio»;
 *   - la suscripción a `onDesignGenerated`, que completa el paso Certificado y emite `certificate_issued`.
 * Se registra una sola vez por proceso (`registerServiceDesignExtensions` es idempotente). Lo llaman el arranque de la
 * cola (donde corre el render que avisa) y la generación (donde se resuelven las variables).
 *
 * Nada de servidor se importa arriba (`lib/supabase/server` trae `next/headers`): se importa al usarlo.
 */
import { onDesignGenerated, registerDesignVariables, type SubjectRef } from "@/lib/designer/extensions";
import { isServiceSubject, serviceDesignValues, SERVICE_DESIGN_VARS, type ServiceForCertificate } from "@/lib/services/certificate";

let registered = false;

async function resolveServiceValues(ctx: { workspaceId: string; subject: SubjectRef | null }): Promise<Record<string, string>> {
  if (!isServiceSubject(ctx.subject)) return {};
  const [{ createServiceClient }, { svcSchema }, { getWorkspaceMembers }] = await Promise.all([
    import("@/lib/supabase/server"),
    import("@/lib/services/db"),
    import("@/lib/workspace-members"),
  ]);
  const db = await createServiceClient();
  const { data } = await svcSchema(db)
    .from("services")
    .select("id, status, starts_on, ends_on, completed_at, product_snapshot, product_variant_id, owner_user_id")
    .eq("id", ctx.subject.id)
    .eq("workspace_id", ctx.workspaceId)
    .maybeSingle();
  const s = data as (ServiceForCertificate & { product_variant_id: string | null; owner_user_id: string | null }) | null;
  if (!s) return {};
  const [variant, members, tz] = await Promise.all([
    s.product_variant_id ? db.from("product_variants").select("name").eq("id", s.product_variant_id).maybeSingle() : Promise.resolve({ data: null }),
    s.owner_user_id ? getWorkspaceMembers(ctx.workspaceId) : Promise.resolve([]),
    db.from("workspaces").select("timezone").eq("id", ctx.workspaceId).maybeSingle(),
  ]);
  const zone = (tz.data as { timezone?: string | null } | null)?.timezone || "UTC";
  const completedOn = s.completed_at ? new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(s.completed_at)) : null;
  return serviceDesignValues(s, {
    variantName: (variant.data as { name?: string } | null)?.name ?? null,
    ownerName: members.find((m) => m.userId === s.owner_user_id)?.name ?? null,
    completedOn,
  });
}

export function registerServiceDesignExtensions(): void {
  if (registered) return;
  registered = true;
  registerDesignVariables({
    group: "service",
    label: "Servicio",
    source: "Servicio",
    vars: SERVICE_DESIGN_VARS.map((v) => ({ key: v.key, label: v.label, sample: v.sample })),
    resolve: resolveServiceValues,
  });
  onDesignGenerated(async (design) => {
    if (!isServiceSubject(design.subjectRef)) return;
    const [{ createServiceClient }, { handleCertificateGenerated }] = await Promise.all([import("@/lib/supabase/server"), import("@/lib/services/certificate-core")]);
    await handleCertificateGenerated((await createServiceClient()) as never, design);
  });
}
