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
import { ConversationRulesView } from "@/components/inbox/assignment/conversation-rules-view";
import { orderRules, ruleFromRow } from "@/lib/inbox/assignment-rules";
import { buildAccounts } from "@/lib/inbox/accounts";
import { KnownAssignmentView } from "@/components/inbox/assignment/known-assignment-view";
import { parseKnownSettings } from "@/lib/inbox/known";

/**
 * Ajustes -> Reglas de asignación: quién queda como responsable de cada
 * conversación nueva según su cuenta (00255), y cómo se asignan solos el setter,
 * el vendedor y el referido de un contacto. Pide `assignment.manage`. Todas las reglas arrancan en
 * manual; el probador y la simulación en seco muestran qué haría cada una sin
 * escribir nada.
 */
export default async function AsignacionSettingsPage() {
  const { workspace, supabase } = await requirePermission("assignment.manage");

  const [rules, members, conversationRulesRes, channelsRes] = await Promise.all([
    loadAssignmentRules(supabase, workspace.id),
    getWorkspaceMembers(workspace.id),
    // Reglas de conversaciones (00255): la RLS deja leer a cualquier miembro; la pagina ya pidio la clave.
    supabase
      .from("conversation_assignment_rules")
      .select("id, name, position, enabled, channel_ids, mode, member_ids, last_assigned_member_id, setter_mode, archived_at")
      .eq("workspace_id", workspace.id)
      .is("archived_at", null)
      .order("position"),
    supabase.from("channels").select("id, platform, provider, username, display_name").eq("workspace_id", workspace.id).eq("is_active", true),
  ]);
  if (conversationRulesRes.error) console.error("[asignacion] no pude leer las reglas de conversaciones:", conversationRulesRes.error.message);
  const conversationRules = orderRules((conversationRulesRes.data ?? []).map(ruleFromRow));
  const ruleAccounts = buildAccounts(channelsRes.data ?? []);

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
      <section aria-label="Reglas de asignación" className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6 md:px-8">
        <div>
          <h2 id="conversaciones-title" className="text-base font-semibold">
            Conversaciones
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Quién queda como responsable de cada conversación nueva, según la cuenta por la que entra. Gana la primera regla que coincide, en
            este orden. Lo que ya tiene responsable no se toca.
          </p>
        </div>
        <ConversationRulesView rules={conversationRules} accounts={ruleAccounts} members={memberOptions} />

        <div className="border-t border-border pt-6">
          <h2 className="text-base font-semibold">Conocidos</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Cuando alguien se marca como conocido, sus chats van a la persona de la cuenta por la que escribe (antes que las reglas de arriba).
          </p>
        </div>
        <KnownAssignmentView
          settings={parseKnownSettings(workspace.known_contacts_settings)}
          accounts={ruleAccounts}
          members={memberOptions}
          ownerName={members.find((m) => m.role === "owner")?.name ?? null}
        />

        <div className="border-t border-border pt-6">
          <h2 id="asignacion-title" className="text-base font-semibold">
            Contactos: setter, vendedor y referido
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
