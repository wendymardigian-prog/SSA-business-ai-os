#!/usr/bin/env node
/**
 * Vincular a su servicio las reuniones que ya existian antes de A4 (Servicios A4, F135 y F137). De una vez.
 *
 * Las reuniones nuevas se vinculan solas (enganche de `calls`, 00367); las viejas no, a proposito. Este script corre la
 * MISMA regla (`app_servicio.svc_call_link_apply`) sobre las grabaciones con contacto, sin servicio y sin vinculo
 * manual, de los negocios con el modulo prendido.
 *
 *   node scripts/backfill-call-services.mjs --dry-run    # no escribe nada: lo corre en una transaccion que se deshace
 *   node scripts/backfill-call-services.mjs --aplicar    # lo aplica (lo corre Wendy si quiere)
 *
 * Con --aplicar, una reunion con varios servicios posibles queda «Por revisar» y avisa (`call_service_review`), igual
 * que una nueva. Nunca pisa un vinculo manual.
 */
import { execFileSync } from "node:child_process";
import { dbTargetArgs } from "./lib/db-target.mjs";

const apply = process.argv.includes("--aplicar");
const dry = process.argv.includes("--dry-run");
if (apply === dry) {
  console.error("Usá --dry-run (no escribe) o --aplicar.");
  process.exit(2);
}

const QUERY = `
${apply ? "" : "BEGIN;"}
WITH targets AS (
  SELECT c.id, c.workspace_id
    FROM public.calls c
    JOIN public.workspaces w ON w.id = c.workspace_id AND w.services_enabled IS TRUE
   WHERE c.contact_id IS NOT NULL AND c.service_id IS NULL AND c.archived_at IS NULL
     AND (c.service_link IS NULL OR c.service_link <> 'manual')
), plans AS (
  SELECT t.id, app_servicio.svc_call_link_apply(t.id) AS plan FROM targets t
)
SELECT count(*) AS revisadas,
       count(*) FILTER (WHERE plan ->> 'link' IN ('auto', 'booking')) AS vinculadas,
       count(*) FILTER (WHERE plan ->> 'link' = 'review') AS por_revisar,
       count(*) FILTER (WHERE plan ->> 'link' IS NULL) AS sin_servicio
  FROM plans;
${apply ? "" : "ROLLBACK;"}
`;

try {
  const out = execFileSync("supabase", ["db", "query", ...dbTargetArgs(), QUERY], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 16 * 1024 * 1024, timeout: 600_000 });
  const rows = JSON.parse(out).rows ?? [];
  const r = rows[rows.length - 1] ?? {};
  console.log(apply ? "Aplicado:" : "Ensayo (no se escribió nada):");
  console.log(`  revisadas: ${r.revisadas ?? 0}`);
  console.log(`  vinculadas a un servicio: ${r.vinculadas ?? 0}`);
  console.log(`  por revisar (varios servicios posibles): ${r.por_revisar ?? 0}`);
  console.log(`  sin servicio (otra área, Clase o fuera de período): ${r.sin_servicio ?? 0}`);
} catch (e) {
  console.error("No pude correr el backfill:", `${e.stderr ?? ""}${e.message ?? ""}`.slice(0, 600));
  process.exit(1);
}
