"use server";

import { revalidatePath } from "next/cache";
import { getPermissionAction } from "@/lib/auth/guards";
import { logAudit } from "@/lib/audit";
import { loadActiveMembers, loadAssignmentRules, loadContactChannel, loadValidContactIds } from "@/lib/jobs/handlers/sales-contact-eval";
import { dryRunAssignments, type DryRunRow } from "@/lib/assignment/dry-run";
import { checkRuleConfig } from "@/lib/assignment/rules";
import type { ContactForResolve } from "@/lib/assignment/resolve";
import { ASSIGNMENT_KINDS, ASSIGNMENT_MODES, type AssignmentKind, type AssignmentMode } from "@/lib/assignment/types";
import { manualAttribution } from "@/lib/attribution/attribution";
import { sanitizeSearch } from "@/lib/url-params";
import type { Json } from "@/lib/types/database";

/**
 * Reglas de asignación (Ajustes > Reglas de asignación, plano F13 y F16). Todo
 * pide `assignment.manage`, y lo repite la RLS de la 00161.
 *
 * El probador y la simulación en seco usan `resolveAssignments` (la misma
 * función que el job) y NO escriben: solo leen.
 */

const SETTINGS_PATH = "/dashboard/settings/asignacion";
const NOT_ALLOWED = "Solo quien puede cambiar la configuración maneja las reglas de asignación";

type Result<T = undefined> = ({ ok: true } & (T extends undefined ? object : { data: T })) | { ok: false; error: string };

export async function saveAssignmentRule(input: {
  kind: string;
  mode: string;
  enabledMemberIds?: string[];
  conditionRules?: unknown[];
}): Promise<Result> {
  const ctx = await getPermissionAction("assignment.manage");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const { workspace, supabase, user } = ctx;

  if (!(ASSIGNMENT_KINDS as readonly string[]).includes(input.kind)) return { ok: false, error: "Ese tipo de regla no existe" };
  if (!(ASSIGNMENT_MODES as readonly string[]).includes(input.mode)) return { ok: false, error: "Ese modo no existe" };
  const kind = input.kind as AssignmentKind;
  const mode = input.mode as AssignmentMode;

  const members = await loadActiveMembers(supabase, workspace.id);
  const checked = checkRuleConfig(
    { kind, mode, enabledMemberIds: input.enabledMemberIds ?? [], conditionRules: input.conditionRules ?? [] },
    members,
  );
  if (!checked.ok) return checked;

  const { data: before } = await supabase
    .from("assignment_rules")
    .select("id, mode, enabled_member_ids, condition_rules")
    .eq("workspace_id", workspace.id)
    .eq("kind", kind)
    .eq("entity_type", "contact")
    .maybeSingle();
  if (!before) return { ok: false, error: "No encontré esa regla" };

  const patch = {
    mode,
    enabled_member_ids: checked.enabledMemberIds,
    condition_rules: (mode === "condition_based" ? checked.conditionRules : []) as unknown as Json,
    updated_by: user.id,
  };
  const { error } = await supabase.from("assignment_rules").update(patch).eq("id", before.id).eq("workspace_id", workspace.id);
  if (error) {
    console.error("[assignment-rules] no pude guardar:", error.message);
    return { ok: false, error: "No pude guardar la regla" };
  }

  await logAudit({
    supabase,
    workspaceId: workspace.id,
    entityType: "assignment_rule",
    entityId: before.id,
    action: "assignment_rule.updated",
    changes: {
      mode: { old: before.mode, new: mode },
      enabled_member_ids: { old: (before.enabled_member_ids ?? []) as Json, new: checked.enabledMemberIds as Json },
      condition_rules: { old: `${Array.isArray(before.condition_rules) ? before.condition_rules.length : 0} reglas`, new: `${patch.mode === "condition_based" ? checked.conditionRules.length : 0} reglas` },
    },
    metadata: { kind },
    performedBy: user.id,
  });

  revalidatePath(SETTINGS_PATH);
  return { ok: true };
}

export interface ProbeInput {
  /** Un contacto existente… */
  contactId?: string;
  /** …o un toque cargado a mano (taxonomía cerrada). */
  touch?: { source?: string; medium?: string; campaign?: string; content?: string; term?: string };
  country?: string;
  channel?: string;
}

