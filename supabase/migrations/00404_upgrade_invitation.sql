-- @plantilla-quitar(servicios)
-- 00404 · Invitación para pasarse (módulos que la variante no incluye)
--
-- Una variante con menos contenido (por ejemplo, una «Lite») puede mostrar en el portal los módulos del programa que NO
-- incluye: con candado, o con candado y una invitación para pasarse (texto, botón y a dónde lleva). Tocar el botón queda
-- registrado y, una vez cada 7 días por persona, pone una etiqueta, avisa al equipo y dispara «Tocó la invitación para
-- pasarse» en Automatizaciones. Requerimientos: «Requerimientos · Invitación para pasarse a la Academy» (18/11/2026).
--
--   product_variants.portal_settings.sections[program].not_included
--     { mode: hidden|locked|invite, label, text, button,
--       target: { kind: link|form|event|whatsapp, id?, url?, value?, prefill? },
--       on_click: { tag_id?, notify?: owner|admins|<user> } }
--   app_servicio_portal.upgrade_events            vistas de la tarjeta y toques del botón.
--
-- Nada cambia hasta que una variante elige otra cosa que `hidden` (sin la clave, vale `hidden`): `portal_program` sigue
-- devolviendo lo mismo y en el mismo orden. Un módulo no incluido nunca se abre: `portal_module`, `portal_lesson` y los
-- archivos siguen pidiendo que la persona lo tenga; lo único que se suma es su portada.
--
-- Las funciones que se redefinen (portal_section_rule_problems, portal_program, portal_file_grant) parten de su
-- definición EN LA BASE (pg_get_functiondef del 18/11/2026, después de la 00403).
--
-- Rollback (en este orden):
--   las tres funciones redefinidas, con su definición de la 00403 (portal_program es la de la 00387,
--     portal_file_grant la de la 00399, portal_section_rule_problems(jsonb) la de la 00332);
--   triggers_type_check sin 'service_upgrade_interest' (antes, borrar los disparadores de ese tipo);
--   DROP FUNCTION app_servicio.upgrade_interest_stats(uuid), app_servicio_portal.portal_upgrade_event(text, uuid, uuid, text),
--     app_servicio_portal.module_teaser_row(uuid, app_servicio.program_items, jsonb),
--     app_servicio.program_not_included_config(uuid, uuid), app_servicio.not_included_problems(jsonb),
--     app_servicio.url_encode(text);
--   DROP TABLE app_servicio_portal.upgrade_events;
--   y sacar `not_included` de las variantes que la tengan (si no, el validador viejo la rechaza al guardar).

-- ─── 1. Validación de la configuración ─────────────────────────────────────
-- Gemela de `notIncludedProblems` en lib/portal-admin/settings.ts (casos en portal-settings.cases.json).
-- Con `hidden` no se mira el resto: se puede apagar sin borrar lo escrito.
CREATE OR REPLACE FUNCTION app_servicio.not_included_problems(p_rule jsonb)
RETURNS text[] LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  v text[] := ARRAY[]::text[];
  sec text := p_rule ->> 'section';
  n jsonb := p_rule -> 'not_included';
  c jsonb := p_rule -> 'content';
  t jsonb;
  oc jsonb;
  m text;
