/**
 * Lo que leen las pantallas para COMPLETAR un reporte de fin de día (E6): "Mi reporte del
 * día" y la página del reporte. Solo servidor, con el cliente de servicio, SIEMPRE después
 * de saber quién es la persona por la sesión: lee solo sus propios reportes (el borrador
 * de una corrección vive en `pending_edit`, que la persona no puede leer con su cliente).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { todayInputValue } from "@/lib/dates";
import { isInAudience } from "./audience";
import { parseStoredEodConfig, type EodConfig } from "./config";
import { allowedDateRange, reportDateProblem } from "./dates";
import { countLoaded, type EodDraftData } from "./draft";
import { storedDraft } from "./draft-shape";
import { loadEodForm, loadReportState, loadTeam, timezoneOfUser } from "./server-ports";
import type { EodVersion } from "./submit";
import type { SuccessConfig } from "@/lib/forms/success";
import { DEFAULT_SUCCESS, validateSuccess } from "@/lib/forms/success";

type Db = SupabaseClient<Database>;

export type MyEodStatus = { kind: "none" } | { kind: "draft"; loaded: number } | { kind: "submitted"; at: string };

export interface MyEodItem {
  formId: string;
  name: string;
  roleLabel: string;
  status: MyEodStatus;
}

/** Los EOD publicados que le tocan a esta persona, con el estado de HOY (en su zona). */
export async function loadMyEods(db: Db, workspaceId: string, userId: string, now = new Date()): Promise<{ items: MyEodItem[]; today: string }> {
  const [timeZone, team, { data: forms }] = await Promise.all([
    timezoneOfUser(db, userId, workspaceId),
    loadTeam(db, workspaceId),
    db.from("forms").select("id, name, eod_config").eq("workspace_id", workspaceId).eq("type", "eod").eq("status", "published").not("current_version_id", "is", null).order("name"),
  ]);
  const today = todayInputValue(now, timeZone);
  const me = team.find((m) => m.userId === userId);
  if (!me) return { items: [], today };

  const mine = (forms ?? []).flatMap((f) => {
    const config = parseStoredEodConfig(f.eod_config);
    return config && isInAudience(config, me) ? [{ id: f.id, name: f.name, config }] : [];
  });
  if (mine.length === 0) return { items: [], today };

  const { data: reports } = await db
    .from("eod_reports")
    .select("form_id, status, answers, channels, submitted_at")
    .eq("user_id", userId)
    .eq("report_date", today)
    .in(
      "form_id",
      mine.map((f) => f.id),
    );
  const byForm = new Map((reports ?? []).map((r) => [r.form_id, r]));

  return {
    today,
    items: mine.map((f) => {
      const r = byForm.get(f.id);
      const status: MyEodStatus = !r
        ? { kind: "none" }
        : r.status === "submitted"
          ? { kind: "submitted", at: r.submitted_at ?? "" }
          : { kind: "draft", loaded: countLoaded(storedDraft(r.answers, r.channels)) };
      return { formId: f.id, name: f.name, roleLabel: f.config.roleLabel, status };
    }),
  };
}

export interface FillPageData {
  workspaceId: string;
  userId: string;
  form: { id: string; name: string; config: EodConfig; version: EodVersion; success: SuccessConfig };
  timeZone: string;
  today: string;
  reportDate: string;
  range: { min: string; max: string };
  report: {
    status: "draft" | "submitted";
    rev: number;
    savedAt: string | null;
    draft: EodDraftData;
    submittedAt: string | null;
    editedAt: string | null;
    editCount: number;
  } | null;
}

export type FillPageResult = { ok: true; data: FillPageData } | { ok: false; reason: "not_available" | "date" };

/** La página de un reporte: si no le toca o no está publicado, "no disponible". */
export async function loadFillPage(
  db: Db,
  input: { workspaceId: string; userId: string; formId: string; fecha?: string | null; now?: Date },
): Promise<FillPageResult> {
  const now = input.now ?? new Date();
  const form = await loadEodForm(db, input.formId);
  if (!form || form.workspaceId !== input.workspaceId || form.status !== "published" || !form.version) return { ok: false, reason: "not_available" };
  const team = await loadTeam(db, input.workspaceId);
  const me = team.find((m) => m.userId === input.userId);
  if (!me || !isInAudience(form.config, me)) return { ok: false, reason: "not_available" };

  const timeZone = await timezoneOfUser(db, input.userId, input.workspaceId);
  const today = todayInputValue(now, timeZone);
  const reportDate = input.fecha ?? today;
  if (reportDateProblem(reportDate, today, form.config.pastDays)) return { ok: false, reason: "date" };

  const [state, { data: formRow }, { data: dates }] = await Promise.all([
    loadReportState(db, form.id, input.userId, reportDate),
    db.from("forms").select("success").eq("id", form.id).maybeSingle(),
    db.from("eod_reports").select("submitted_at, edited_at").eq("form_id", form.id).eq("user_id", input.userId).eq("report_date", reportDate).maybeSingle(),
  ]);
  const success = validateSuccess(formRow?.success);

  return {
    ok: true,
    data: {
      workspaceId: input.workspaceId,
      userId: input.userId,
      form: { id: form.id, name: form.name, config: form.config, version: form.version, success: success.ok ? success.success : DEFAULT_SUCCESS },
      timeZone,
      today,
      reportDate,
      range: allowedDateRange(today, form.config.pastDays),
      report: state
        ? {
            status: state.status,
            rev: state.rev,
            savedAt: state.savedAt,
            draft: state.draft,
            submittedAt: dates?.submitted_at ?? null,
            editedAt: dates?.edited_at ?? null,
            editCount: state.editCount,
          }
        : null,
    },
  };
}

/**
 * ¿Le toca algún EOD publicado? Para mostrar "Mi reporte del día" en el menú. Barato: una
 * consulta de formularios (y el equipo solo si hay alguno con audiencia por roles).
 */
export async function hasEodToComplete(db: Db, workspaceId: string, userId: string): Promise<boolean> {
  const { data: forms } = await db.from("forms").select("eod_config").eq("workspace_id", workspaceId).eq("type", "eod").eq("status", "published").not("current_version_id", "is", null);
  const configs = (forms ?? []).map((f) => parseStoredEodConfig(f.eod_config)).filter((c): c is EodConfig => c !== null);
  if (configs.length === 0) return false;
  if (configs.some((c) => c.audience.mode === "all" || (c.audience.mode === "users" && c.audience.userIds.includes(userId)))) return true;
  if (!configs.some((c) => c.audience.mode === "roles")) return false;
  const me = (await loadTeam(db, workspaceId)).find((m) => m.userId === userId);
  return !!me && configs.some((c) => isInAudience(c, me));
}
