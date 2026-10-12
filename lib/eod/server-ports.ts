/**
 * Los puertos reales del reporte de fin de día: la base con el cliente de servicio (después
 * de que la acción comprobó la sesión), las dos RPC y el aviso en la campana.
 * Solo servidor: nunca lo importa un Client Component.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import { createNotification } from "@/lib/notifications/create";
import { memberDisplayName } from "@/lib/workspace-members";
import { isValidTimeZone } from "@/lib/timezone";
import { parseStoredEodConfig } from "./config";
import { eodParts } from "./definition";
import { storedDraft } from "./draft-shape";
import type { LabeledAnswer } from "@/lib/forms/submission-schema";
import type { FormDefinition } from "@/lib/forms/fields";
import { notificationTitle, type EodFormContext, type EodPorts, type EodReportState, type SaveRpcResult, type SubmitRpcResult, type SubmittedChannels } from "./submit";

type Db = SupabaseClient<Database>;

export async function loadEodForm(db: Db, formId: string): Promise<EodFormContext | null> {
  if (!/^[0-9a-f-]{36}$/i.test(formId)) return null;
  const { data: form } = await db
    .from("forms")
    .select("id, workspace_id, name, type, status, eod_config, current_version_id")
    .eq("id", formId)
    .maybeSingle();
  if (!form || form.type !== "eod") return null;
  const config = parseStoredEodConfig(form.eod_config);
  if (!config) return null;
  let version: EodFormContext["version"] = null;
  if (form.current_version_id) {
    const { data: row } = await db.from("form_versions").select("id, version_number, definition").eq("id", form.current_version_id).maybeSingle();
    if (row) {
      const parts = eodParts(row.definition as unknown as Partial<FormDefinition>);
      version = { id: row.id, number: row.version_number, fields: parts.fields, channelSelector: parts.channelSelector, channels: parts.channels };
    }
  }
  return { id: form.id, workspaceId: form.workspace_id, name: form.name, status: form.status, config, version };
}

export interface EodTeamMember {
  userId: string;
  /** El rol para la audiencia: el personalizado, o la fila del rol de sistema que le toca. */
  roleId: string | null;
  isMember: boolean;
  name: string;
  email: string;
}

/**
 * El equipo con el rol que cuenta para la audiencia: su rol personalizado, o la fila del rol
 * de sistema que le corresponde (Owner, Admin o Member). Así "Roles elegidos" incluye los de
 * sistema. Una consulta para los perfiles (00141) y otra para los roles de sistema.
 */
export async function loadTeam(db: Db, workspaceId: string): Promise<EodTeamMember[]> {
  const [{ data: profiles, error }, { data: systemRoles }] = await Promise.all([
    db.rpc("workspace_member_profiles", { p_workspace_id: workspaceId }),
    db.from("workspace_roles").select("id, system_role").eq("workspace_id", workspaceId).not("system_role", "is", null),
  ]);
  if (error || !profiles) {
    console.error(`[eod] no pude leer el equipo (code=${error?.code ?? "?"})`);
    return [];
  }
  const systemId = new Map((systemRoles ?? []).map((r) => [r.system_role as string, r.id]));
  return profiles.map((p) => ({
    userId: p.user_id,
    roleId: p.role_id ?? systemId.get(p.role) ?? null,
    isMember: true,
    name: memberDisplayName(p.full_name, p.meta_name, p.email),
    email: p.email ?? "",
  }));
}

export async function loadAudienceMember(db: Db, workspaceId: string, userId: string): Promise<EodTeamMember | null> {
  return (await loadTeam(db, workspaceId)).find((m) => m.userId === userId) ?? null;
}

/** La zona horaria de una persona: la suya (user_preferences), o la del workspace, o UTC. */
export async function timezoneOfUser(db: Db, userId: string, workspaceId: string): Promise<string> {
  const { data: pref } = await db.from("user_preferences").select("timezone").eq("user_id", userId).maybeSingle();
  if (pref?.timezone && isValidTimeZone(pref.timezone)) return pref.timezone;
  const { data: ws } = await db.from("workspaces").select("timezone").eq("id", workspaceId).maybeSingle();
  return ws?.timezone && isValidTimeZone(ws.timezone) ? ws.timezone : "UTC";
}