BEGIN
  IF jsonb_typeof(n) IS DISTINCT FROM 'object' THEN RETURN ARRAY[sec || ': los módulos no incluidos no son válidos']; END IF;
  v := v || app_servicio.unknown_keys(n, ARRAY['mode','label','text','button','target','on_click']);
  IF sec IS DISTINCT FROM 'program' THEN RETURN v || (sec || ': solo el Programa muestra los módulos no incluidos'); END IF;
  m := CASE WHEN jsonb_typeof(n -> 'mode') = 'string' THEN n ->> 'mode' END;
  IF NOT COALESCE(m = ANY (ARRAY['hidden','locked','invite']), false) THEN RETURN v || (sec || ': elegí cómo se ven los módulos no incluidos'); END IF;
  IF m = 'hidden' THEN RETURN v; END IF;
  IF NOT (jsonb_typeof(c) = 'object' AND jsonb_typeof(c -> 'modules') = 'array') THEN
    v := v || (sec || ': con todo el programa incluido no hay módulos para mostrar');
  END IF;
  IF n ? 'label' AND NOT (jsonb_typeof(n -> 'label') = 'string' AND char_length(n ->> 'label') <= 40) THEN
    v := v || (sec || ': la etiqueta va hasta 40 caracteres');
  ELSIF m = 'invite' AND NULLIF(btrim(COALESCE(n ->> 'label', '')), '') IS NULL THEN
    v := v || (sec || ': escribí la etiqueta de los módulos no incluidos');
  END IF;
  IF n ? 'text' AND NOT (jsonb_typeof(n -> 'text') = 'string' AND char_length(n ->> 'text') <= 400) THEN
    v := v || (sec || ': el texto de la invitación va hasta 400 caracteres');
  ELSIF m = 'invite' AND NULLIF(btrim(COALESCE(n ->> 'text', '')), '') IS NULL THEN
    v := v || (sec || ': escribí el texto de la invitación');
  END IF;
  IF n ? 'button' AND NOT (jsonb_typeof(n -> 'button') = 'string' AND char_length(n ->> 'button') <= 30) THEN
    v := v || (sec || ': el botón va hasta 30 caracteres');
  ELSIF m = 'invite' AND NULLIF(btrim(COALESCE(n ->> 'button', '')), '') IS NULL THEN
    v := v || (sec || ': escribí el texto del botón');
  END IF;
  IF n ? 'target' OR m = 'invite' THEN
    t := n -> 'target';
    IF jsonb_typeof(t) IS DISTINCT FROM 'object' OR NOT COALESCE(t ->> 'kind' = ANY (ARRAY['link','form','event','whatsapp']), false) THEN
      v := v || (sec || ': elegí a dónde lleva el botón');
    ELSE
      v := v || app_servicio.unknown_keys(t, ARRAY['kind','id','url','value','prefill']);
      IF t ->> 'kind' = 'link' AND NOT (jsonb_typeof(t -> 'url') = 'string' AND t ->> 'url' ~ '^https://\S+$' AND char_length(t ->> 'url') <= 2000) THEN
        v := v || (sec || ': el link tiene que empezar con https://');
      END IF;
      IF t ->> 'kind' IN ('form','event') AND NOT (app_servicio.j_uuid(t -> 'id') AND jsonb_typeof(t -> 'url') = 'string'
           AND t ->> 'url' ~ '^https?://\S+$' AND char_length(t ->> 'url') <= 2000) THEN
        v := v || (sec || ': elegí el formulario o la agenda');
      END IF;
      IF t ->> 'kind' = 'whatsapp' AND NOT (jsonb_typeof(t -> 'value') = 'string' AND t ->> 'value' ~ '^[1-9][0-9]{7,14}$') THEN
        v := v || (sec || ': el WhatsApp va con el código de país, solo números');
      END IF;
      IF t ? 'prefill' AND NOT (jsonb_typeof(t -> 'prefill') = 'string' AND char_length(t ->> 'prefill') <= 500) THEN
        v := v || (sec || ': el mensaje de WhatsApp va hasta 500 caracteres');
      END IF;
    END IF;
  END IF;
  IF n ? 'on_click' THEN
    oc := n -> 'on_click';
    IF jsonb_typeof(oc) IS DISTINCT FROM 'object' THEN
      v := v || (sec || ': revisá qué pasa al tocar el botón');
    ELSE
      v := v || app_servicio.unknown_keys(oc, ARRAY['tag_id','notify']);
      IF (oc ? 'tag_id' AND jsonb_typeof(oc -> 'tag_id') <> 'null' AND NOT app_servicio.j_uuid(oc -> 'tag_id'))
         OR (oc ? 'notify' AND jsonb_typeof(oc -> 'notify') <> 'null'
             AND NOT (jsonb_typeof(oc -> 'notify') = 'string' AND (oc ->> 'notify' IN ('owner','admins') OR app_servicio.j_uuid(oc -> 'notify')))) THEN
        v := v || (sec || ': revisá qué pasa al tocar el botón');
      END IF;
    END IF;
  END IF;
  RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION app_servicio.not_included_problems(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_servicio.not_included_problems(jsonb) TO authenticated, service_role;

-- La lista de claves de una sección suma `not_included` (definición viva, 00332).
CREATE OR REPLACE FUNCTION app_servicio.portal_section_rule_problems(p_rule jsonb)
 RETURNS text[]
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE
  v text[] := ARRAY[]::text[];
  sec text := p_rule ->> 'section';
  o jsonb; u jsonb; c jsonb; l jsonb; a jsonb;
BEGIN
  v := v || app_servicio.unknown_keys(p_rule, ARRAY['section','included','display','content','opens','until','limits','ai_limit_usd','not_included']);
  IF NOT COALESCE(sec = ANY (ARRAY['program','calendar','challenge','certificate','assistant','community','affiliates','fame','projects']), false) THEN
    RETURN v || ('sección desconocida: ' || COALESCE(sec, 'undefined'));
  END IF;
  IF NOT COALESCE(sec = ANY (ARRAY['program','calendar','challenge','certificate','assistant','community','affiliates']), false) THEN
    RETURN v || 'Todavía no está disponible'::text;
  END IF;
  IF p_rule ? 'display' AND NOT COALESCE(p_rule ->> 'display' = ANY (ARRAY['locked','coming_soon','hidden']), false) THEN v := v || (sec || ': elegí cómo se ve mientras está cerrada'); END IF;
  IF p_rule ? 'content' THEN
    c := p_rule -> 'content';
    IF NOT (jsonb_typeof(c) = 'object' AND (c -> 'modules' = '"all"'::jsonb OR (jsonb_typeof(c -> 'modules') = 'array' AND jsonb_array_length(c -> 'modules') > 0
         AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(c -> 'modules') m WHERE NOT app_servicio.j_uuid(m))))) THEN
      v := v || (sec || ': elegí el contenido incluido');
    ELSIF sec <> 'program' THEN
      v := v || (sec || ': solo el Programa elige contenido');
    END IF;
  END IF;
  IF p_rule ? 'opens' THEN
    o := p_rule -> 'opens';
    IF jsonb_typeof(o) <> 'object' OR NOT COALESCE(o ->> 'type' = ANY (ARRAY['service_start','days_after_start','fixed_date','phase_completed','item_completed',
         'module_completed','challenge_started','journey_item','automation']), false) THEN
      v := v || (sec || ': elegí cuándo se abre');
    ELSE
      IF o ->> 'type' = 'days_after_start' AND NOT (app_servicio.j_int(o -> 'days') AND app_servicio.j_num(o -> 'days') BETWEEN 1 AND 3650) THEN v := v || (sec || ': elegí cuántos días después del inicio'); END IF;
      IF o ->> 'type' = 'fixed_date' AND NOT app_servicio.j_date(o -> 'date') THEN v := v || (sec || ': elegí la fecha en que se abre'); END IF;
      IF o ->> 'type' IN ('phase_completed','item_completed','module_completed') AND NOT (jsonb_typeof(o -> 'ref') = 'string' AND o ->> 'ref' <> '') THEN
        v := v || (sec || ': elegí qué la abre');
      END IF;
    END IF;
  END IF;
  IF p_rule ? 'until' THEN
    u := p_rule -> 'until';
    IF jsonb_typeof(u) <> 'object' OR NOT COALESCE(u ->> 'type' = ANY (ARRAY['service','days','months','fixed_date','phase_completed','item_completed','forever']), false) THEN
      v := v || (sec || ': elegí hasta cuándo dura');
    ELSE
      IF u ->> 'type' IN ('days','months') AND NOT (app_servicio.j_int(u -> 'n') AND app_servicio.j_num(u -> 'n') BETWEEN 1 AND 3650) THEN v := v || (sec || ': elegí cuánto dura'); END IF;
      IF u ->> 'type' = 'fixed_date' AND NOT app_servicio.j_date(u -> 'date') THEN v := v || (sec || ': elegí la fecha en que termina'); END IF;
      IF u ->> 'type' IN ('phase_completed','item_completed') AND NOT (jsonb_typeof(u -> 'ref') = 'string' AND u ->> 'ref' <> '') THEN v := v || (sec || ': elegí qué la termina'); END IF;
    END IF;
  END IF;
  IF p_rule ? 'limits' THEN
    l := p_rule -> 'limits';
    IF jsonb_typeof(l) <> 'object' OR (l ? 'community_can_post' AND jsonb_typeof(l -> 'community_can_post') <> 'boolean') THEN v := v || (sec || ': los límites no son válidos'); END IF;
  END IF;
  IF p_rule ? 'ai_limit_usd' AND jsonb_typeof(p_rule -> 'ai_limit_usd') <> 'null' THEN
    a := p_rule -> 'ai_limit_usd';
    IF NOT (jsonb_typeof(a) = 'number' AND app_servicio.j_num(a) BETWEEN 0 AND 10000) THEN v := v || (sec || ': el límite de IA va de 0 a 10.000 dólares');
    ELSIF sec <> 'assistant' THEN v := v || (sec || ': solo el Asistente IA tiene límite de gasto');
    END IF;
  END IF;
  -- 00404: los módulos que la variante no incluye (con candado o con la invitación para pasarse).
  IF p_rule ? 'not_included' THEN v := v || app_servicio.not_included_problems(p_rule); END IF;
  RETURN v;
