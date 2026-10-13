/**
 * Lo que las migraciones de Tareas tienen que decir, leyendo el archivo (mismo patron que `lib/webhooks/migrations.test.ts`).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (name: string) => readFileSync(join(process.cwd(), "supabase/migrations", name), "utf8");
const body = (sql: string) => sql.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
const types = (name: string) => {
  const check = body(read(name));
  const from = check.slice(check.indexOf("ADD CONSTRAINT triggers_type_check"));
  return [...from.slice(0, from.indexOf("]));")).matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]);
};

describe("00199: los disparadores de Tareas", () => {
  it("son los 32 de la 00187 mas task_completed y task_overdue, en ese orden", () => {
    const before = types("00187_webhook_sessions.sql");
    expect(before).toHaveLength(32);
    expect(types("00199_task_trigger_types.sql")).toEqual([...before, "task_completed", "task_overdue"]);
  });

  it("la cabecera guarda las dos definiciones vigentes para volver atras", () => {
    const header = read("00199_task_trigger_types.sql");
    expect(header).toContain("'webhook_received'::text])))");
    expect(header).toContain("CHECK (((contact_id IS NOT NULL) OR ((event_type = ANY (ARRAY['eod_submitted'::text])) AND (member_user_id IS NOT NULL))))");
    expect(header).toContain("Como volver atras");
  });

  it("un evento sin contacto solo vale para fin de dia y tareas, y siempre con una persona", () => {
    const sql = body(read("00199_task_trigger_types.sql"));
    expect(sql).toContain("ARRAY['eod_submitted'::text, 'task_completed'::text, 'task_overdue'::text]");
    expect(sql).toContain("AND member_user_id IS NOT NULL");
  });

  it("no toca datos ni columnas: solo las dos restricciones", () => {
    const sql = body(read("00199_task_trigger_types.sql"));
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
    expect(sql).not.toMatch(/ALTER COLUMN|DROP COLUMN|ADD COLUMN/);
  });
});

describe("00196 a 00198: lo que no se puede aflojar", () => {
  const tasks = body(read("00196_tasks.sql"));

  it("la tabla tiene RLS y no hay policy de DELETE ni de escritura de blocked_by", () => {
    expect(tasks).toContain("ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY");
    expect(tasks).not.toMatch(/FOR DELETE/);
    expect(tasks).not.toMatch(/FOR ALL/);
    const insertGrant = tasks.slice(tasks.indexOf("GRANT INSERT ("), tasks.indexOf(") ON public.tasks TO authenticated;"));
    const updateGrant = tasks.slice(tasks.indexOf("GRANT UPDATE ("), tasks.lastIndexOf(") ON public.tasks TO authenticated;"));
    for (const col of ["blocked_by", "deleted_at", "workspace_id_UPDATE", "source_ref"]) {
      if (col === "workspace_id_UPDATE") expect(updateGrant).not.toMatch(/workspace_id/);
      else {
        expect(insertGrant).not.toContain(col);
        expect(updateGrant).not.toContain(col);
      }
    }
  });

  it("todas las funciones son SECURITY DEFINER con search_path vacio, y can_see_task nunca devuelve NULL", () => {
    const all = [body(read("00196_tasks.sql")), body(read("00197_tasks_functions.sql")), body(read("00198_tasks_due_cron.sql"))].join("\n");
    const definers = all.match(/SECURITY DEFINER/g)?.length ?? 0;
    const paths = all.match(/SET search_path = ''/g)?.length ?? 0;
    expect(definers).toBeGreaterThan(5);
    expect(paths).toBeGreaterThanOrEqual(definers);
    expect(tasks).toMatch(/SELECT COALESCE\(\s*public\.is_workspace_member/);
  });

  it("el historial es una policy ADICIONAL: no se reescribe audit_log_select", () => {
    const sql = body(read("00197_tasks_functions.sql"));
    expect(sql).toContain("CREATE POLICY audit_log_select_tasks ON public.audit_log");
    expect(sql).toContain("AS PERMISSIVE FOR SELECT");
    expect(sql).not.toMatch(/(DROP|CREATE) POLICY (IF EXISTS )?"?audit_log_select"?\s/);
  });

  it("el cron es SQL directo: no pasa por call_app_cron ni agrega una ruta", () => {
    const sql = body(read("00198_tasks_due_cron.sql"));
    expect(sql).not.toContain("call_app_cron");
    expect(sql).toContain("private.enqueue_tasks_due_sweep");
    expect(sql).toContain("FROM PUBLIC, anon, authenticated");
  });
});