const CONTACT_COLUMNS =
  "id, setter_id, vendedor_id, referred_by_user_id, referred_by_contact_id, assignment_locked_at, attribution, country, email, phone, whatsapp_phone";

/** Probador: para cada tipo, a quién se asignaría y por qué regla. NO escribe. */
export async function probeAssignment(input: ProbeInput): Promise<Result<DryRunRow[]>> {
  const ctx = await getPermissionAction("assignment.manage");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const { workspace, supabase } = ctx;

  let contact: ContactForResolve;
  let channel: string | null = input.channel?.trim() || null;

  if (input.contactId) {
    const { data } = await supabase
      .from("contacts")
      .select(CONTACT_COLUMNS)
      .eq("id", input.contactId)
      .eq("workspace_id", workspace.id)
      .is("deleted_at", null)
      .maybeSingle();
    if (!data) return { ok: false, error: "No encontré ese contacto" };
    contact = data as unknown as ContactForResolve;
    channel = channel ?? (await loadContactChannel(supabase, data.id));
  } else {
    // Un toque de prueba: source obligatorio y de la taxonomía; el resto, libre.
    const parsed = manualAttribution({ source: input.touch?.source, ...input.touch });
    if (!parsed.ok) return { ok: false, error: parsed.error };
    const { touch_id: _ignored, ...touch } = parsed.attribution;
    void _ignored;
    contact = {
      setter_id: null, vendedor_id: null, referred_by_user_id: null, referred_by_contact_id: null, assignment_locked_at: null,
      attribution: { version: 2, first_touch: touch, last_touch: touch },
      country: input.country?.trim() || null, email: null, phone: null, whatsapp_phone: null,
    };
  }

  const rules = await loadAssignmentRules(supabase, workspace.id);
  const [members, validContactIds] = await Promise.all([loadActiveMembers(supabase, workspace.id), loadValidContactIds(supabase, workspace.id, rules)]);
  return { ok: true, data: dryRunAssignments(contact, rules, members, { channel, validContactIds }) };
}

export interface SimulationRow {
  contactId: string;
  name: string;
  rows: DryRunRow[];
}

/** Simulación en seco: los últimos 50 contactos, lo que tienen y lo que asignaría la regla. NO escribe. */
export async function simulateAssignments(): Promise<Result<SimulationRow[]>> {
  const ctx = await getPermissionAction("assignment.manage");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const { workspace, supabase } = ctx;

  const { data: contacts } = await supabase
    .from("contacts")
    .select(`${CONTACT_COLUMNS}, display_name`)
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(50);

  const rules = await loadAssignmentRules(supabase, workspace.id);
  const [members, validContactIds] = await Promise.all([loadActiveMembers(supabase, workspace.id), loadValidContactIds(supabase, workspace.id, rules)]);

  const out: SimulationRow[] = [];
  for (const c of contacts ?? []) {
    const channel = await loadContactChannel(supabase, c.id);
    out.push({
      contactId: c.id,
      name: (c as { display_name?: string | null }).display_name?.trim() || "Sin nombre",
      rows: dryRunAssignments(c as unknown as ContactForResolve, rules, members, { channel, validContactIds }),
    });
  }
  return { ok: true, data: out };
}

export interface RuleContactOption {
  id: string;
  name: string;
  email: string | null;
}

/** El buscador de contactos del probador y del destino "contacto" de un referido. Con el cliente de la persona: la RLS acota lo que ve. */
export async function searchContactsForRules(query: string): Promise<RuleContactOption[]> {
  const ctx = await getPermissionAction("assignment.manage");
  if (!ctx) return [];
  const q = sanitizeSearch(query, 60);
  if (q.length < 2) return [];
  const { data } = await ctx.supabase
    .from("contacts")
    .select("id, display_name, email")
    .eq("workspace_id", ctx.workspace.id)
    .is("deleted_at", null)
    .or(`display_name.ilike.%${q}%,email.ilike.%${q}%`)
    .order("display_name", { ascending: true })
    .limit(8);
  return (data ?? []).map((c) => ({ id: c.id, name: c.display_name || c.email || "Sin nombre", email: c.email ?? null }));
}
