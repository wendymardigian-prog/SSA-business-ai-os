import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/guards";
import { resolveViewerTimezone } from "@/lib/user-timezone";
import { ContactFormsList } from "@/components/contacts/forms-section";
import { PageHeader } from "@/components/page-header";
import { loadContactForms } from "@/lib/forms/data/contact-forms";
import { totalLabel } from "@/lib/forms/contact-forms";
import { FORM_LIMITS } from "@/lib/forms/limits";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Todas las respuestas de formularios de un contacto (R8, "Ver todas"). Lee con el cliente de la persona: la RLS
 * decide qué contacto y qué respuestas ve; las marcadas como spam no aparecen.
 */
export default async function ContactFormsPage({
  params,
  searchParams,
}: {
  params: Promise<{ contactId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requirePermission("forms.view");
  const { contactId } = await params;
  if (!UUID.test(contactId)) notFound();
  const { supabase, workspace } = ctx;
  const sp = await searchParams;
  const rawPage = Number(Array.isArray(sp.pagina) ? sp.pagina[0] : sp.pagina);
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const pageSize = FORM_LIMITS.pageSize;

  const { data: contact } = await supabase
    .from("contacts")
    .select("id, display_name, email")
    .eq("id", contactId)
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!contact) notFound();

  const timeZone = await resolveViewerTimezone(workspace.timezone);
  const { rows, total } = await loadContactForms(supabase, { workspaceId: workspace.id, contactId, limit: pageSize, offset: (page - 1) * pageSize });
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const name = contact.display_name || contact.email || "Contacto sin nombre";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title={`Formularios de ${name}`} tooltip="Todas las respuestas de formularios de este contacto." />
      <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
        <p className="mb-3 text-sm">
          <Link href={`/dashboard/contacts/${contact.id}`} className="text-primary underline-offset-2 hover:underline">
            Volver a la ficha
          </Link>
          <span className="ml-3 text-muted-foreground">{totalLabel(total)}</span>
        </p>
        {rows.length === 0 ? <p className="text-sm text-muted-foreground">Todavía no respondió ningún formulario.</p> : <ContactFormsList rows={rows} timeZone={timeZone} />}
        {pages > 1 && (
          <nav aria-label="Páginas" className="mt-4 flex items-center gap-3 text-sm">
            {page > 1 && (
              <Link href={`/dashboard/contacts/${contact.id}/formularios?pagina=${page - 1}`} className="underline-offset-2 hover:underline">
                ← Anterior
              </Link>
            )}
            <span className="text-muted-foreground">
              Página {page} de {pages}
            </span>
            {page < pages && (
              <Link href={`/dashboard/contacts/${contact.id}/formularios?pagina=${page + 1}`} className="underline-offset-2 hover:underline">
                Siguiente →
              </Link>
            )}
          </nav>
        )}
      </div>
    </div>
  );
}