export async function loadReportState(db: Db, formId: string, userId: string, reportDate: string): Promise<EodReportState | null> {
  const { data: row } = await db
    .from("eod_reports")
    .select("id, status, rev, saved_at, answers, channels, pending_edit, edit_count")
    .eq("form_id", formId)
    .eq("user_id", userId)
    .eq("report_date", reportDate)
    .maybeSingle();
  if (!row) return null;
  const submitted = row.status === "submitted";
  const pending = (row.pending_edit ?? null) as { answers?: unknown; channels?: unknown } | null;
  return {
    id: row.id,
    status: row.status,
    rev: row.rev,
    savedAt: row.saved_at,
    draft: submitted ? (pending ? storedDraft(pending.answers, pending.channels) : submittedToDraft(row.answers, row.channels)) : storedDraft(row.answers, row.channels),
    submitted: submitted ? { answers: (row.answers ?? {}) as unknown as Record<string, LabeledAnswer>, channels: (row.channels ?? {}) as unknown as SubmittedChannels } : null,
    editCount: row.edit_count,
  };
}

/** Un reporte enviado vuelto borrador (para corregirlo): solo los valores. */
export function submittedToDraft(answers: unknown, channels: unknown) {
  const values = (labeled: unknown) =>
    Object.fromEntries(Object.entries((labeled ?? {}) as Record<string, { value?: unknown }>).map(([k, a]) => [k, (a?.value ?? null) as never]));
  const ch = Object.fromEntries(
    Object.entries((channels ?? {}) as Record<string, { answers?: unknown }>).map(([k, c]) => [k, { selected: true, answers: values(c?.answers) }]),
  );
  return storedDraft(values(answers), ch);
}

export function eodPorts(db: Db): EodPorts {
  return {
    loadForm: (formId) => loadEodForm(db, formId),
    loadMember: (workspaceId, userId) => loadAudienceMember(db, workspaceId, userId),
    timezoneOf: (userId, workspaceId) => timezoneOfUser(db, userId, workspaceId),
    loadReport: (formId, userId, reportDate) => loadReportState(db, formId, userId, reportDate),

    async saveDraft(args): Promise<SaveRpcResult> {
      const { data, error } = await db.rpc("save_eod_draft", {
        p_workspace_id: args.workspaceId,
        p_form_id: args.formId,
        p_user_id: args.userId,
        p_report_date: args.reportDate,
        p_rev: args.rev,
        p_answers: args.data.answers as unknown as Json,
        p_channels: args.data.channels as unknown as Json,
        p_report_mode: args.reportMode,
      });
      if (error || !data) {
        console.error(`[eod] save_eod_draft fallo (code=${error?.code ?? "?"})`);
        return { ok: false, error: "failed" };
      }
      const r = data as Record<string, unknown>;
      if (r.ok === true) return { ok: true, rev: Number(r.rev), savedAt: String(r.saved_at), status: r.status as "draft" | "submitted" };
      if (r.error === "conflict") {
        return {
          ok: false,
          error: "conflict",
          current: { data: storedDraft(r.answers, r.channels), rev: Number(r.rev), savedAt: (r.saved_at as string | null) ?? null, status: r.status as "draft" | "submitted" },
        };
      }
      if (r.error === "already_submitted") return { ok: false, error: "already_submitted" };
      return { ok: false, error: "failed" };
    },

    async submit(args): Promise<SubmitRpcResult> {
      const { data, error } = await db.rpc("submit_eod_report", {
        p_workspace_id: args.workspaceId,
        p_form_id: args.formId,
        p_user_id: args.userId,
        p_report_date: args.reportDate,
        p_rev: args.rev,
        p_form_version_id: args.versionId,
        p_answers: args.answers as unknown as Json,
        p_channels: args.channels as unknown as Json,
        p_metrics: args.metrics as unknown as Json,
        p_report_mode: args.reportMode,
        p_audit_changes: (args.auditChanges ?? null) as unknown as Json,
      });
      if (error || !data) {
        console.error(`[eod] submit_eod_report fallo (code=${error?.code ?? "?"})`);
        return { ok: false, error: "failed" };
      }
      const r = data as Record<string, unknown>;
      if (r.ok === true) return { ok: true, reportId: String(r.report_id), first: r.first === true, editCount: Number(r.edit_count), rev: Number(r.rev) };
      if (r.error === "conflict" || r.error === "already_submitted") return { ok: false, error: r.error };
      return { ok: false, error: "failed" };
    },

    async notify({ form, reportId, reporterName, reportDate, edited }) {
      const title = notificationTitle(reporterName, reportDate, edited);
      for (const recipientId of new Set(form.config.notify.userIds)) {
        await createNotification({
          supabase: db,
          workspaceId: form.workspaceId,
          type: "eod_submitted",
          title,
          body: form.name,
          entityType: "eod_report",
          entityId: reportId,
          recipientId,
          metadata: { form_id: form.id, report_date: reportDate },
        });
      }
    },

    now: () => new Date(),
  };
}
