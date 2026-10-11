import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requirePermission } from "@/lib/auth/guards";
import { PageHeader } from "@/components/page-header";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { AssignmentRulesView, type RuleCardData } from "@/components/sales/assignment/assignment-rules-view";
import { AssignmentTester } from "@/components/sales/assignment/assignment-tester";
import { loadAssignmentRules } from "@/lib/jobs/handlers/sales-contact-eval";
import { ASSIGNMENT_KINDS } from "@/lib/sales/assignment/types";
import { getWorkspaceMembers } from "@/lib/workspace-members";

/**
 * Ajustes -> Reglas de asignación: cómo se asignan solos el setter, el vendedor y
 * el referido de un contacto. Pide `settings.manage`. Todas las reglas arrancan en
 * manual; el probador y la simulación en seco muestran qué haría cada una sin
 * escribir nada.
 */
export default async function AsignacionSettingsPage() {
  const { workspace, supabase } = await requirePermission("settings.manage");

  const [rules, members] = await Promise.all([loadAssignmentRules(supabase, workspace.id), getWorkspaceMembers(workspace.id)]);

  const cards: RuleCardData[] = ASSIGNMENT_KINDS.flatMap((kind) => {
    const rule = rules[kind];
    return rule ? [{ id: rule.id, kind, mode: rule.mode, enabledMemberIds: rule.enabled_member_ids, conditionRules: rule.condition_rules }] : [];
  });

  // Los nombres de los contactos que son destino de una regla (referido a un contacto).
  const contactIds = [...new Set(cards.flatMap((c) => c.conditionRules.flatMap((r) => (r.destination.type === "contact" ? [r.destination.contact_id] : []))))];
  const { data: contacts } = contactIds.length
    ? await supabase.from("contacts").select("id, display_name, email").eq("workspace_id", workspace.id).in("id", contactIds)
    : { data: [] };
  const contactNames = Object.fromEntries((contacts ?? []).map((c) => [c.id, c.display_name || c.email || "Sin nombre"]));
  const memberOptions = members.map((m) => ({ userId: m.userId, label: m.name }));

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        route="/dashboard/settings/asignacion"
        backHref={
          <Link href="/dashboard/settings" aria-label="Volver a Ajustes" className="-ml-1 rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        }
      />
      <SettingsTabs />
      <div className="min-h-0 flex-1 overflow-auto">
      <section aria-labelledby="asignacion-title" className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6 md:px-8">
        <div>
          <h2 id="asignacion-title" className="text-base font-semibold">
            Reglas de asignación
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Quién queda como setter, vendedor o referido de un contacto cuando entra o cambia su atribución. Lo que alguien asigna a mano no se
            pisa nunca. Todas las reglas arrancan en manual.
          </p>
        </div>
        <AssignmentRulesView cards={cards} members={memberOptions} contactNames={contactNames} />
        <AssignmentTester members={memberOptions} contactNames={contactNames} />
      </section>
      </div>
    </div>
  );
}
