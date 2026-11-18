// @plantilla-quitar(servicios)
/**
 * Invitación para pasarse (00404): los criterios de aceptación contra la base.
 *
 *   1. Las gemelas: validate_variant_portal_settings da lo mismo que TypeScript (portal-settings.cases.json).
 *   2. Sin configurar nada, todo como hoy: ninguna variante de producción tiene `not_included` y nadie recibe filas nuevas.
 *   3. Un negocio de prueba (zz-test-) con un programa de tres módulos (uno extra), una variante completa, una «Lite»
 *      con la invitación y otra «Lite» sin ella, y un estudiante en cada una: lo que devuelve el Programa, que un
 *      módulo no incluido no se abre, la portada, vistas y toques (etiqueta, aviso, evento, historial, una vez en 7
 *      días), la vista previa del equipo que no escribe, las métricas y el guardado desde el panel.
 *
 * No deja nada: si la 00404 no está aplicada, se aplica ADENTRO de la misma transacción, y todo termina en ROLLBACK.
 *
 *   node scripts/verify-invitacion-upgrade.mjs
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dbTargetArgs } from "./lib/db-target.mjs";

const repoFile = (path) => new URL(`../${path}`, import.meta.url);
const json = (path) => JSON.parse(readFileSync(repoFile(path), "utf8"));
const lit = (v) => (v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
const jlit = (v) => `${lit(JSON.stringify(v))}::jsonb`;

function sql(query) {
  const out = execFileSync("supabase", ["db", "query", "-o", "json", ...dbTargetArgs(), query], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(out).rows ?? [];
}

const applied = sql(`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'app_servicio_portal' AND table_name = 'upgrade_events') AS a`)[0]?.a === true;
const migration = applied ? "" : readFileSync(repoFile("supabase/migrations/00404_upgrade_invitation.sql"), "utf8");
const portalCases = json("lib/portal-admin/portal-settings.cases.json").cases;

const T = (name, cond, detail = "NULL") => `INSERT INTO zz_res VALUES (${lit(name)}, (${cond}), (${detail})::text);`;
const prog = (tok) => `app_servicio_portal.portal_program(pg_temp.zz_get('${tok}'), pg_temp.zz_get('prod')::uuid)`;
const ev = (tok, mod, kind) =>
  `format('SELECT app_servicio_portal.portal_upgrade_event(%L, %L::uuid, %L::uuid, %L)', pg_temp.zz_get('${tok}'), pg_temp.zz_get('prod'), pg_temp.zz_get('${mod}'), '${kind}')`;
const count = (where) => `(SELECT count(*) FROM ${where})`;

const parts = [
  "BEGIN",
  migration,
  `CREATE TEMP TABLE zz_res (name text, ok boolean, detail text) ON COMMIT DROP`,
  `CREATE TEMP TABLE zz (k text PRIMARY KEY, v text) ON COMMIT DROP`,
  `CREATE FUNCTION pg_temp.zz_err(q text) RETURNS text LANGUAGE plpgsql AS $f$ BEGIN EXECUTE q; RETURN NULL; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $f$`,
  `CREATE FUNCTION pg_temp.zz_get(k text) RETURNS text LANGUAGE sql AS $f$ SELECT v FROM zz WHERE zz.k = $1 $f$`,
  `CREATE FUNCTION pg_temp.zz_as(uid text) RETURNS void LANGUAGE sql AS $f$
     SELECT set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true),
            set_config('request.jwt.claim.sub', uid, true) $f$`,

  // ── 1. Gemelas ────────────────────────────────────────────────────────────
  ...portalCases
    .filter((c) => c.kind === "variant" && !c.ext)
    .map((c) =>
      T(`gemela validate_variant_portal_settings: ${c.name}`, `to_jsonb(app_servicio.validate_variant_portal_settings(${jlit(c.settings)}, NULL)) = ${jlit(c.expected)}`,
        `to_jsonb(app_servicio.validate_variant_portal_settings(${jlit(c.settings)}, NULL))`),
    ),
  T("la WhatsApp del botón va codificada como en el navegador", `app_servicio.url_encode('Hola, quiero pasarme ñ') = 'Hola%2C%20quiero%20pasarme%20%C3%B1'`, `app_servicio.url_encode('Hola, quiero pasarme ñ')`),
  T("«Tocó la invitación para pasarse» está en el CHECK de disparadores",
    `(SELECT pg_get_constraintdef(oid) LIKE '%service_upgrade_interest%' FROM pg_constraint WHERE conname = 'triggers_type_check')`),

  // ── 2. Sin configurar, como hoy (datos reales, sin tocarlos) ────────────────
  T("criterio 1: ninguna variante de producción tiene la invitación configurada",
    `NOT EXISTS (SELECT 1 FROM public.product_variants v, jsonb_array_elements(CASE WHEN jsonb_typeof(v.portal_settings -> 'sections') = 'array' THEN v.portal_settings -> 'sections' ELSE '[]' END) x WHERE x ? 'not_included')`),
  T("criterio 1: a nadie de producción le tocan módulos no incluidos",
    `NOT EXISTS (SELECT 1 FROM (SELECT DISTINCT contact_id, product_id FROM app_servicio.services WHERE status IN ('active','paused','completed')) s
                 WHERE app_servicio.program_not_included_config(s.contact_id, s.product_id) IS NOT NULL)`),

  // ── 3. El negocio de prueba ────────────────────────────────────────────────
  `DO $do$
   DECLARE
     v_ws uuid; v_uid uuid; v_prod uuid; vA uuid; vL uuid; vH uuid; m1 uuid; m2 uuid; mx uuid; l1 uuid; l2 uuid; v_tag uuid; c uuid; t text; v uuid;
     v_full jsonb := '{"v":1,"enabled":true,"sections":[{"section":"program","included":true,"content":{"modules":"all"}}]}';
   BEGIN
     SELECT id INTO v_uid FROM auth.users ORDER BY created_at LIMIT 1;
     INSERT INTO public.workspaces (name, slug, timezone, services_enabled) VALUES ('zz-test-invitacion', 'zz-test-invitacion-' || md5(random()::text), 'UTC', true) RETURNING id INTO v_ws;
     INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES (v_ws, v_uid, 'owner');
     INSERT INTO public.products (workspace_id, name, product_type, portal_enabled, portal_settings)
       VALUES (v_ws, 'zz-test Academia', 'programa', true, '{"v":1,"sections":{"program":true}}') RETURNING id INTO v_prod;
     INSERT INTO app_servicio.program_items (workspace_id, product_id, kind, title, position, status) VALUES (v_ws, v_prod, 'module', 'zz-test Empezar', 0, 'active') RETURNING id INTO m1;
     INSERT INTO app_servicio.program_items (workspace_id, product_id, kind, title, description, position, status, cover_path)
       VALUES (v_ws, v_prod, 'module', 'zz-test Construir', 'zz-test lo que se aprende', 1, 'active', 'zz-test/portada.png') RETURNING id INTO m2;
     INSERT INTO app_servicio.program_items (workspace_id, product_id, kind, title, position, status, is_extra) VALUES (v_ws, v_prod, 'module', 'zz-test Extra', 2, 'active', true) RETURNING id INTO mx;
     INSERT INTO app_servicio.program_items (workspace_id, product_id, parent_id, kind, lesson_type, title, position, status)
       VALUES (v_ws, v_prod, m1, 'lesson', 'video', 'zz-test Clase uno', 0, 'active') RETURNING id INTO l1;
     INSERT INTO app_servicio.program_items (workspace_id, product_id, parent_id, kind, lesson_type, title, position, status, duration_seconds, document_path)
       VALUES (v_ws, v_prod, m2, 'lesson', 'video', 'zz-test Clase cerrada', 0, 'active', 600, 'zz-test/doc.pdf') RETURNING id INTO l2;
     INSERT INTO public.tags (workspace_id, name) VALUES (v_ws, 'zz-test quiere pasarse') RETURNING id INTO v_tag;
     INSERT INTO public.product_variants (workspace_id, product_id, name, duration_type, duration_value, portal_settings)
       VALUES (v_ws, v_prod, 'zz-test Completa', 'months', 6, v_full) RETURNING id INTO vA;
     INSERT INTO public.product_variants (workspace_id, product_id, name, duration_type, duration_value, portal_settings)
       VALUES (v_ws, v_prod, 'zz-test Lite', 'months', 12, jsonb_build_object('v', 1, 'enabled', true, 'sections', jsonb_build_array(jsonb_build_object(
         'section', 'program', 'included', true, 'content', jsonb_build_object('modules', jsonb_build_array(m1)),
         'not_included', jsonb_build_object('mode', 'invite', 'label', 'zz-test En la completa', 'text', 'zz-test Pasate', 'button', 'zz-test Quiero',
           'target', jsonb_build_object('kind', 'whatsapp', 'value', '50688887777', 'prefill', 'Hola, quiero pasarme'),
           'on_click', jsonb_build_object('tag_id', v_tag, 'notify', 'owner'))))))
       RETURNING id INTO vL;
     INSERT INTO public.product_variants (workspace_id, product_id, name, duration_type, duration_value, portal_settings)
       VALUES (v_ws, v_prod, 'zz-test Lite sin invitación', 'months', 12, jsonb_build_object('v', 1, 'enabled', true, 'sections', jsonb_build_array(jsonb_build_object(
         'section', 'program', 'included', true, 'content', jsonb_build_object('modules', jsonb_build_array(m1))))))
       RETURNING id INTO vH;
     PERFORM app_servicio.as_system();
     FOR t, v IN SELECT * FROM (VALUES ('A', vA), ('L', vL), ('H', vH)) x(t, v) LOOP
       INSERT INTO public.contacts (workspace_id, display_name, email) VALUES (v_ws, 'zz-test ' || t, 'zz-test-' || lower(t) || '-' || md5(random()::text) || '@example.test') RETURNING id INTO c;
       PERFORM app_servicio.svc_create_service(jsonb_build_object('contact_id', c, 'variant_id', v, 'origin', 'manual', 'origin_reason', 'zz-test', 'owner_user_id', v_uid));
       INSERT INTO zz VALUES ('c' || t, c::text);
     END LOOP;
     PERFORM set_config('app_servicio.system', '', true);
     INSERT INTO zz VALUES ('ws', v_ws::text), ('uid', v_uid::text), ('prod', v_prod::text), ('vA', vA::text), ('vL', vL::text), ('vH', vH::text),
       ('m1', m1::text), ('m2', m2::text), ('mx', mx::text), ('l1', l1::text), ('l2', l2::text), ('tag', v_tag::text);
     FOR t IN SELECT unnest(ARRAY['A', 'L', 'H']) LOOP
       INSERT INTO zz VALUES ('tok' || t, md5(random()::text) || md5(random()::text));
       INSERT INTO app_servicio_portal.portal_sessions (workspace_id, account_id, kind, token_hash, expires_at)
       SELECT v_ws, a.id, 'student', app_servicio.portal_token_hash(pg_temp.zz_get('tok' || t)), now() + interval '1 day'
         FROM app_servicio_portal.portal_accounts a WHERE a.contact_id = pg_temp.zz_get('c' || t)::uuid;
     END LOOP;
     -- La vista previa del equipo, mirando a L.
     INSERT INTO zz VALUES ('tokP', md5(random()::text) || md5(random()::text));
     INSERT INTO app_servicio_portal.portal_sessions (workspace_id, account_id, kind, token_hash, expires_at, preview_user_id, preview_contact_id)
     SELECT v_ws, a.id, 'preview', app_servicio.portal_token_hash(pg_temp.zz_get('tokP')), now() + interval '1 hour', v_uid, a.contact_id
       FROM app_servicio_portal.portal_accounts a WHERE a.contact_id = pg_temp.zz_get('cL')::uuid;
   END $do$`,
  T("se armaron las 4 sesiones del portal",
    `${count(`app_servicio_portal.portal_sessions s JOIN app_servicio_portal.portal_accounts a ON a.id = s.account_id WHERE a.workspace_id = pg_temp.zz_get('ws')::uuid`)} = 4`),

  // Lo que devuelve el Programa.
  T("criterio 2: Lite ve su módulo, después el no incluido y al final el extra (en Extras)",
    `(SELECT jsonb_agg(x -> 'id' ORDER BY o) FROM jsonb_array_elements(${prog("tokL")} -> 'modules') WITH ORDINALITY t(x, o))
       = jsonb_build_array(pg_temp.zz_get('m1'), pg_temp.zz_get('m2'), pg_temp.zz_get('mx'))`,
    `${prog("tokL")}::text`),
  T("criterio 2: el no incluido viene con candado, la etiqueta, sin clases para abrir y con la lista de títulos",
    `(SELECT x ->> 'display' = 'not_included' AND (x ->> 'not_included')::boolean AND NOT (x ->> 'unlocked')::boolean AND x ->> 'reason' = 'zz-test En la completa'
            AND x -> 'items' = '[]'::jsonb AND x -> 'teaser' = '{"lessons":["zz-test Clase cerrada"],"count":1,"duration_seconds":600}'::jsonb
            AND (x ->> 'number')::int = 2 AND x ->> 'description' = 'zz-test lo que se aprende'
       FROM jsonb_array_elements(${prog("tokL")} -> 'modules') x WHERE x ->> 'id' = pg_temp.zz_get('m2'))`),
  T("criterio 4: el botón lleva a WhatsApp con el mensaje armado",
    `(SELECT x -> 'invite' = '{"text":"zz-test Pasate","button":"zz-test Quiero","href":"https://wa.me/50688887777?text=Hola%2C%20quiero%20pasarme"}'::jsonb
       FROM jsonb_array_elements(${prog("tokL")} -> 'modules') x WHERE x ->> 'id' = pg_temp.zz_get('m2'))`),
  T("su módulo sigue igual que antes (abierto, con su clase)",
    `(SELECT (x ->> 'unlocked')::boolean AND NOT x ? 'not_included' AND jsonb_array_length(x -> 'items') = 1 FROM jsonb_array_elements(${prog("tokL")} -> 'modules') x WHERE x ->> 'id' = pg_temp.zz_get('m1'))`),
  T("una Lite sin invitación ve solo su módulo, como hoy",
    `(SELECT jsonb_agg(x -> 'id') FROM jsonb_array_elements(${prog("tokH")} -> 'modules') x) = jsonb_build_array(pg_temp.zz_get('m1'))`),
  T("criterio 7: la completa no ve ningún candado de este tipo",
    `jsonb_array_length(${prog("tokA")} -> 'modules') = 3 AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(${prog("tokA")} -> 'modules') x WHERE x ? 'not_included')`),
  T("la vista previa del equipo ve lo mismo que el estudiante",
    `${prog("tokP")} = ${prog("tokL")}`),

  // Criterio 3: no se abre.
  T("criterio 3: el módulo no incluido no se abre (portal_module)",
    `pg_temp.zz_err(format('SELECT app_servicio_portal.portal_module(%L, %L::uuid)', pg_temp.zz_get('tokL'), pg_temp.zz_get('m2'))) IS NOT NULL`),
  T("criterio 3: su clase no se abre (portal_lesson)",
    `pg_temp.zz_err(format('SELECT app_servicio_portal.portal_lesson(%L, %L::uuid)', pg_temp.zz_get('tokL'), pg_temp.zz_get('l2'))) IS NOT NULL`),
  T("criterio 3: su documento no se descarga",
    `pg_temp.zz_err(format('SELECT app_servicio.portal_file_grant(%L, %L, %L::uuid)', pg_temp.zz_get('tokL'), 'document', pg_temp.zz_get('l2'))) IS NOT NULL`),
  T("la portada del módulo no incluido sí se ve",
    `app_servicio.portal_file_grant(pg_temp.zz_get('tokL'), 'module_cover', pg_temp.zz_get('m2')::uuid) ->> 'path' = 'zz-test/portada.png'`),
  T("sin la invitación, esa portada no se ve (como hoy)",
    `pg_temp.zz_err(format('SELECT app_servicio.portal_file_grant(%L, %L, %L::uuid)', pg_temp.zz_get('tokH'), 'module_cover', pg_temp.zz_get('m2'))) LIKE '%No existe%'`),

  // Vistas y toques.
  T("la vista previa del equipo no escribe", `pg_temp.zz_err(${ev("tokP", "m2", "click")}) LIKE '%Solo lectura%'`),
  T("no se registra un toque desde un módulo incluido", `pg_temp.zz_err(${ev("tokL", "m1", "click")}) LIKE '%no existe%'`),
  T("la completa no puede registrar un toque", `pg_temp.zz_err(${ev("tokA", "m2", "click")}) LIKE '%no existe%'`),
  T("una Lite sin invitación no puede registrar un toque", `pg_temp.zz_err(${ev("tokH", "m2", "click")}) LIKE '%no existe%'`),
  `SELECT app_servicio_portal.portal_upgrade_event(pg_temp.zz_get('tokL'), pg_temp.zz_get('prod')::uuid, pg_temp.zz_get('m2')::uuid, 'view')`,
  `SELECT app_servicio_portal.portal_upgrade_event(pg_temp.zz_get('tokL'), pg_temp.zz_get('prod')::uuid, pg_temp.zz_get('m2')::uuid, 'view')`,
  T("abrir la tarjeta dos veces el mismo día cuenta una vista",
    `${count(`app_servicio_portal.upgrade_events WHERE contact_id = pg_temp.zz_get('cL')::uuid AND kind = 'view'`)} = 1`),
  T("ver la tarjeta no avisa ni dispara nada",
    `${count(`public.notifications WHERE workspace_id = pg_temp.zz_get('ws')::uuid AND type = 'svc_upgrade_interest'`)} = 0
     AND ${count(`public.automation_events WHERE workspace_id = pg_temp.zz_get('ws')::uuid AND event_type = 'service_upgrade_interest'`)} = 0`),
  `SELECT app_servicio_portal.portal_upgrade_event(pg_temp.zz_get('tokL'), pg_temp.zz_get('prod')::uuid, pg_temp.zz_get('m2')::uuid, 'click')`,
  T("criterio 5: el toque queda registrado", `${count(`app_servicio_portal.upgrade_events WHERE contact_id = pg_temp.zz_get('cL')::uuid AND kind = 'click' AND target_kind = 'whatsapp'`)} = 1`),
  T("criterio 5: le pone la etiqueta", `EXISTS (SELECT 1 FROM public.contact_tags WHERE contact_id = pg_temp.zz_get('cL')::uuid AND tag_id = pg_temp.zz_get('tag')::uuid)`),
  T("criterio 5: avisa al responsable del servicio",
    `(SELECT count(*) = 1 AND bool_and(recipient_id = pg_temp.zz_get('uid')::uuid AND entity_type = 'service' AND body LIKE '%zz-test Quiero%zz-test Construir%')
       FROM public.notifications WHERE workspace_id = pg_temp.zz_get('ws')::uuid AND type = 'svc_upgrade_interest')`,
    `(SELECT jsonb_agg(to_jsonb(n) - 'metadata') FROM public.notifications n WHERE workspace_id = pg_temp.zz_get('ws')::uuid)::text`),
  T("criterio 6: dispara «Tocó la invitación para pasarse» con la variante y el módulo",
    `(SELECT count(*) = 1 AND bool_and(payload ->> 'variant_id' = pg_temp.zz_get('vL') AND payload ->> 'module_id' = pg_temp.zz_get('m2'))
       FROM public.automation_events WHERE workspace_id = pg_temp.zz_get('ws')::uuid AND event_type = 'service_upgrade_interest')`),
  T("queda en el historial del servicio",
    `${count(`public.audit_log WHERE workspace_id = pg_temp.zz_get('ws')::uuid AND action = 'svc.upgrade_interest' AND entity_type = 'service'`)} = 1`),
  `SELECT app_servicio_portal.portal_upgrade_event(pg_temp.zz_get('tokL'), pg_temp.zz_get('prod')::uuid, pg_temp.zz_get('mx')::uuid, 'click')`,
  T("criterio 5 y 6: un segundo toque se registra, pero no vuelve a avisar ni a disparar en 7 días",
    `${count(`app_servicio_portal.upgrade_events WHERE contact_id = pg_temp.zz_get('cL')::uuid AND kind = 'click'`)} = 2
     AND ${count(`public.notifications WHERE workspace_id = pg_temp.zz_get('ws')::uuid AND type = 'svc_upgrade_interest'`)} = 1
     AND ${count(`public.automation_events WHERE workspace_id = pg_temp.zz_get('ws')::uuid AND event_type = 'service_upgrade_interest'`)} = 1
     AND ${count(`public.audit_log WHERE workspace_id = pg_temp.zz_get('ws')::uuid AND action = 'svc.upgrade_interest'`)} = 1`),
  T("un tipo que no es vista ni toque no pasa", `pg_temp.zz_err(${ev("tokL", "m2", "otro")}) LIKE '%no válido%'`),

  // Métricas.
  `SELECT pg_temp.zz_as(pg_temp.zz_get('uid'))`,
  T("criterio 9: 1 vio, 1 tocó, 0 se pasaron",
    `app_servicio.upgrade_interest_stats(pg_temp.zz_get('vL')::uuid) @> '{"saw":1,"clicked":1,"upgraded":0}'::jsonb
     AND jsonb_array_length(app_servicio.upgrade_interest_stats(pg_temp.zz_get('vL')::uuid) -> 'people') = 1`,
    `app_servicio.upgrade_interest_stats(pg_temp.zz_get('vL')::uuid)::text`),
  `SELECT set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true)`,
  `DO $do$ BEGIN
     PERFORM app_servicio.as_system();
     PERFORM app_servicio.svc_create_service(jsonb_build_object('contact_id', pg_temp.zz_get('cL'), 'variant_id', pg_temp.zz_get('vA'), 'origin', 'manual', 'origin_reason', 'zz-test se pasa', 'owner_user_id', pg_temp.zz_get('uid')));
     PERFORM set_config('app_servicio.system', '', true);
   END $do$`,
  `SELECT pg_temp.zz_as(pg_temp.zz_get('uid'))`,
  T("criterio 9: al comprar la completa, cuenta como que se pasó",
    `app_servicio.upgrade_interest_stats(pg_temp.zz_get('vL')::uuid) @> '{"saw":1,"clicked":1,"upgraded":1}'::jsonb`,
    `app_servicio.upgrade_interest_stats(pg_temp.zz_get('vL')::uuid)::text`),
  `SELECT set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true)`,
  T("criterio 8: con la completa, los candados desaparecen y todo se abre",
    `jsonb_array_length(${prog("tokL")} -> 'modules') = 3 AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(${prog("tokL")} -> 'modules') x WHERE x ? 'not_included')`,
    `${prog("tokL")}::text`),
  T("alguien sin permiso no ve las métricas",
    `pg_temp.zz_err(format('SELECT app_servicio.upgrade_interest_stats(%L::uuid)', pg_temp.zz_get('vL'))) IS NOT NULL`),

  // El guardado desde el panel.
  `SELECT pg_temp.zz_as(pg_temp.zz_get('uid'))`,
  T("el panel no guarda una invitación incompleta",
    `app_servicio.portal_admin_save_variant_portal(pg_temp.zz_get('vH')::uuid,
       jsonb_build_object('v', 1, 'enabled', true, 'sections', jsonb_build_array(jsonb_build_object('section', 'program', 'included', true,
         'content', jsonb_build_object('modules', jsonb_build_array(pg_temp.zz_get('m1'))), 'not_included', '{"mode":"invite"}'::jsonb))),
       (SELECT portal_settings_rev FROM public.product_variants WHERE id = pg_temp.zz_get('vH')::uuid)) ->> 'status' = 'invalid'`),
  T("el panel guarda «con candado» y la Lite sin invitación pasa a ver el módulo con candado (sin botón)",
    `app_servicio.portal_admin_save_variant_portal(pg_temp.zz_get('vH')::uuid,
       jsonb_build_object('v', 1, 'enabled', true, 'sections', jsonb_build_array(jsonb_build_object('section', 'program', 'included', true,
         'content', jsonb_build_object('modules', jsonb_build_array(pg_temp.zz_get('m1'))), 'not_included', '{"mode":"locked"}'::jsonb))),
       (SELECT portal_settings_rev FROM public.product_variants WHERE id = pg_temp.zz_get('vH')::uuid)) ->> 'status' = 'ok'`),
  `SELECT set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true)`,
  T("«con candado» muestra el no incluido con la etiqueta genérica y sin invitación",
    `(SELECT x ->> 'reason' = 'No incluido en tu plan' AND x -> 'invite' = 'null'::jsonb FROM jsonb_array_elements(${prog("tokH")} -> 'modules') x WHERE x ->> 'id' = pg_temp.zz_get('m2'))`,
    `${prog("tokH")}::text`),
  T("con candado sin invitación se registra la vista pero no el toque",
    `pg_temp.zz_err(${ev("tokH", "m2", "view")}) IS NULL AND pg_temp.zz_err(${ev("tokH", "m2", "click")}) LIKE '%no válido%'`),

  `SELECT name, ok, detail FROM zz_res`,
  "ROLLBACK",
];

let rows;
try {
  rows = sql(parts.filter(Boolean).join(";\n"));
} catch (e) {
  console.error("La prueba no pudo correr:", String(e.stderr ?? e.message).slice(0, 2000));
  process.exit(1);
}
console.log(applied ? "La 00404 ya está aplicada." : "La 00404 se aplicó adentro de la transacción (y se deshizo).");
let failures = 0;
for (const r of rows) {
  if (r.ok) console.log("  ok   ", r.name);
  else {
    failures++;
    console.error("  FALLA", r.name, r.detail ? `\n        ${String(r.detail).slice(0, 600)}` : "");
  }
}
console.log(`\n${rows.length - failures}/${rows.length} bien${failures ? `, ${failures} fallas` : ""}. Todo se deshizo (ROLLBACK).`);
process.exit(failures ? 1 : 0);
