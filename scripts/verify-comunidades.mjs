// @plantilla-quitar(servicios)
/**
 * Comunidades por variante (00402): los criterios de aceptación contra la base.
 *
 *   1. Las gemelas: community_list_plan, validate_*_portal_settings y validate_service_settings dan lo mismo que
 *      TypeScript (community-list.cases.json, portal-settings.cases.json, service-settings.cases.json).
 *   2. Con una sola comunidad, nada cambia: todos los posts de producción quedan en `principal` y cada persona con
 *      servicios está en la principal de su programa.
 *   3. Un negocio de prueba (zz-test-) con dos comunidades (la principal y «Lite»), tres variantes (completa, Lite y Lite
 *      mensual) y cuatro estudiantes: muro, comentarios de una clase, publicar llamando a la función, reacciones, el
 *      equipo publicando en las dos, archivar una comunidad en uso, el upgrade de Lite a la completa, puntos y la fecha
 *      de una clase en vivo abierta a Lite.
 *
 * No deja nada: si la 00402 no está aplicada, se aplica ADENTRO de la misma transacción, y todo termina en ROLLBACK
 * (los datos de prueba nunca los ve la app, y por eso no hace falta el candado de los verify-*).
 *
 *   node scripts/verify-comunidades.mjs
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

const applied = sql(`SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'app_servicio_portal'
  AND table_name = 'community_posts' AND column_name = 'community_key') AS a`)[0]?.a === true;
const migration = applied ? "" : readFileSync(repoFile("supabase/migrations/00402_community_by_variant.sql"), "utf8");
// 00405 (título y aviso por correo): igual, si no está aplicada se aplica adentro de la transacción.
const applied405 = sql(`SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'app_servicio_portal'
  AND table_name = 'community_posts' AND column_name = 'title') AS a`)[0]?.a === true;
const migration405 = applied405 ? "" : readFileSync(repoFile("supabase/migrations/00405_community_post_title_email.sql"), "utf8");

const listCases = json("lib/program/community-list.cases.json").cases;
const portalCases = json("lib/portal-admin/portal-settings.cases.json").cases;
const serviceCases = json("lib/services/service-settings.cases.json").cases;

// Las comprobaciones se anotan en una tabla temporal y se leen antes del ROLLBACK.
const T = (name, cond, detail = "NULL") => `INSERT INTO zz_res VALUES (${lit(name)}, (${cond}), (${detail})::text);`;

const parts = [
  "BEGIN",
  migration,
  migration405,
  `CREATE TEMP TABLE zz_res (name text, ok boolean, detail text) ON COMMIT DROP`,
  `CREATE TEMP TABLE zz (k text PRIMARY KEY, v text) ON COMMIT DROP`,
  // Corre un pedido y devuelve el error (o NULL si salió bien).
  `CREATE FUNCTION pg_temp.zz_err(q text) RETURNS text LANGUAGE plpgsql AS $f$ BEGIN EXECUTE q; RETURN NULL; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $f$`,
  `CREATE FUNCTION pg_temp.zz_get(k text) RETURNS text LANGUAGE sql AS $f$ SELECT v FROM zz WHERE zz.k = $1 $f$`,
  `CREATE FUNCTION pg_temp.zz_as(uid text) RETURNS void LANGUAGE sql AS $f$
     SELECT set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true),
            set_config('request.jwt.claim.sub', uid, true) $f$`,

  // ── 1. Gemelas ────────────────────────────────────────────────────────────
  ...listCases.map((c) => T(`gemela community_list_plan: ${c.name}`, `app_servicio.community_list_plan(${jlit(c.settings)}) = ${jlit(c.expected)}`, `app_servicio.community_list_plan(${jlit(c.settings)})`)),
  ...portalCases
    // Los casos con la extensión de proyectos necesitan un negocio que la tenga: los corre verify-services.
    .filter((c) => c.kind !== "workspace" && !c.ext)
    .map((c) => {
      const fn = c.kind === "variant" ? "validate_variant_portal_settings" : "validate_program_portal_settings";
      return T(`gemela ${fn}: ${c.name}`, `to_jsonb(app_servicio.${fn}(${jlit(c.settings)}, NULL)) = ${jlit(c.expected)}`, `to_jsonb(app_servicio.${fn}(${jlit(c.settings)}, NULL))`);
    }),
  ...serviceCases.map((c) => T(`gemela validate_service_settings: ${c.name}`, `to_jsonb(app_servicio.validate_service_settings(${jlit(c.settings)}, NULL)) = ${jlit(c.expected)}`, `to_jsonb(app_servicio.validate_service_settings(${jlit(c.settings)}, NULL))`)),

  // ── 2. Con una sola comunidad, como hoy (datos reales, sin tocarlos) ────────
  T("todos los posts de producción quedan en la principal", `NOT EXISTS (SELECT 1 FROM app_servicio_portal.community_posts WHERE community_key <> 'principal')`,
    `(SELECT count(*) FROM app_servicio_portal.community_posts WHERE community_key <> 'principal')`),
  T("ningún programa de producción tiene más de una comunidad", `NOT EXISTS (SELECT 1 FROM public.products p WHERE p.portal_enabled AND app_servicio.community_count(p.id) <> 1)`),
  T("cada persona con servicio está en la principal de su programa (contact_communities)",
    `NOT EXISTS (SELECT 1 FROM (SELECT DISTINCT contact_id, product_id FROM app_servicio.services WHERE status <> 'cancelled') s
                 WHERE app_servicio.contact_communities(s.contact_id, s.product_id) <> ARRAY['principal'])`),
  T("los espacios de la principal son los de siempre", `NOT EXISTS (SELECT 1 FROM public.products p WHERE p.portal_enabled
     AND app_servicio.community_spaces(p.id) IS DISTINCT FROM COALESCE((SELECT jsonb_agg(x) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p.portal_settings #> '{community,spaces}') = 'array' THEN p.portal_settings #> '{community,spaces}'
       ELSE '[{"key":"anuncios","name":"Anuncios","team_only":true},{"key":"general","name":"General"},{"key":"victorias","name":"Victorias"}]'::jsonb END) x WHERE x ->> 'key' IS DISTINCT FROM 'clases'), '[]'::jsonb))`),

  // ── 3. El negocio de prueba ────────────────────────────────────────────────
  `DO $do$
   DECLARE
     v_ws uuid; v_uid uuid; v_prod uuid; vA uuid; vL uuid; vL2 uuid; v_mod uuid; v_lesson uuid;
     cA uuid; cL uuid; cL2 uuid; cU uuid; sU uuid;
     v_portal jsonb := '{"v":1,"enabled":true,"sections":[{"section":"program","included":true,"content":{"modules":"all"}},{"section":"community","included":true},{"section":"calendar","included":true}]}';
     t text; c uuid; n integer := 0;
   BEGIN
     SELECT id INTO v_uid FROM auth.users ORDER BY created_at LIMIT 1;
     INSERT INTO public.workspaces (name, slug, timezone, services_enabled) VALUES ('zz-test-comunidades', 'zz-test-comunidades-' || md5(random()::text), 'UTC', true) RETURNING id INTO v_ws;
     INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES (v_ws, v_uid, 'owner');
     INSERT INTO public.products (workspace_id, name, product_type, portal_enabled, portal_settings)
     VALUES (v_ws, 'zz-test Academia', 'programa', true, jsonb_build_object('v', 1, 'sections', '{"program":true,"community":true,"calendar":true}'::jsonb,
       'community', jsonb_build_object('communities', '[{"key":"principal","name":"Academia","main":true},{"key":"lite","name":"Lite"}]'::jsonb),
       'points', '{"enabled":true,"levels":[{"min":0,"name":"Nivel 1"},{"min":10,"name":"Nivel 2"},{"min":20,"name":"Nivel 3"},{"min":30,"name":"Nivel 4"},{"min":40,"name":"Nivel 5"},{"min":50,"name":"Nivel 6"},{"min":60,"name":"Nivel 7"},{"min":70,"name":"Nivel 8"},{"min":80,"name":"Nivel 9"}]}'::jsonb))
     RETURNING id INTO v_prod;
     INSERT INTO public.product_variants (workspace_id, product_id, name, duration_type, duration_value, portal_settings)
       VALUES (v_ws, v_prod, 'zz-test Academia 6 meses', 'months', 6, v_portal) RETURNING id INTO vA;
     INSERT INTO public.product_variants (workspace_id, product_id, name, duration_type, duration_value, portal_settings)
       VALUES (v_ws, v_prod, 'zz-test Lite 12 meses', 'months', 12, v_portal || '{"community_key":"lite"}') RETURNING id INTO vL;
     INSERT INTO public.product_variants (workspace_id, product_id, name, duration_type, duration_value, portal_settings)
       VALUES (v_ws, v_prod, 'zz-test Lite mensual', 'months', 1, v_portal || '{"community_key":"lite"}') RETURNING id INTO vL2;
     UPDATE public.product_variants SET service_settings = jsonb_build_object('mode', 'none', 'closes_variant_ids', jsonb_build_array(vL, vL2)) WHERE id = vA;
     INSERT INTO app_servicio.program_items (workspace_id, product_id, kind, title, position, status) VALUES (v_ws, v_prod, 'module', 'zz-test Módulo', 0, 'active') RETURNING id INTO v_mod;
     INSERT INTO app_servicio.program_items (workspace_id, product_id, parent_id, kind, lesson_type, title, position, status, comments_enabled)
       VALUES (v_ws, v_prod, v_mod, 'lesson', 'video', 'zz-test Clase', 0, 'active', true) RETURNING id INTO v_lesson;
     PERFORM app_servicio.as_system();
     FOR t, c IN SELECT * FROM (VALUES ('A', vA), ('L', vL), ('L2', vL2), ('U', vL)) x(t, v) LOOP
       INSERT INTO public.contacts (workspace_id, display_name, email) VALUES (v_ws, 'zz-test ' || t, 'zz-test-' || lower(t) || '-' || md5(random()::text) || '@example.test') RETURNING id INTO cU;
       PERFORM app_servicio.svc_create_service(jsonb_build_object('contact_id', cU, 'variant_id', c, 'origin', 'manual', 'origin_reason', 'zz-test', 'owner_user_id', v_uid));
       INSERT INTO zz VALUES ('c' || t, cU::text);
       n := n + 1;
     END LOOP;
     PERFORM set_config('app_servicio.system', '', true);
     INSERT INTO zz VALUES ('ws', v_ws::text), ('uid', v_uid::text), ('prod', v_prod::text), ('vA', vA::text), ('vL', vL::text), ('vL2', vL2::text), ('lesson', v_lesson::text);
     -- Una sesión del portal por estudiante (token de 64 hex).
     FOR t IN SELECT unnest(ARRAY['A', 'L', 'L2', 'U']) LOOP
       INSERT INTO zz VALUES ('tok' || t, md5(random()::text) || md5(random()::text));
       INSERT INTO app_servicio_portal.portal_sessions (workspace_id, account_id, kind, token_hash, expires_at)
       SELECT v_ws, a.id, 'student', app_servicio.portal_token_hash(pg_temp.zz_get('tok' || t)), now() + interval '1 day'
         FROM app_servicio_portal.portal_accounts a WHERE a.contact_id = pg_temp.zz_get('c' || t)::uuid;
     END LOOP;
   END $do$`,
  T("se armaron las 4 cuentas del portal", `(SELECT count(*) FROM app_servicio_portal.portal_sessions s JOIN app_servicio_portal.portal_accounts a ON a.id = s.account_id WHERE a.workspace_id = pg_temp.zz_get('ws')::uuid) = 4`,
    `(SELECT count(*) FROM app_servicio_portal.portal_sessions s JOIN app_servicio_portal.portal_accounts a ON a.id = s.account_id WHERE a.workspace_id = pg_temp.zz_get('ws')::uuid)`),
  T("cada estudiante está en la comunidad de su variante",
    `app_servicio.contact_communities(pg_temp.zz_get('cA')::uuid, pg_temp.zz_get('prod')::uuid) = ARRAY['principal']
     AND app_servicio.contact_communities(pg_temp.zz_get('cL')::uuid, pg_temp.zz_get('prod')::uuid) = ARRAY['lite']
     AND app_servicio.contact_communities(pg_temp.zz_get('cL2')::uuid, pg_temp.zz_get('prod')::uuid) = ARRAY['lite']`),

  // Publicaciones de los estudiantes (llamando a la función del portal) y del equipo en las dos comunidades.
  `INSERT INTO zz SELECT 'pA', app_servicio_portal.portal_post_create(pg_temp.zz_get('tokA'), pg_temp.zz_get('prod')::uuid, 'general', 'zz-test hola desde la Academia') ->> 'id'`,
  `INSERT INTO zz SELECT 'pL', app_servicio_portal.portal_post_create(pg_temp.zz_get('tokL'), pg_temp.zz_get('prod')::uuid, 'general', 'zz-test hola desde Lite') ->> 'id'`,
  `INSERT INTO zz SELECT 'cmA', app_servicio_portal.portal_post_create(pg_temp.zz_get('tokA'), pg_temp.zz_get('prod')::uuid, 'clases', 'zz-test comentario Academia', NULL, pg_temp.zz_get('lesson')::uuid) ->> 'id'`,
  `INSERT INTO zz SELECT 'cmL', app_servicio_portal.portal_post_create(pg_temp.zz_get('tokL'), pg_temp.zz_get('prod')::uuid, 'clases', 'zz-test comentario Lite', NULL, pg_temp.zz_get('lesson')::uuid) ->> 'id'`,
  T("el post de Lite quedó en Lite y el de la Academia en la principal",
    `(SELECT community_key FROM app_servicio_portal.community_posts WHERE id = pg_temp.zz_get('pL')::uuid) = 'lite'
     AND (SELECT community_key FROM app_servicio_portal.community_posts WHERE id = pg_temp.zz_get('pA')::uuid) = 'principal'`),
  `SELECT pg_temp.zz_as(pg_temp.zz_get('uid'))`,
  `INSERT INTO zz SELECT 'team', app_servicio.community_team_post(pg_temp.zz_get('prod')::uuid, jsonb_build_object('title', 'zz-test 📣 Anuncio', 'body', 'zz-test anuncio para todos', 'space_key', 'anuncios', 'as_business', true, 'community_keys', jsonb_build_array('principal', 'lite')))::text`,
  T("criterio 7: el equipo publica un anuncio en las dos comunidades (un post en cada una)",
    `(SELECT array_agg(community_key ORDER BY community_key) FROM app_servicio_portal.community_posts WHERE product_id = pg_temp.zz_get('prod')::uuid AND body = 'zz-test anuncio para todos') = ARRAY['lite', 'principal']`),
  T("criterio 7: el equipo ve cada comunidad con el selector (community_feed con `community`)",
    `(SELECT jsonb_agg(x ->> 'community_key') FROM jsonb_array_elements(app_servicio.community_feed(pg_temp.zz_get('prod')::uuid, '{"community":"lite"}')) x) ?& ARRAY['lite']
     AND NOT (SELECT jsonb_agg(x ->> 'community_key') FROM jsonb_array_elements(app_servicio.community_feed(pg_temp.zz_get('prod')::uuid, '{"community":"lite"}')) x) ? 'principal'
     AND jsonb_array_length(app_servicio.community_feed(pg_temp.zz_get('prod')::uuid, '{}')) = 6`,
    `app_servicio.community_feed(pg_temp.zz_get('prod')::uuid, '{"community":"lite"}')::text`),
  T("los contadores separan por comunidad (by_community)",
    `(app_servicio.community_item_counts(pg_temp.zz_get('prod')::uuid) #>> '{by_community,lite,unanswered}')::int = 2
     AND (app_servicio.community_item_counts(pg_temp.zz_get('prod')::uuid) #>> '{by_community,principal,unanswered}')::int = 2`,
    `app_servicio.community_item_counts(pg_temp.zz_get('prod')::uuid)::text`),
  T("el equipo no publica en una comunidad que no existe",
    `pg_temp.zz_err(format('SELECT app_servicio.community_team_post(%L::uuid, %L::jsonb)', pg_temp.zz_get('prod'), '{"title":"x","body":"x","space_key":"general","as_business":true,"community_keys":["otra"]}')) LIKE '%No existe esa comunidad%'`),
  `SELECT set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true)`,


  // ── 00405: título y a quién le llega el correo ─────────────────────────────
  `SELECT pg_temp.zz_as(pg_temp.zz_get('uid'))`,
  T("00405: un post nuevo del equipo sin título no pasa",
    `pg_temp.zz_err(format('SELECT app_servicio.community_team_post(%L::uuid, %L::jsonb)', pg_temp.zz_get('prod'), '{"body":"x","space_key":"general","as_business":true}')) LIKE '%Escribí el título%'`),
  T("00405: un título de más de 200 no pasa",
    `pg_temp.zz_err(format('SELECT app_servicio.community_team_post(%L::uuid, %L::jsonb)', pg_temp.zz_get('prod'), jsonb_build_object('title', repeat('a', 201), 'body', 'x', 'space_key', 'general'))) LIKE '%200%'`),
  T("00405: el título queda guardado (con emojis) en las dos copias",
    `(SELECT bool_and(title = 'zz-test 📣 Anuncio') AND count(*) = 2 FROM app_servicio_portal.community_posts WHERE product_id = pg_temp.zz_get('prod')::uuid AND body = 'zz-test anuncio para todos')`),
  `INSERT INTO zz SELECT 'reply', app_servicio.community_team_post(pg_temp.zz_get('prod')::uuid, jsonb_build_object('title', 'no va', 'body', 'zz-test respuesta del equipo', 'parent_id', pg_temp.zz_get('team')))::text`,
  T("00405: una respuesta no lleva título", `(SELECT title IS NULL FROM app_servicio_portal.community_posts WHERE id = pg_temp.zz_get('reply')::uuid)`),
  `SELECT app_servicio.community_team_edit(pg_temp.zz_get('team')::uuid, jsonb_build_object('title', 'zz-test Nuevo título ✅', 'body', 'zz-test anuncio para todos'))`,
  T("00405: editar cambia el título", `(SELECT title FROM app_servicio_portal.community_posts WHERE id = pg_temp.zz_get('team')::uuid) = 'zz-test Nuevo título ✅'`),
  T("00405: editar no deja vaciar un título",
    `pg_temp.zz_err(format('SELECT app_servicio.community_team_edit(%L::uuid, %L::jsonb)', pg_temp.zz_get('team'), '{"title":"  ","body":"x"}')) LIKE '%Escribí el título%'`),
  T("00405: el feed del equipo devuelve el título",
    `EXISTS (SELECT 1 FROM jsonb_array_elements(app_servicio.community_feed(pg_temp.zz_get('prod')::uuid, '{}')) x WHERE x ->> 'title' = 'zz-test Nuevo título ✅')`),
  `SELECT set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true)`,
  T("00405: el portal recibe el título (post_row)",
    `EXISTS (SELECT 1 FROM jsonb_array_elements(app_servicio_portal.portal_feed(pg_temp.zz_get('tokL'), pg_temp.zz_get('prod')::uuid) -> 'posts') x WHERE x ->> 'title' = 'zz-test Nuevo título ✅')`,
    `app_servicio_portal.portal_feed(pg_temp.zz_get('tokL'), pg_temp.zz_get('prod')::uuid)::text`),
  // Las cuentas nacen «invited»: sin activar, no le llega a nadie; activas, a los de cada comunidad.
  T("00405: sin cuentas activas, no le llega a nadie",
    `NOT EXISTS (SELECT 1 FROM app_servicio.community_email_targets(pg_temp.zz_get('prod')::uuid, ARRAY['principal','lite']))`),
  `UPDATE app_servicio_portal.portal_accounts SET status = 'active' WHERE workspace_id = pg_temp.zz_get('ws')::uuid AND contact_id IN (pg_temp.zz_get('cA')::uuid, pg_temp.zz_get('cL')::uuid, pg_temp.zz_get('cL2')::uuid)`,
  T("00405: la principal le llega solo a la Academia",
    `(SELECT array_agg(contact_id) FROM app_servicio.community_email_targets(pg_temp.zz_get('prod')::uuid, ARRAY['principal'])) = ARRAY[pg_temp.zz_get('cA')::uuid]`,
    `(SELECT array_agg(contact_id)::text FROM app_servicio.community_email_targets(pg_temp.zz_get('prod')::uuid, ARRAY['principal']))`),
  T("00405: Lite le llega a los dos de Lite (no a la cuenta sin activar)",
    `(SELECT count(*) FROM app_servicio.community_email_targets(pg_temp.zz_get('prod')::uuid, ARRAY['lite'])) = 2
     AND NOT EXISTS (SELECT 1 FROM app_servicio.community_email_targets(pg_temp.zz_get('prod')::uuid, ARRAY['lite']) WHERE contact_id = pg_temp.zz_get('cU')::uuid)`),
  T("00405: las dos comunidades a la vez: una fila por persona",
    `(SELECT count(*) = count(DISTINCT contact_id) AND count(*) = 3 FROM app_servicio.community_email_targets(pg_temp.zz_get('prod')::uuid, ARRAY['principal','lite']))`),
  `UPDATE app_servicio_portal.portal_accounts SET status = 'suspended', suspended_at = now() WHERE contact_id = pg_temp.zz_get('cL2')::uuid`,
  T("00405: una cuenta suspendida no recibe",
    `(SELECT count(*) FROM app_servicio.community_email_targets(pg_temp.zz_get('prod')::uuid, ARRAY['lite'])) = 1`),
  `UPDATE app_servicio_portal.portal_accounts SET status = 'active', suspended_at = NULL WHERE contact_id = pg_temp.zz_get('cL2')::uuid`,
  T("00405: solo service_role puede pedir los destinatarios",
    `NOT has_function_privilege('authenticated', 'app_servicio.community_email_targets(uuid, text[])', 'EXECUTE')
     AND NOT has_function_privilege('anon', 'app_servicio.community_email_targets(uuid, text[])', 'EXECUTE')
     AND has_function_privilege('service_role', 'app_servicio.community_email_targets(uuid, text[])', 'EXECUTE')`),

  // Criterio 2: el muro y los comentarios de la clase.
  T("criterio 2: Lite no ve nada de la Academia en el muro (y ve el anuncio de Lite)",
    `(SELECT bool_and(x ->> 'body' NOT LIKE '%Academia%') AND count(*) = 2 FROM jsonb_array_elements(app_servicio_portal.portal_feed(pg_temp.zz_get('tokL'), pg_temp.zz_get('prod')::uuid) -> 'posts') x)`,
    `app_servicio_portal.portal_feed(pg_temp.zz_get('tokL'), pg_temp.zz_get('prod')::uuid)::text`),
  T("criterio 2: la Academia no ve nada de Lite en el muro",
    `(SELECT bool_and(x ->> 'body' NOT LIKE '%Lite%') AND count(*) = 2 FROM jsonb_array_elements(app_servicio_portal.portal_feed(pg_temp.zz_get('tokA'), pg_temp.zz_get('prod')::uuid) -> 'posts') x)`),
  T("criterio 2: debajo de la clase, cada uno ve solo los comentarios de su comunidad",
    `(SELECT array_agg(x ->> 'body') FROM jsonb_array_elements(app_servicio_portal.portal_lesson_comments(pg_temp.zz_get('tokL'), pg_temp.zz_get('lesson')::uuid) -> 'posts') x) = ARRAY['zz-test comentario Lite']
     AND (SELECT array_agg(x ->> 'body') FROM jsonb_array_elements(app_servicio_portal.portal_lesson_comments(pg_temp.zz_get('tokA'), pg_temp.zz_get('lesson')::uuid) -> 'posts') x) = ARRAY['zz-test comentario Academia']`),
  T("criterio 2: el número de comentarios de la clase es el de su comunidad",
    `(app_servicio_portal.lesson_row(pg_temp.zz_get('cL')::uuid, (SELECT i FROM app_servicio.program_items i WHERE i.id = pg_temp.zz_get('lesson')::uuid)) ->> 'comments')::int = 1`),
  // Criterio 3: publicar en la otra comunidad, ni llamando a las funciones.
  T("criterio 3: Lite no puede responder un post de la Academia",
    `pg_temp.zz_err(format('SELECT app_servicio_portal.portal_post_create(%L, %L::uuid, %L, %L, %L::uuid)', pg_temp.zz_get('tokL'), pg_temp.zz_get('prod'), 'general', 'zz-test intruso', pg_temp.zz_get('pA'))) LIKE '%ya no está%'`),
  T("criterio 3: Lite no puede reaccionar ni reportar un post de la Academia",
    `pg_temp.zz_err(format('SELECT app_servicio_portal.portal_react(%L, %L::uuid, %L)', pg_temp.zz_get('tokL'), pg_temp.zz_get('pA'), 'like')) LIKE '%ya no está%'
     AND pg_temp.zz_err(format('SELECT app_servicio_portal.portal_report(%L, %L::uuid, %L)', pg_temp.zz_get('tokL'), pg_temp.zz_get('pA'), 'x')) LIKE '%ya no está%'`),
  T("criterio 3: Lite no puede elegir la comunidad de la Academia",
    `pg_temp.zz_err(format('SELECT app_servicio_portal.portal_community_choose(%L, %L::uuid, %L)', pg_temp.zz_get('tokL'), pg_temp.zz_get('prod'), 'principal')) LIKE '%no es la tuya%'`),
  T("criterio 3: el chequeo en la comunidad de otro dice que no", `NOT (app_servicio.community_can_post_check_in(pg_temp.zz_get('cL')::uuid, pg_temp.zz_get('prod')::uuid, 'principal', 'general') ->> 'ok')::boolean`),
  // Criterio 4: dos variantes en «Lite» comparten muro y comentarios.
  T("criterio 4: Lite mensual ve el post y el comentario de Lite 12 meses",
    `EXISTS (SELECT 1 FROM jsonb_array_elements(app_servicio_portal.portal_feed(pg_temp.zz_get('tokL2'), pg_temp.zz_get('prod')::uuid) -> 'posts') x WHERE x ->> 'body' = 'zz-test hola desde Lite')
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(app_servicio_portal.portal_lesson_comments(pg_temp.zz_get('tokL2'), pg_temp.zz_get('lesson')::uuid) -> 'posts') x WHERE x ->> 'body' = 'zz-test comentario Lite')`),
  T("criterio 4: Lite mensual puede responder en Lite",
    `pg_temp.zz_err(format('SELECT app_servicio_portal.portal_post_create(%L, %L::uuid, %L, %L, %L::uuid)', pg_temp.zz_get('tokL2'), pg_temp.zz_get('prod'), 'general', 'zz-test respuesta', pg_temp.zz_get('pL'))) IS NULL`),
  T("la cabecera de Lite cuenta a los de Lite y dice sus comunidades",
    `(app_servicio_portal.portal_community_info(pg_temp.zz_get('tokL'), pg_temp.zz_get('prod')::uuid) ->> 'members')::int = 3
     AND app_servicio_portal.portal_community_info(pg_temp.zz_get('tokL'), pg_temp.zz_get('prod')::uuid) -> 'communities' = '[{"key":"lite","name":"Lite"}]'::jsonb`,
    `app_servicio_portal.portal_community_info(pg_temp.zz_get('tokL'), pg_temp.zz_get('prod')::uuid)::text`),
  T("los espacios del portal son los de su comunidad", `jsonb_array_length(app_servicio_portal.portal_spaces(pg_temp.zz_get('tokL'), pg_temp.zz_get('prod')::uuid)) = 3`),

  // Criterio 5: no se archiva una comunidad que usa una variante.
  T("criterio 5: archivar «Lite» con variantes que la usan da error y dice cuáles",
    `EXISTS (SELECT 1 FROM unnest(app_servicio.validate_program_portal_settings(jsonb_build_object('community', '{"communities":[{"key":"principal","name":"Academia","main":true},{"key":"lite","name":"Lite","archived":true}]}'::jsonb), pg_temp.zz_get('prod')::uuid)) p
             WHERE p LIKE '«Lite» la usan estas variantes: zz-test Lite 12 meses, zz-test Lite mensual%')`),
  T("una variante no elige una comunidad que no existe",
    `'esa comunidad no existe o está archivada' = ANY (app_servicio.validate_variant_portal_settings('{"community_key":"otra"}', pg_temp.zz_get('vA')::uuid))`),
  `SELECT pg_temp.zz_as(pg_temp.zz_get('uid'))`,
  T("una comunidad no se borra (se archiva) · guardar sin «Lite» no pasa",
    `app_servicio.portal_admin_save_program_settings(pg_temp.zz_get('prod')::uuid, '{"community":{"communities":[{"key":"principal","name":"Academia","main":true}]}}', (SELECT portal_settings_rev FROM public.products WHERE id = pg_temp.zz_get('prod')::uuid)) -> 'problems' ? 'una comunidad no se borra: archivala'`,
    `app_servicio.portal_admin_save_program_settings(pg_temp.zz_get('prod')::uuid, '{"community":{"communities":[{"key":"principal","name":"Academia","main":true}]}}', 0)::text`),
  T("guardar los espacios a la vieja no se lleva las comunidades",
    `app_servicio.portal_admin_save_program_settings(pg_temp.zz_get('prod')::uuid, '{"community":{"spaces":[{"key":"general","name":"General"}]}}', (SELECT portal_settings_rev FROM public.products WHERE id = pg_temp.zz_get('prod')::uuid)) ->> 'status' = 'ok'
     AND app_servicio.community_count(pg_temp.zz_get('prod')::uuid) = 2`),
  `SELECT set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true)`,

  // Puntos: el ranking de Lite son los de Lite.
  `INSERT INTO app_servicio_portal.points_ledger (workspace_id, contact_id, product_id, source_key, point_group, points, reason, local_day)
   SELECT pg_temp.zz_get('ws')::uuid, pg_temp.zz_get(k)::uuid, pg_temp.zz_get('prod')::uuid, 'manual:zz_' || lower(k), 'equipo', p, 'zz-test', current_date
     FROM (VALUES ('cA', 50), ('cL', 20), ('cL2', 5)) x(k, p)`,
  T("decisión 4: el ranking de Lite solo tiene a los de Lite",
    `(SELECT count(*) FROM jsonb_array_elements(app_servicio_portal.portal_points(pg_temp.zz_get('tokL'), pg_temp.zz_get('prod')::uuid) -> 'ranking')) = 2
     AND (app_servicio_portal.portal_points(pg_temp.zz_get('tokL'), pg_temp.zz_get('prod')::uuid) ->> 'my_place')::int = 1`,
    `app_servicio_portal.portal_points(pg_temp.zz_get('tokL'), pg_temp.zz_get('prod')::uuid)::text`),
  T("decisión 4: el ranking del equipo por comunidad", `(app_servicio.points_ranking(pg_temp.zz_get('prod')::uuid, 50, 'lite') ->> 'students')::int = 2
     AND (app_servicio.points_ranking(pg_temp.zz_get('prod')::uuid, 50, NULL) ->> 'students')::int = 3`),

  // Clases en vivo: una sesión semanal de la Academia con UNA fecha abierta a Lite.
  `DO $do$ DECLARE v_ls uuid; v_day date; BEGIN
     INSERT INTO app_servicio.live_sessions (workspace_id, product_id, title, kind, weekdays, every_weeks, starts_on, start_time, duration_minutes, timezone, variant_ids, meeting_url)
     VALUES (pg_temp.zz_get('ws')::uuid, pg_temp.zz_get('prod')::uuid, 'zz-test En vivo', 'weekly', ARRAY[EXTRACT(isodow FROM current_date)::int], 1, current_date, '23:00', 60, 'UTC',
             ARRAY[pg_temp.zz_get('vA')::uuid], 'https://example.test/sala') RETURNING id INTO v_ls;
     v_day := current_date + 14;
     PERFORM app_servicio.as_system();
     PERFORM app_servicio.live_date_save(v_ls, v_day, jsonb_build_object('extra_variant_ids', jsonb_build_array(pg_temp.zz_get('vL'))));
     PERFORM set_config('app_servicio.system', '', true);
     INSERT INTO zz VALUES ('ls', v_ls::text), ('day', v_day::text);
   END $do$`,
  T("R7: Lite ve solo la fecha que se le abrió",
    `(SELECT array_agg(x ->> 'occurs_on') FROM jsonb_array_elements(app_servicio_portal.portal_calendar(pg_temp.zz_get('tokL'), pg_temp.zz_get('prod')::uuid, current_date, current_date + 28) -> 'dates') x) = ARRAY[pg_temp.zz_get('day')]`,
    `app_servicio_portal.portal_calendar(pg_temp.zz_get('tokL'), pg_temp.zz_get('prod')::uuid, current_date, current_date + 28)::text`),
  T("R7: la Academia ve todas las fechas",
    `jsonb_array_length(app_servicio_portal.portal_calendar(pg_temp.zz_get('tokA'), pg_temp.zz_get('prod')::uuid, current_date, current_date + 28) -> 'dates') >= 4`),
  T("R7: Lite entra a la fecha abierta y no a las otras",
    `pg_temp.zz_err(format('SELECT app_servicio_portal.live_for(app_servicio_portal.session_resolve(%L), %L::uuid, %L::date)', pg_temp.zz_get('tokL'), pg_temp.zz_get('ls'), pg_temp.zz_get('day'))) IS NULL
     AND pg_temp.zz_err(format('SELECT app_servicio_portal.live_for(app_servicio_portal.session_resolve(%L), %L::uuid, %L::date)', pg_temp.zz_get('tokL'), pg_temp.zz_get('ls'), (pg_temp.zz_get('day')::date - 7)::text)) LIKE '%no existe%'`),
  T("R7: la asistencia de esa fecha cuenta a Lite; la de otra fecha no",
    `pg_temp.zz_get('cL')::uuid IN (SELECT contact_id FROM app_servicio.attendance_base_members(pg_temp.zz_get('ls')::uuid, pg_temp.zz_get('day')::date))
     AND pg_temp.zz_get('cL')::uuid NOT IN (SELECT contact_id FROM app_servicio.attendance_base_members(pg_temp.zz_get('ls')::uuid, pg_temp.zz_get('day')::date - 7))`),

  // Criterio 6: el upgrade.
  `DO $do$ BEGIN
     PERFORM app_servicio.as_system();
     INSERT INTO zz SELECT 'sU', id::text FROM app_servicio.services WHERE contact_id = pg_temp.zz_get('cU')::uuid;
     INSERT INTO zz SELECT 'accU', count(*)::text FROM app_servicio_portal.portal_access WHERE contact_id = pg_temp.zz_get('cU')::uuid AND revoked_at IS NULL;
     INSERT INTO zz SELECT 'pU', app_servicio_portal.portal_post_create(pg_temp.zz_get('tokU'), pg_temp.zz_get('prod')::uuid, 'general', 'zz-test post de Lite antes del upgrade') ->> 'id';
     INSERT INTO app_servicio_portal.program_progress (workspace_id, contact_id, program_item_id, viewed_at, completed_at)
       VALUES (pg_temp.zz_get('ws')::uuid, pg_temp.zz_get('cU')::uuid, pg_temp.zz_get('lesson')::uuid, now(), now());
     INSERT INTO zz SELECT 'sU2', app_servicio.svc_create_service(jsonb_build_object('contact_id', pg_temp.zz_get('cU'), 'variant_id', pg_temp.zz_get('vA'),
       'origin', 'manual', 'origin_reason', 'zz-test upgrade', 'owner_user_id', pg_temp.zz_get('uid')))::text;
     PERFORM set_config('app_servicio.system', '', true);
   END $do$`,
  T("criterio 6: la Lite queda «Renovado» con el motivo",
    `(SELECT status = 'renewed' AND flags ->> 'closed_reason' = 'Pasó a zz-test Academia' FROM app_servicio.services WHERE id = pg_temp.zz_get('sU')::uuid)`,
    `(SELECT status || ' · ' || COALESCE(flags ->> 'closed_reason', '') FROM app_servicio.services WHERE id = pg_temp.zz_get('sU')::uuid)`),
  T("criterio 6: el acceso nunca se corta (la comunidad y el programa siguen abiertos)",
    `app_servicio.portal_access_effective(pg_temp.zz_get('cU')::uuid, pg_temp.zz_get('prod')::uuid, 'community') IS NOT NULL
     AND app_servicio.portal_access_effective(pg_temp.zz_get('cU')::uuid, pg_temp.zz_get('prod')::uuid, 'program') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM app_servicio_portal.portal_access WHERE service_id = pg_temp.zz_get('sU')::uuid AND revoked_at IS NULL AND until_type = 'service')`),
  T("criterio 6: el avance se mantiene", `EXISTS (SELECT 1 FROM app_servicio_portal.program_progress WHERE contact_id = pg_temp.zz_get('cU')::uuid AND completed_at IS NOT NULL)`),
  T("criterio 6: después del upgrade solo ve la comunidad de la Academia (sus posts de Lite quedan en Lite)",
    `app_servicio.contact_communities(pg_temp.zz_get('cU')::uuid, pg_temp.zz_get('prod')::uuid) = ARRAY['principal']
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(app_servicio_portal.portal_feed(pg_temp.zz_get('tokU'), pg_temp.zz_get('prod')::uuid) -> 'posts') x WHERE x ->> 'body' LIKE '%Lite%')
     AND (SELECT community_key FROM app_servicio_portal.community_posts WHERE id = pg_temp.zz_get('pU')::uuid) = 'lite'`),
  T("criterio 6: un servicio de otra variante no cierra nada",
    `(SELECT status FROM app_servicio.services WHERE contact_id = pg_temp.zz_get('cL2')::uuid) = 'active'`),

  // Con dos servicios activos en comunidades distintas: elige en el portal.
  `DO $do$ BEGIN
     PERFORM app_servicio.as_system();
     UPDATE public.product_variants SET service_settings = '{"mode":"none"}' WHERE id = pg_temp.zz_get('vA')::uuid;
     PERFORM app_servicio.svc_create_service(jsonb_build_object('contact_id', pg_temp.zz_get('cL2'), 'variant_id', pg_temp.zz_get('vA'), 'origin', 'manual', 'origin_reason', 'zz-test dos', 'owner_user_id', pg_temp.zz_get('uid')));
     PERFORM set_config('app_servicio.system', '', true);
   END $do$`,
  T("R3.2: con dos comunidades, el portal las lista y empieza en la primera",
    `app_servicio_portal.portal_community_info(pg_temp.zz_get('tokL2'), pg_temp.zz_get('prod')::uuid) -> 'communities' = '[{"key":"principal","name":"Academia"},{"key":"lite","name":"Lite"}]'::jsonb
     AND app_servicio_portal.portal_community_info(pg_temp.zz_get('tokL2'), pg_temp.zz_get('prod')::uuid) ->> 'community' = 'principal'`),
  T("R3.2: elige Lite", `(app_servicio_portal.portal_community_choose(pg_temp.zz_get('tokL2'), pg_temp.zz_get('prod')::uuid, 'lite') ->> 'ok')::boolean`),
  `INSERT INTO zz SELECT 'pL2', app_servicio_portal.portal_post_create(pg_temp.zz_get('tokL2'), pg_temp.zz_get('prod')::uuid, 'general', 'zz-test elegí Lite') ->> 'id'`,
  T("R3.2: con Lite elegida, ve y publica en Lite",
    `EXISTS (SELECT 1 FROM jsonb_array_elements(app_servicio_portal.portal_feed(pg_temp.zz_get('tokL2'), pg_temp.zz_get('prod')::uuid) -> 'posts') x WHERE x ->> 'body' = 'zz-test hola desde Lite')
     AND (SELECT community_key FROM app_servicio_portal.community_posts WHERE id = pg_temp.zz_get('pL2')::uuid) = 'lite'`,
    `app_servicio_portal.portal_feed(pg_temp.zz_get('tokL2'), pg_temp.zz_get('prod')::uuid)::text`),

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
console.log(applied ? "La 00402 ya está aplicada." : "La 00402 se aplicó adentro de la transacción (y se deshizo).");
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