END;
$function$;


-- ─── 2. Lo que vale para cada persona ──────────────────────────────────────
-- Para el mensaje de WhatsApp del botón (wa.me/<número>?text=…).
CREATE OR REPLACE FUNCTION app_servicio.url_encode(p text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT COALESCE(string_agg(
    CASE WHEN ch ~ '^[A-Za-z0-9_.~-]$' THEN ch
         ELSE (SELECT string_agg('%' || upper(lpad(to_hex(get_byte(convert_to(ch, 'UTF8'), i)), 2, '0')), '' ORDER BY i)
                 FROM generate_series(0, octet_length(convert_to(ch, 'UTF8')) - 1) i) END, '' ORDER BY n), '')
    FROM regexp_split_to_table(COALESCE(p, ''), '') WITH ORDINALITY AS t(ch, n);
$$;
REVOKE ALL ON FUNCTION app_servicio.url_encode(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_servicio.url_encode(text) TO authenticated, service_role;

-- La configuración de los módulos no incluidos que vale para la persona en el programa: la de su servicio vigente más
-- reciente que no la tenga en `hidden` (con su servicio y su variante). NULL si no hay ninguna o si algún servicio
-- incluye todo el programa (la misma unión que `program_item_unlocked`: con «todo» no hay nada que mostrar).
CREATE OR REPLACE FUNCTION app_servicio.program_not_included_config(p_contact_id uuid, p_product_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_all boolean;
  r record;
BEGIN
  SELECT bool_or(COALESCE(x -> 'content' ->> 'modules', 'all') = 'all' OR jsonb_typeof(x -> 'content' -> 'modules') IS DISTINCT FROM 'array')
    INTO v_all
    FROM app_servicio.services s
    JOIN public.product_variants v ON v.id = s.product_variant_id
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(v.portal_settings -> 'sections') = 'array' THEN v.portal_settings -> 'sections' ELSE '[]'::jsonb END) x
   WHERE s.contact_id = p_contact_id AND s.product_id = p_product_id AND s.status IN ('active', 'paused', 'completed') AND x ->> 'section' = 'program';
  IF v_all IS NOT FALSE THEN RETURN NULL; END IF;
  SELECT s.id AS service_id, s.product_variant_id AS variant_id, x -> 'not_included' AS cfg INTO r
    FROM app_servicio.services s
    JOIN public.product_variants v ON v.id = s.product_variant_id
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(v.portal_settings -> 'sections') = 'array' THEN v.portal_settings -> 'sections' ELSE '[]'::jsonb END) x
   WHERE s.contact_id = p_contact_id AND s.product_id = p_product_id AND s.status IN ('active', 'paused', 'completed')
     AND x ->> 'section' = 'program' AND jsonb_typeof(x -> 'not_included') = 'object' AND x -> 'not_included' ->> 'mode' IN ('locked', 'invite')
   ORDER BY s.created_at DESC, s.id
   LIMIT 1;
  IF r.service_id IS NULL THEN RETURN NULL; END IF;
  RETURN r.cfg || jsonb_build_object('service_id', r.service_id, 'variant_id', r.variant_id);
END;
$$;
REVOKE ALL ON FUNCTION app_servicio.program_not_included_config(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_servicio.program_not_included_config(uuid, uuid) TO service_role;

-- La fila de un módulo que la persona NO tiene, para mostrarlo con candado: sin clases para abrir, con la lista de sus
-- títulos y, con `invite`, el texto, el botón y el link. NULL si el módulo no es un módulo raíz activo que su variante
-- deja afuera, o si la configuración (de `program_not_included_config`) es NULL.
CREATE OR REPLACE FUNCTION app_servicio_portal.module_teaser_row(p_contact uuid, m app_servicio.program_items, p_cfg jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  u jsonb;
  v_number integer;
  v_lessons jsonb;
  v_count integer;
  v_duration integer;
  t jsonb;
  v_href text;
  v_invite jsonb := NULL;
BEGIN
  IF p_cfg IS NULL OR m.id IS NULL OR m.kind <> 'module' OR m.parent_id IS NOT NULL OR m.status <> 'active' THEN RETURN NULL; END IF;
  IF COALESCE(p_cfg ->> 'mode', 'hidden') NOT IN ('locked', 'invite') THEN RETURN NULL; END IF;
  u := app_servicio.program_item_unlocked(p_contact, m.id);
  IF u IS NULL OR COALESCE((u ->> 'included')::boolean, true) THEN RETURN NULL; END IF;
  IF NOT m.is_extra THEN
    SELECT count(*) INTO v_number FROM app_servicio.program_items o
     WHERE o.product_id = m.product_id AND o.kind = 'module' AND o.parent_id IS NULL AND o.status <> 'archived' AND NOT o.is_extra
       AND (o.position, o.id) <= (m.position, m.id);
  END IF;
  SELECT COALESCE(jsonb_agg(l.title ORDER BY ml.ord), '[]'::jsonb), count(*), COALESCE(sum(l.duration_seconds), 0)
    INTO v_lessons, v_count, v_duration
    FROM app_servicio_portal.module_lessons(m.id) ml
    JOIN app_servicio.program_items l ON l.id = ml.item_id;
  IF p_cfg ->> 'mode' = 'invite' THEN
    t := p_cfg -> 'target';
    v_href := CASE t ->> 'kind'
      WHEN 'link' THEN t ->> 'url'
      WHEN 'form' THEN t ->> 'url'
      WHEN 'event' THEN t ->> 'url'
      WHEN 'whatsapp' THEN 'https://wa.me/' || (t ->> 'value')
        || CASE WHEN NULLIF(btrim(COALESCE(t ->> 'prefill', '')), '') IS NOT NULL THEN '?text=' || app_servicio.url_encode(t ->> 'prefill') ELSE '' END
    END;
    IF v_href IS NOT NULL THEN
      v_invite := jsonb_build_object('text', p_cfg ->> 'text', 'button', p_cfg ->> 'button', 'href', v_href);
    END IF;
  END IF;
  RETURN jsonb_build_object('id', m.id, 'title', m.title, 'description', m.description,
    'number', v_number, 'extra', m.is_extra, 'has_cover', m.cover_path IS NOT NULL, 'thumbnail_url', m.thumbnail_url,
    'unlocked', false, 'display', 'not_included', 'reason', COALESCE(NULLIF(btrim(COALESCE(p_cfg ->> 'label', '')), ''), 'No incluido en tu plan'),
    'opens_on', NULL, 'items', '[]'::jsonb, 'not_included', true,
    'teaser', jsonb_build_object('lessons', v_lessons, 'count', v_count, 'duration_seconds', v_duration),
    'invite', v_invite);
END;
$$;
REVOKE ALL ON FUNCTION app_servicio_portal.module_teaser_row(uuid, app_servicio.program_items, jsonb) FROM PUBLIC, anon, authenticated, portal_app;

-- ─── 3. El Programa del portal ─────────────────────────────────────────────
-- Igual que antes (00387) y, si la variante lo pide, los módulos que no incluye después de los suyos (los extras, en
-- Extras). Sin configuración, el orden sigue siendo el de siempre.
CREATE OR REPLACE FUNCTION app_servicio_portal.portal_program(p_session text, p_product_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  pf jsonb := app_servicio_portal.require_section(sess, p_product_id, 'program');
  v_contact uuid := (pf ->> 'contact_id')::uuid;
  v_cfg jsonb := app_servicio.program_not_included_config((pf ->> 'contact_id')::uuid, p_product_id);
BEGIN
  RETURN jsonb_build_object('modules', COALESCE((
    SELECT jsonb_agg(r ORDER BY CASE WHEN v_cfg IS NULL THEN false ELSE ext END, COALESCE((r ->> 'not_included')::boolean, false), pos) FROM (
      SELECT COALESCE(app_servicio_portal.module_row(v_contact, m),
                      CASE WHEN v_cfg IS NOT NULL THEN app_servicio_portal.module_teaser_row(v_contact, m, v_cfg) END) r,
             m.is_extra ext, m.position pos
        FROM app_servicio.program_items m
       WHERE m.product_id = p_product_id AND m.kind = 'module' AND m.parent_id IS NULL AND m.status = 'active') x WHERE r IS NOT NULL), '[]'::jsonb));
END;
$function$;

-- La portada de un módulo no incluido (la tarjeta la muestra); el resto, como en la 00399.
CREATE OR REPLACE FUNCTION app_servicio.portal_file_grant(p_session text, p_kind text, p_item_id uuid DEFAULT NULL::uuid, p_ref text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  i app_servicio.program_items;
  x jsonb;
  pf jsonb;
  t app_servicio_portal.community_posts;
  v_path text;
  v_ext text := lower(COALESCE(p_ref, ''));
BEGIN
  IF p_kind IN ('document', 'resource') THEN
    SELECT * INTO i FROM app_servicio.program_items WHERE id = p_item_id AND kind = 'lesson' AND status = 'active';
    IF i.id IS NULL THEN PERFORM app_servicio_portal.err('PO404', 'No existe'); END IF;
    PERFORM app_servicio_portal.require_section(sess, i.product_id, 'program');
    IF NOT COALESCE((app_servicio.program_item_unlocked((sess ->> 'contact_id')::uuid, i.id) ->> 'unlocked')::boolean, false) THEN
      PERFORM app_servicio_portal.err('PO403', 'Todavía no está abierta');
    END IF;
    IF p_kind = 'document' THEN v_path := i.document_path;
    ELSE SELECT r ->> 'path' INTO v_path FROM jsonb_array_elements(COALESCE(i.resources, '[]'::jsonb)) r WHERE r ->> 'id' = p_ref LIMIT 1;
    END IF;
    IF v_path IS NULL THEN PERFORM app_servicio_portal.err('PO404', 'No existe'); END IF;
    RETURN jsonb_build_object('bucket', 'program-resources', 'path', v_path, 'upload', false);
  ELSIF p_kind IN ('module_cover', 'thumbnail') THEN
    -- La portada de un módulo o la miniatura de una clase: alcanza con que la persona la vea (aunque esté cerrada).
    SELECT * INTO i FROM app_servicio.program_items WHERE id = p_item_id AND status = 'active'
       AND kind = CASE WHEN p_kind = 'module_cover' THEN 'module' ELSE 'lesson' END;
    IF i.id IS NULL THEN PERFORM app_servicio_portal.err('PO404', 'No existe'); END IF;
    pf := app_servicio_portal.require_section(sess, i.product_id, 'program');
    -- 00404: la portada de un módulo que la variante no incluye también, si la variante lo muestra con candado.
    IF NOT COALESCE((app_servicio.program_item_unlocked((pf ->> 'contact_id')::uuid, i.id) ->> 'visible')::boolean, false)
       AND NOT (p_kind = 'module_cover' AND app_servicio_portal.module_teaser_row((pf ->> 'contact_id')::uuid, i,
                  app_servicio.program_not_included_config((pf ->> 'contact_id')::uuid, i.product_id)) IS NOT NULL) THEN
      PERFORM app_servicio_portal.err('PO404', 'No existe');
    END IF;
    v_path := CASE WHEN p_kind = 'module_cover' THEN i.cover_path ELSE i.thumbnail_path END;
    IF v_path IS NULL THEN PERFORM app_servicio_portal.err('PO404', 'No hay imagen'); END IF;
    RETURN jsonb_build_object('bucket', 'program-resources', 'path', v_path, 'upload', false);
  ELSIF p_kind = 'avatar' THEN
    SELECT a.avatar_path INTO v_path FROM app_servicio_portal.portal_accounts a WHERE a.id = (sess ->> 'account_id')::uuid;
    IF v_path IS NULL THEN PERFORM app_servicio_portal.err('PO404', 'No hay foto'); END IF;
    RETURN jsonb_build_object('bucket', 'portal-avatars', 'path', v_path, 'upload', false);
  ELSIF p_kind = 'avatar_upload' THEN
    PERFORM app_servicio_portal.require_write(sess);
    IF v_ext NOT IN ('png', 'jpg', 'jpeg', 'webp') THEN PERFORM app_servicio_portal.err('PO400', 'La foto tiene que ser PNG, JPG o WEBP'); END IF;
    v_path := (sess ->> 'workspace_id') || '/' || (sess ->> 'account_id') || '/' || gen_random_uuid()::text || '.' || v_ext;
    RETURN jsonb_build_object('bucket', 'portal-avatars', 'path', v_path, 'upload', true);
  ELSIF p_kind = 'activity_upload' THEN
    PERFORM app_servicio_portal.require_write(sess);
    x := app_servicio_portal.form_item(sess, p_item_id, 'activity');
    IF v_ext !~ '^[a-z0-9]{1,8}$' THEN PERFORM app_servicio_portal.err('PO400', 'Ese archivo no se puede subir'); END IF;
    v_path := (x ->> 'workspace_id') || '/' || (x ->> 'form_id') || '/' || (x ->> 'contact_id') || '/' || gen_random_uuid()::text || '.' || v_ext;
    RETURN jsonb_build_object('bucket', 'form-uploads', 'path', v_path, 'upload', true);
  ELSIF p_kind = 'community_upload' THEN
    PERFORM app_servicio_portal.require_write(sess);
    pf := app_servicio_portal.require_section(sess, p_item_id, 'community');
    IF v_ext NOT IN ('png', 'jpg', 'jpeg', 'webp', 'gif') THEN PERFORM app_servicio_portal.err('PO400', 'La foto tiene que ser PNG, JPG, WEBP o GIF'); END IF;
    v_path := (pf ->> 'workspace_id') || '/' || p_item_id::text || '/' || (pf ->> 'contact_id') || '/' || gen_random_uuid()::text || '.' || v_ext;
    RETURN jsonb_build_object('bucket', 'community-media', 'path', v_path, 'upload', true);
  ELSIF p_kind = 'community_media' THEN
    t := app_servicio_portal.visible_post(sess, p_item_id);
    v_path := t.media -> (CASE WHEN p_ref ~ '^\d{1,2}$' THEN p_ref::integer ELSE -1 END) ->> 'path';
    IF v_path IS NULL THEN PERFORM app_servicio_portal.err('PO404', 'No existe'); END IF;
    RETURN jsonb_build_object('bucket', 'community-media', 'path', v_path, 'upload', false);
  END IF;
  PERFORM app_servicio_portal.err('PO400', 'Pedido no válido');
END;
$function$;

-- ─── 4. Vistas y toques ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_servicio_portal.upgrade_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  service_id uuid REFERENCES app_servicio.services(id) ON DELETE SET NULL,
  variant_id uuid REFERENCES public.product_variants(id) ON DELETE SET NULL,
  module_id uuid REFERENCES app_servicio.program_items(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('view', 'click')),
  target_kind text,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE app_servicio_portal.upgrade_events IS
  '00404: cada vez que un estudiante abre la tarjeta de un módulo que su variante no incluye (view, una por día y módulo) o toca el botón de la invitación (click).';
CREATE INDEX IF NOT EXISTS idx_upgrade_events_contact ON app_servicio_portal.upgrade_events (product_id, contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_upgrade_events_variant ON app_servicio_portal.upgrade_events (variant_id, kind, created_at);
ALTER TABLE app_servicio_portal.upgrade_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE app_servicio_portal.upgrade_events FROM PUBLIC, anon, authenticated, portal_app;
-- Solo la leen y escriben las funciones (SECURITY DEFINER) y el rol de servicio.
GRANT ALL ON TABLE app_servicio_portal.upgrade_events TO service_role;

-- El portal registra que la persona vio la tarjeta (`view`) o tocó el botón (`click`). La vista previa del equipo no
-- escribe (PO403). Un toque, una vez cada 7 días por persona y programa: etiqueta, aviso al equipo, el evento
-- `service_upgrade_interest` y una línea en el historial del servicio.
CREATE OR REPLACE FUNCTION app_servicio_portal.portal_upgrade_event(p_session text, p_product_id uuid, p_module_id uuid, p_kind text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  pf jsonb;
  v_contact uuid;
  v_ws uuid;
  v_cfg jsonb;
  m app_servicio.program_items;
  s app_servicio.services;
  v_recent boolean;
  v_notify text;
  v_name text;
  v_product text;
  v_title text;
  v_body text;
  v_meta jsonb;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('view', 'click') THEN PERFORM app_servicio_portal.err('PO400', 'Pedido no válido'); END IF;
  PERFORM app_servicio_portal.require_write(sess);
  pf := app_servicio_portal.require_section(sess, p_product_id, 'program');
  v_contact := (pf ->> 'contact_id')::uuid;
  SELECT * INTO m FROM app_servicio.program_items WHERE id = p_module_id AND product_id = p_product_id;
  v_cfg := app_servicio.program_not_included_config(v_contact, p_product_id);
  IF m.id IS NULL OR app_servicio_portal.module_teaser_row(v_contact, m, v_cfg) IS NULL THEN
    PERFORM app_servicio_portal.err('PO404', 'Este módulo no existe');
  END IF;
  IF p_kind = 'click' AND v_cfg ->> 'mode' IS DISTINCT FROM 'invite' THEN PERFORM app_servicio_portal.err('PO400', 'Pedido no válido'); END IF;
  SELECT * INTO s FROM app_servicio.services WHERE id = (v_cfg ->> 'service_id')::uuid;
  v_ws := s.workspace_id;

  IF p_kind = 'view' THEN
    IF NOT EXISTS (SELECT 1 FROM app_servicio_portal.upgrade_events e
                    WHERE e.product_id = p_product_id AND e.contact_id = v_contact AND e.module_id = m.id AND e.kind = 'view'
                      AND e.created_at > now() - interval '1 day') THEN
      INSERT INTO app_servicio_portal.upgrade_events (workspace_id, product_id, contact_id, service_id, variant_id, module_id, kind)
      VALUES (v_ws, p_product_id, v_contact, s.id, s.product_variant_id, m.id, 'view');
    END IF;
    RETURN jsonb_build_object('ok', true);
  END IF;

  v_recent := EXISTS (SELECT 1 FROM app_servicio_portal.upgrade_events e
                       WHERE e.product_id = p_product_id AND e.contact_id = v_contact AND e.kind = 'click' AND e.created_at > now() - interval '7 days');
  INSERT INTO app_servicio_portal.upgrade_events (workspace_id, product_id, contact_id, service_id, variant_id, module_id, kind, target_kind)
  VALUES (v_ws, p_product_id, v_contact, s.id, s.product_variant_id, m.id, 'click', v_cfg #>> '{target,kind}');
  IF v_recent THEN RETURN jsonb_build_object('ok', true); END IF;

  -- La etiqueta (el trigger de contact_tags dispara «Se agregó una etiqueta», como siempre).
  IF app_servicio.j_uuid(v_cfg #> '{on_click,tag_id}') THEN
    INSERT INTO public.contact_tags (contact_id, tag_id)
    SELECT v_contact, t.id FROM public.tags t WHERE t.id = (v_cfg #>> '{on_click,tag_id}')::uuid AND t.workspace_id = v_ws
    ON CONFLICT DO NOTHING;
  END IF;

  -- El aviso en la campana.
  SELECT display_name INTO v_name FROM public.contacts WHERE id = v_contact;
  SELECT name INTO v_product FROM public.products WHERE id = p_product_id;
  v_title := 'Quiere pasarse a ' || COALESCE(v_product, 'el programa completo');
  v_body := COALESCE(NULLIF(btrim(v_name), ''), 'Un estudiante') || ' tocó «' || COALESCE(v_cfg ->> 'button', 'el botón') || '» desde «' || m.title || '».';
  v_meta := jsonb_build_object('contact_id', v_contact, 'module_id', m.id, 'service_id', s.id, 'product_id', p_product_id);
  v_notify := v_cfg #>> '{on_click,notify}';
  IF v_notify = 'owner' AND s.owner_user_id IS NOT NULL THEN
    PERFORM app_servicio.notify(v_ws, s.owner_user_id, 'svc_upgrade_interest', v_title, v_body, 'service', s.id, v_meta);
  ELSIF v_notify IN ('owner', 'admins') THEN
    PERFORM app_servicio.notify_admins(v_ws, 'svc_upgrade_interest', v_title, v_body, 'service', s.id, v_meta);
  ELSIF app_servicio.j_uuid(v_cfg #> '{on_click,notify}')
        AND EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = v_ws AND wm.user_id = v_notify::uuid) THEN
    PERFORM app_servicio.notify(v_ws, v_notify::uuid, 'svc_upgrade_interest', v_title, v_body, 'service', s.id, v_meta);
  END IF;

  PERFORM app_servicio.emit(s, 'service_upgrade_interest', jsonb_build_object('module_id', m.id, 'module_title', m.title));
  PERFORM app_servicio.audit(v_ws, 'service', s.id, 'svc.upgrade_interest',
    jsonb_build_object('module_id', m.id, 'module_title', m.title, 'button', v_cfg ->> 'button'), 'client');
  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION app_servicio_portal.portal_upgrade_event(text, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_servicio_portal.portal_upgrade_event(text, uuid, uuid, text) TO portal_app, service_role;

-- ─── 5. Lo que ve el equipo ────────────────────────────────────────────────
-- Por variante: cuántas personas vieron una tarjeta, cuántas tocaron el botón y cuántas se pasaron (un servicio del
-- mismo programa en otra variante, creado hasta 30 días después de su primer toque), con la lista de las que tocaron.
CREATE OR REPLACE FUNCTION app_servicio.upgrade_interest_stats(p_variant_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_ws uuid;
  v_prod uuid;
BEGIN
  SELECT workspace_id, product_id INTO v_ws, v_prod FROM public.product_variants WHERE id = p_variant_id;
  IF v_ws IS NULL THEN RAISE EXCEPTION 'No existe la variante' USING ERRCODE = 'CO002'; END IF;
  IF NOT public.has_permission(v_ws, 'portal.access_rules') THEN PERFORM app_servicio.require_permission(v_ws, 'services.view'); END IF;
  RETURN (
    WITH ev AS (SELECT * FROM app_servicio_portal.upgrade_events WHERE variant_id = p_variant_id),
    clicks AS (SELECT contact_id, min(created_at) AS first_at, max(created_at) AS last_at, count(*)::int AS n FROM ev WHERE kind = 'click' GROUP BY contact_id),
    up AS (SELECT c.contact_id,
             (SELECT min(s.created_at) FROM app_servicio.services s
               WHERE s.contact_id = c.contact_id AND s.product_id = v_prod AND s.product_variant_id IS DISTINCT FROM p_variant_id
                 AND s.status <> 'cancelled' AND s.created_at >= c.first_at AND s.created_at <= c.first_at + interval '30 days') AS upgraded_at
             FROM clicks c)
    SELECT jsonb_build_object(
      'saw', (SELECT count(DISTINCT contact_id) FROM ev WHERE kind = 'view'),
      'clicked', (SELECT count(*) FROM clicks),
      'upgraded', (SELECT count(*) FROM up WHERE upgraded_at IS NOT NULL),
      'people', COALESCE((SELECT jsonb_agg(jsonb_build_object('contact_id', c.contact_id, 'name', ct.display_name, 'last_at', c.last_at,
                                  'clicks', c.n, 'upgraded_at', u.upgraded_at) ORDER BY c.last_at DESC)
                            FROM clicks c JOIN up u ON u.contact_id = c.contact_id LEFT JOIN public.contacts ct ON ct.id = c.contact_id), '[]'::jsonb)));
END;
$$;
REVOKE ALL ON FUNCTION app_servicio.upgrade_interest_stats(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_servicio.upgrade_interest_stats(uuid) TO authenticated, service_role;

-- ─── 6. «Tocó la invitación para pasarse» en Automatizaciones ──────────────
-- Antes de cambiar el CHECK: si la base acepta algún tipo que esta lista no tiene, frena (no se saca ninguno).
DO $$
DECLARE
  v_def text;
  v_live text[];
  v_new text[] := ARRAY['keyword', 'postback', 'quick_reply', 'welcome', 'default', 'comment_keyword', 'new_contact', 'crm_event', 'inactivity', 'email_received', 'booking_created', 'booking_rescheduled', 'booking_cancelled', 'booking_updated', 'booking_ended', 'booking_status_changed', 'booking_before_start', 'booking_after_end', 'booking_after_created', 'call_analyzed', 'call_linked', 'form_submitted', 'survey_answered', 'contract_signed', 'sale_created', 'sale_status_changed', 'payment_created', 'payment_status_changed', 'payment_before_due', 'payment_after_due', 'eod_submitted', 'webhook_received', 'task_completed', 'task_overdue', 'whatsapp_group_joined', 'whatsapp_group_reaction', 'whatsapp_group_poll_vote', 'scheduled_time', 'affiliate_assignment_expired', 'affiliate_lead_created', 'affiliate_sale_created', 'certificate_issued', 'challenge_completed', 'challenge_occurrence_due_soon', 'challenge_occurrence_overdue', 'challenge_started', 'live_session_missed', 'portal_access_expired', 'portal_access_expiring', 'program_lesson_completed', 'program_module_completed', 'quiz_failed', 'quiz_passed', 'service_created', 'service_ending_soon', 'service_extended', 'service_item_completed', 'service_item_overdue', 'service_light_changed', 'service_paused', 'service_phase_completed', 'service_phase_started', 'service_resumed', 'service_started', 'service_status_changed', 'task_submission_received', 'task_submission_reviewed', 'service_relative', 'service_phase_periodic', 'points_level_up', 'service_upgrade_interest'];
  x text;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO v_def FROM pg_constraint c
   WHERE c.conrelid = 'public.triggers'::regclass AND c.conname = 'triggers_type_check';
  IF v_def IS NULL THEN RETURN; END IF;
  SELECT array_agg(m[1]) INTO v_live FROM regexp_matches(v_def, '''([^'']+)''', 'g') AS t(m);
  FOREACH x IN ARRAY COALESCE(v_live, ARRAY[]::text[]) LOOP
    IF NOT (x = ANY (v_new)) THEN
      RAISE EXCEPTION 'triggers_type_check acepta % y la lista nueva no: revisar antes de aplicar', x;
    END IF;
  END LOOP;
END $$;

-- CHECK de triggers.type: los vigentes (los de la 00379, 70) + service_upgrade_interest.
ALTER TABLE public.triggers DROP CONSTRAINT IF EXISTS triggers_type_check;
ALTER TABLE public.triggers ADD CONSTRAINT triggers_type_check CHECK (type = ANY (ARRAY['keyword'::text, 'postback'::text, 'quick_reply'::text, 'welcome'::text, 'default'::text, 'comment_keyword'::text, 'new_contact'::text, 'crm_event'::text, 'inactivity'::text, 'email_received'::text, 'booking_created'::text, 'booking_rescheduled'::text, 'booking_cancelled'::text, 'booking_updated'::text, 'booking_ended'::text, 'booking_status_changed'::text, 'booking_before_start'::text, 'booking_after_end'::text, 'booking_after_created'::text, 'call_analyzed'::text, 'call_linked'::text, 'form_submitted'::text, 'survey_answered'::text, 'contract_signed'::text, 'sale_created'::text, 'sale_status_changed'::text, 'payment_created'::text, 'payment_status_changed'::text, 'payment_before_due'::text, 'payment_after_due'::text, 'eod_submitted'::text, 'webhook_received'::text, 'task_completed'::text, 'task_overdue'::text, 'whatsapp_group_joined'::text, 'whatsapp_group_reaction'::text, 'whatsapp_group_poll_vote'::text, 'scheduled_time'::text, 'affiliate_assignment_expired'::text, 'affiliate_lead_created'::text, 'affiliate_sale_created'::text, 'certificate_issued'::text, 'challenge_completed'::text, 'challenge_occurrence_due_soon'::text, 'challenge_occurrence_overdue'::text, 'challenge_started'::text, 'live_session_missed'::text, 'portal_access_expired'::text, 'portal_access_expiring'::text, 'program_lesson_completed'::text, 'program_module_completed'::text, 'quiz_failed'::text, 'quiz_passed'::text, 'service_created'::text, 'service_ending_soon'::text, 'service_extended'::text, 'service_item_completed'::text, 'service_item_overdue'::text, 'service_light_changed'::text, 'service_paused'::text, 'service_phase_completed'::text, 'service_phase_started'::text, 'service_resumed'::text, 'service_started'::text, 'service_status_changed'::text, 'task_submission_received'::text, 'task_submission_reviewed'::text, 'service_relative'::text, 'service_phase_periodic'::text, 'points_level_up'::text, 'service_upgrade_interest'::text]));
