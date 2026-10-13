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

describe("00206: hora, duracion y seguimiento unico", () => {
  const sql = body(read("00206_tasks_time_and_followup.sql"));

  it("agrega solo las dos columnas opcionales, sin tocar datos", () => {
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS due_time time");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS duration_minutes integer");
    expect(sql).not.toMatch(/\bUPDATE public\.tasks\b/);
    expect(sql).not.toMatch(/DELETE FROM/);
    expect(sql).not.toMatch(/DROP COLUMN|ALTER COLUMN/);
  });

  it("la hora necesita fecha y la duracion va de 5 a 1440", () => {
    expect(sql).toContain("CHECK (due_time IS NULL OR due_date IS NOT NULL)");
    expect(sql).toContain("duration_minutes BETWEEN 5 AND 1440");
  });

  it("la sesion puede escribir las dos columnas, y solo esas", () => {
    expect(sql).toContain("GRANT INSERT (due_time, duration_minutes) ON public.tasks TO authenticated");
    expect(sql).toContain("GRANT UPDATE (due_time, duration_minutes) ON public.tasks TO authenticated");
  });

  it("el indice del seguimiento es unico y parcial, sin las borradas, e incluye las completadas", () => {
    expect(sql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS uq_tasks_followup");
    expect(sql).toContain("(workspace_id, contact_id, source_ref)");
    expect(sql).toContain("WHERE source_ref LIKE 'followup:%' AND deleted_at IS NULL");
    expect(sql).not.toContain("status");
  });

  it("la cabecera dice como volver atras", () => {
    const header = read("00206_tasks_time_and_followup.sql");
    expect(header).toContain("Como volver atras");
    expect(header).toContain("DROP INDEX IF EXISTS public.uq_tasks_followup");
  });
});
