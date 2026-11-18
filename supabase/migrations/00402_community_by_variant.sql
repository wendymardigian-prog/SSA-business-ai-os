-- @plantilla-quitar(servicios)
-- ============================================================================
-- 00402_community_by_variant  (Comunidades por variante y Academy Lite)
-- ============================================================================
-- Un programa puede tener varias comunidades con nombre y cada variante elige a cuál pertenece (por defecto, la
-- principal). Requerimientos: «Requerimientos · Comunidades por variante y Academy Lite» (17/11/2026), con las
-- decisiones de la sección 7.
--
--   Datos (sin tablas nuevas):
--     products.portal_settings.community.communities   [{key, name, main, archived, spaces}]. Sin esa lista, el programa
--                                                       tiene UNA comunidad, `principal`, con los espacios de siempre.
--     product_variants.portal_settings.community_key   la comunidad de la variante (vacío = la principal).
--     product_variants.service_settings.closes_variant_ids   R5: al crear un servicio de esta variante, cierra los
--                                                       activos de esas variantes («Renovado», «Pasó a <programa>»).
--     community_posts.community_key                    columna nueva; lo que ya existe queda en `principal`.
--     live_session_dates.extra_variant_ids             R7: una fecha concreta se abre también a otras variantes.
--     portal_accounts.community_choice                 la comunidad que eligió quien tiene más de una (R3.2).
--
--   Reglas:
--     · Un estudiante ve y publica solo en las comunidades de sus servicios activos (contact_communities); con más de
--       una, en la que eligió (portal_community_choose). La base decide la comunidad de lo que publica: el portal no la
--       manda, así que no se puede publicar en otra ni llamando a la función.
--     · Los comentarios de una clase también son por comunidad. Silenciar vale para todo el programa (como antes).
--     · El equipo lee una comunidad o todas (community_feed `community`), publica en una o en varias
--       (community_team_post `community_keys`) y ve los contadores de cada una (community_item_counts `by_community`).
--     · Puntos: son de la persona en el programa (un upgrade los conserva). El ranking, el puesto, los niveles y la Sala
--       de la fama se arman con las personas de SU comunidad (decisión 4).
--     · Una comunidad no se borra; se archiva solo si ninguna variante la usa.
--
-- Con una sola comunidad todo se ve y se cuenta exactamente igual que hoy: cada cambio filtra por `community_key` o pasa
-- por `community_count(...) <= 1`.
--
-- Las funciones que se redefinen parten de su definición EN LA BASE (pg_get_functiondef del 17/11/2026, después de la
-- 00401), con cada cambio marcado en su comentario. points_ranking cambia de firma (suma `p_community`): se borra y se
-- vuelve a crear con los mismos permisos.
--
-- Volver atrás:
--   ALTER TABLE app_servicio_portal.community_posts DROP COLUMN community_key;          (los posts de otras comunidades
--     pasarían a verse en la principal: archivar antes las comunidades extra)
--   ALTER TABLE app_servicio.live_session_dates DROP COLUMN extra_variant_ids;
--   ALTER TABLE app_servicio_portal.portal_accounts DROP COLUMN community_choice;
--   DROP de las funciones nuevas y volver a crear las redefinidas como estaban (00351, 00380, 00385-00393, 00401…).
--
-- Riesgo: medio. Toca la lectura de la comunidad, el calendario y los puntos del portal; se prueba con
-- `node scripts/verify-comunidades.mjs` (todo en una transacción que se deshace).
-- ============================================================================

-- ─── 1. Columnas nuevas (aditivas, con valor por defecto) ─────────────────────
-- La comunidad de cada post y comentario. Lo que ya existe queda en la principal (`principal`, la que nace sola).
ALTER TABLE app_servicio_portal.community_posts ADD COLUMN IF NOT EXISTS community_key text NOT NULL DEFAULT 'principal';
ALTER TABLE app_servicio_portal.community_posts DROP CONSTRAINT IF EXISTS community_posts_community_check;
ALTER TABLE app_servicio_portal.community_posts ADD CONSTRAINT community_posts_community_check CHECK (community_key ~ '^[a-z0-9_]{1,40}$');
CREATE INDEX IF NOT EXISTS idx_community_posts_community_feed ON app_servicio_portal.community_posts (product_id, community_key, space_key, created_at DESC)
  WHERE parent_id IS NULL AND deleted_at IS NULL;

-- R7: una fecha concreta de una sesión se abre también a otras variantes (además de las de la sesión).
ALTER TABLE app_servicio.live_session_dates ADD COLUMN IF NOT EXISTS extra_variant_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];

-- La comunidad que eligió cada estudiante en cada programa (solo cuenta si tiene más de una): {"<product_id>": "<clave>"}.
ALTER TABLE app_servicio_portal.portal_accounts ADD COLUMN IF NOT EXISTS community_choice jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE app_servicio_portal.portal_accounts DROP CONSTRAINT IF EXISTS portal_accounts_community_choice_check;
ALTER TABLE app_servicio_portal.portal_accounts ADD CONSTRAINT portal_accounts_community_choice_check CHECK (jsonb_typeof(community_choice) = 'object');

-- ─── 2. Las comunidades del programa ────────────────────────────────────────
-- Gemela de `programCommunities` (lib/program/community.ts, community-list.cases.json). Sin `community.communities`, el
-- programa tiene UNA comunidad, la principal (clave `principal`), con los espacios de siempre (`community.spaces` o los de
-- fábrica). Cada comunidad: {key, name, main, archived, spaces}; los espacios nunca traen el reservado «clases». Si
-- ninguna está marcada como principal, lo es la primera sin archivar.
CREATE OR REPLACE FUNCTION app_servicio.community_list_plan(p_settings jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  v_default jsonb := '[{"key":"anuncios","name":"Anuncios","team_only":true},{"key":"general","name":"General"},{"key":"victorias","name":"Victorias"}]'::jsonb;
  v_legacy jsonb := CASE WHEN jsonb_typeof(p_settings #> '{community,spaces}') = 'array' THEN p_settings #> '{community,spaces}' ELSE v_default END;
  v_list jsonb := p_settings #> '{community,communities}';
  v_out jsonb := '[]'::jsonb;
  v_main_at integer := NULL;
  c jsonb;
  i integer := 0;
  v_is_main boolean;
  v_spaces jsonb;
BEGIN
  IF jsonb_typeof(v_list) IS DISTINCT FROM 'array' OR NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_list) x WHERE jsonb_typeof(x) = 'object' AND jsonb_typeof(x -> 'key') = 'string') THEN
    v_list := jsonb_build_array(jsonb_build_object('key', 'principal', 'name', 'Principal', 'main', true));
  END IF;
  FOR c IN SELECT x FROM jsonb_array_elements(v_list) x WHERE jsonb_typeof(x) = 'object' AND jsonb_typeof(x -> 'key') = 'string' LOOP
    v_is_main := COALESCE(c -> 'main' = 'true'::jsonb, false) AND NOT COALESCE(c -> 'archived' = 'true'::jsonb, false) AND v_main_at IS NULL;
    IF v_is_main THEN v_main_at := i; END IF;
    v_spaces := CASE WHEN jsonb_typeof(c -> 'spaces') = 'array' THEN c -> 'spaces'
                     WHEN COALESCE(c -> 'main' = 'true'::jsonb, false) THEN v_legacy ELSE v_default END;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'key', c ->> 'key', 'name', COALESCE(NULLIF(btrim(c ->> 'name'), ''), c ->> 'key'), 'main', v_is_main,
      'archived', COALESCE(c -> 'archived' = 'true'::jsonb, false),
      'spaces', COALESCE((SELECT jsonb_agg(s) FROM jsonb_array_elements(v_spaces) s
                           WHERE jsonb_typeof(s) = 'object' AND (s ->> 'key') IS DISTINCT FROM 'clases'), '[]'::jsonb)));
    i := i + 1;
  END LOOP;
  IF v_main_at IS NULL THEN
    SELECT o - 1 INTO v_main_at FROM jsonb_array_elements(v_out) WITH ORDINALITY t(x, o) WHERE NOT (x ->> 'archived')::boolean ORDER BY o LIMIT 1;
    v_out := jsonb_set(v_out, ARRAY[COALESCE(v_main_at, 0)::text, 'main'], 'true'::jsonb);
  END IF;
  RETURN v_out;
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio.community_list(p_product_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT app_servicio.community_list_plan(COALESCE(p.portal_settings, '{}'::jsonb)) FROM public.products p WHERE p.id = p_product_id;
$$;

CREATE OR REPLACE FUNCTION app_servicio.community_main_key(p_product_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE((SELECT x ->> 'key' FROM jsonb_array_elements(app_servicio.community_list(p_product_id)) x WHERE (x ->> 'main')::boolean LIMIT 1), 'principal');
$$;

-- Cuántas comunidades tiene el programa (archivadas incluidas). Con una sola, todo se ve y se cuenta como siempre.
CREATE OR REPLACE FUNCTION app_servicio.community_count(p_product_id uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(jsonb_array_length(app_servicio.community_list(p_product_id)), 1);
$$;

-- Los espacios de una comunidad (vacío si no existe). `community_spaces(producto)` sigue siendo los de la principal.
CREATE OR REPLACE FUNCTION app_servicio.community_spaces_of(p_product_id uuid, p_community text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE((SELECT x -> 'spaces' FROM jsonb_array_elements(app_servicio.community_list(p_product_id)) x WHERE x ->> 'key' = p_community LIMIT 1), '[]'::jsonb);
$$;

-- La comunidad de una variante: la que eligió (si existe y no está archivada) o la principal.
CREATE OR REPLACE FUNCTION app_servicio.community_of_variant(p_variant_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(
    (SELECT x ->> 'key' FROM jsonb_array_elements(app_servicio.community_list(v.product_id)) x
      WHERE x ->> 'key' = v.portal_settings ->> 'community_key' AND NOT (x ->> 'archived')::boolean LIMIT 1),
    app_servicio.community_main_key(v.product_id))
    FROM public.product_variants v WHERE v.id = p_variant_id;
$$;

-- Las comunidades de una persona en un programa (R3): las de las variantes de sus servicios activos o en pausa, en el
-- orden del programa. Sin ninguno, la de su último servicio (no cancelado); sin servicios, la principal.
CREATE OR REPLACE FUNCTION app_servicio.contact_communities(p_contact_id uuid, p_product_id uuid)
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH lst AS (SELECT x ->> 'key' AS k, o FROM jsonb_array_elements(app_servicio.community_list(p_product_id)) WITH ORDINALITY t(x, o)),
  act AS (SELECT DISTINCT app_servicio.community_of_variant(s.product_variant_id) AS k FROM app_servicio.services s
           WHERE s.contact_id = p_contact_id AND s.product_id = p_product_id AND s.status IN ('active', 'paused'))
  SELECT COALESCE(
    (SELECT array_agg(a.k ORDER BY l.o) FROM act a JOIN lst l ON l.k = a.k),
    (SELECT ARRAY[app_servicio.community_of_variant(s.product_variant_id)] FROM app_servicio.services s
      WHERE s.contact_id = p_contact_id AND s.product_id = p_product_id AND s.status <> 'cancelled' ORDER BY s.created_at DESC LIMIT 1),
    ARRAY[app_servicio.community_main_key(p_product_id)]);
$$;

-- La comunidad en la que está ahora: la que eligió en el portal (si sigue siendo suya) o la primera de las suyas.
CREATE OR REPLACE FUNCTION app_servicio.contact_current_community(p_contact_id uuid, p_product_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN z.ch IS NOT NULL AND z.ch = ANY (z.lst) THEN z.ch ELSE z.lst[1] END
    FROM (SELECT app_servicio.contact_communities(p_contact_id, p_product_id) AS lst,
                 (SELECT a.community_choice ->> p_product_id::text FROM app_servicio_portal.portal_accounts a
                   WHERE a.contact_id = p_contact_id ORDER BY a.created_at DESC LIMIT 1) AS ch) z;
$$;

-- ¿La persona es de esa comunidad? Con una sola comunidad en el programa, siempre (como antes).
CREATE OR REPLACE FUNCTION app_servicio.community_member(p_contact_id uuid, p_product_id uuid, p_community text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT app_servicio.community_count(p_product_id) <= 1 OR p_community = ANY (app_servicio.contact_communities(p_contact_id, p_product_id));
$$;

-- `community_can_post_check` en una comunidad concreta. La comunidad tiene que existir y no estar archivada; un estudiante
-- tiene que ser de ella. El resto es la gemela de siempre (community_can_post_plan) con los espacios de esa comunidad.
CREATE OR REPLACE FUNCTION app_servicio.community_can_post_check_in(p_contact_id uuid, p_product_id uuid, p_community text, p_space text, p_program_item_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_settings jsonb;
  v_comm jsonb;
  v_item jsonb := NULL;
  it record;
  v_access boolean := false;
  v_muted boolean := false;
BEGIN
  SELECT portal_settings INTO v_settings FROM public.products WHERE id = p_product_id;
  SELECT x INTO v_comm FROM jsonb_array_elements(app_servicio.community_list(p_product_id)) x WHERE x ->> 'key' = p_community LIMIT 1;
  IF v_comm IS NULL OR (v_comm ->> 'archived')::boolean THEN RETURN jsonb_build_object('ok', false, 'reason', 'No existe esa comunidad'); END IF;
  IF p_contact_id IS NOT NULL AND NOT (p_community = ANY (app_servicio.contact_communities(p_contact_id, p_product_id))) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Esa comunidad no es la tuya');
  END IF;
  IF p_contact_id IS NOT NULL THEN
    SELECT bool_or(a.starts_at <= now() AND (a.ends_at IS NULL OR a.ends_at > now()) AND a.revoked_at IS NULL
                   AND a.suspended_overdue_at IS NULL AND a.suspended_pause_at IS NULL),
           bool_or(a.muted_at IS NOT NULL)
      INTO v_access, v_muted
      FROM app_servicio_portal.portal_access a
     WHERE a.contact_id = p_contact_id AND a.product_id = p_product_id AND a.section = 'community';
  END IF;
  IF p_program_item_id IS NOT NULL THEN
    SELECT id, status, comments_enabled INTO it FROM app_servicio.program_items WHERE id = p_program_item_id AND product_id = p_product_id AND kind = 'lesson';
    IF it.id IS NOT NULL THEN
      v_item := jsonb_build_object('active', it.status = 'active', 'commentsEnabled', it.comments_enabled,
        'unlocked', CASE WHEN p_contact_id IS NULL THEN true ELSE COALESCE((app_servicio.program_item_unlocked(p_contact_id, it.id) ->> 'unlocked')::boolean, false) END);
    END IF;
  END IF;
  RETURN app_servicio.community_can_post_plan(jsonb_build_object(
    'author', CASE WHEN p_contact_id IS NULL THEN 'team' ELSE 'student' END,
    'sectionOn', app_servicio.portal_section_enabled(p_product_id, 'community'),
    'hasAccess', COALESCE(v_access, false),
    'muted', COALESCE(v_muted, false),
    'space', (SELECT x FROM jsonb_array_elements(v_comm -> 'spaces') x WHERE x ->> 'key' = p_space LIMIT 1),
    'lessonComment', p_program_item_id IS NOT NULL,
    'lessonCommentsOn', COALESCE(v_settings #>> '{community,lesson_comments}', 'true') <> 'false',
    'item', v_item));
END;
$$;

-- R5: al activarse un servicio, cierra los servicios activos (o en pausa) de la misma persona cuyas variantes marca la
-- variante nueva en «Si tiene un servicio activo de… cerrarlo al crear este» (`service_settings.closes_variant_ids`).
-- Quedan «Renovado» con el motivo «Pasó a <programa>»; los accesos ya los dio el servicio nuevo (svc_activate), así que
-- se cortan los del viejo sin que haya un momento sin acceso. El avance (clases, entregas, puntos) es por persona y
-- programa: no se toca. Un servicio de prueba solo cierra servicios de prueba (y al revés).
CREATE OR REPLACE FUNCTION app_servicio.svc_close_on_upgrade(p_service_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s app_servicio.services;
  o app_servicio.services;
  v_ids uuid[];
  v_reason text;
  n integer := 0;
BEGIN
  SELECT * INTO s FROM app_servicio.services WHERE id = p_service_id;
  IF s.id IS NULL OR s.status <> 'active' THEN RETURN 0; END IF;
  SELECT array_agg(x::uuid) INTO v_ids
    FROM public.product_variants v,
         jsonb_array_elements_text(CASE WHEN jsonb_typeof(v.service_settings -> 'closes_variant_ids') = 'array' THEN v.service_settings -> 'closes_variant_ids' ELSE '[]'::jsonb END) x
   WHERE v.id = s.product_variant_id AND x ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  IF v_ids IS NULL THEN RETURN 0; END IF;
  v_reason := 'Pasó a ' || COALESCE(NULLIF(s.product_snapshot ->> 'product_name', ''), 'otro programa');
  FOR o IN SELECT * FROM app_servicio.services
            WHERE workspace_id = s.workspace_id AND contact_id = s.contact_id AND id <> s.id AND status IN ('active', 'paused')
              AND product_variant_id = ANY (v_ids) AND is_test = s.is_test
            ORDER BY created_at FOR UPDATE LOOP
    PERFORM app_servicio.svc_cut_access(o.id, 'renewed');
    UPDATE app_servicio.services
       SET status = 'renewed', completed_at = COALESCE(completed_at, now()), updated_at = now(),
           flags = flags || jsonb_build_object('closed_reason', v_reason, 'closed_by_service_id', s.id)
     WHERE id = o.id;
    PERFORM app_servicio.audit(o.workspace_id, 'service', o.id, 'svc.renewed', jsonb_build_object('reason', v_reason, 'by_service_id', s.id), 'system');
    PERFORM app_servicio.emit_service(o.id, 'service_status_changed', jsonb_build_object('previous_status', o.status));
    n := n + 1;
  END LOOP;
  IF n > 0 THEN
    PERFORM app_servicio.audit(s.workspace_id, 'service', s.id, 'svc.upgrade_closed', jsonb_build_object('closed', n), 'system');
  END IF;
  RETURN n;
END;
$$;

-- R7: ¿la variante ve esta fecha? Las de la sesión (o todas, si la sesión no elige) y las que se sumaron a esa fecha.
CREATE OR REPLACE FUNCTION app_servicio.live_date_visible(p_session_variant_ids uuid[], p_extra_variant_ids uuid[], p_variant_id uuid)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p_session_variant_ids IS NULL OR cardinality(p_session_variant_ids) = 0 OR p_variant_id = ANY (p_session_variant_ids)
         OR p_variant_id = ANY (COALESCE(p_extra_variant_ids, '{}'::uuid[]));
$$;

-- R3.2: el estudiante con más de una comunidad elige en cuál está (la guarda su cuenta). Solo una de las suyas.
CREATE OR REPLACE FUNCTION app_servicio_portal.portal_community_choose(p_session text, p_product_id uuid, p_community text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  pf jsonb;
BEGIN
  PERFORM app_servicio_portal.require_write(sess);
  pf := app_servicio_portal.program_for(sess, p_product_id, true);
  IF p_community IS NULL OR NOT (p_community = ANY (app_servicio.contact_communities((pf ->> 'contact_id')::uuid, p_product_id))) THEN
    PERFORM app_servicio_portal.err('PO400', 'Esa comunidad no es la tuya');
  END IF;
  UPDATE app_servicio_portal.portal_accounts SET community_choice = community_choice || jsonb_build_object(p_product_id::text, p_community)
   WHERE id = (sess ->> 'account_id')::uuid;
  RETURN jsonb_build_object('ok', true, 'community', p_community);
END;
$$;

-- ─── 3. Lo de siempre, por comunidad ─────────────────────────────────────────
-- Un comentario hereda la comunidad de su post (como el espacio y la clase).
CREATE OR REPLACE FUNCTION app_servicio.community_post_structure()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  par record;
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    SELECT id, parent_id, product_id, space_key, program_item_id, workspace_id, community_key INTO par FROM app_servicio_portal.community_posts WHERE id = NEW.parent_id;
    IF par.id IS NULL OR par.parent_id IS NOT NULL OR par.product_id <> NEW.product_id THEN
      RAISE EXCEPTION 'Un comentario va debajo de un post, no de otro comentario' USING ERRCODE = 'CO001';
    END IF;
    NEW.space_key := par.space_key;
    NEW.program_item_id := par.program_item_id;
    NEW.workspace_id := par.workspace_id;
    NEW.community_key := par.community_key;
  END IF;
  IF NEW.program_item_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM app_servicio.program_items i WHERE i.id = NEW.program_item_id AND i.product_id = NEW.product_id AND i.kind = 'lesson') THEN
    RAISE EXCEPTION 'La clase no es de este programa' USING ERRCODE = 'CO001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id = NEW.product_id AND p.workspace_id = NEW.workspace_id) THEN
    RAISE EXCEPTION 'El programa no es de este negocio' USING ERRCODE = 'CO001';
  END IF;
  RETURN NEW;
END;
$function$;

-- Los espacios «del programa» son los de la comunidad principal (quien llama sin comunidad ve lo de siempre).
CREATE OR REPLACE FUNCTION app_servicio.community_spaces(p_product_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT app_servicio.community_spaces_of(p.id, app_servicio.community_main_key(p.id)) FROM public.products p WHERE p.id = p_product_id;
$function$;

-- La firma de siempre: un estudiante, en la comunidad en la que está; el equipo, en la principal.
CREATE OR REPLACE FUNCTION app_servicio.community_can_post_check(p_contact_id uuid, p_product_id uuid, p_space text, p_program_item_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT app_servicio.community_can_post_check_in(p_contact_id, p_product_id,
    CASE WHEN p_contact_id IS NULL THEN app_servicio.community_main_key(p_product_id) ELSE app_servicio.contact_current_community(p_contact_id, p_product_id) END,
    p_space, p_program_item_id);
$function$;

-- R4: el equipo lee una comunidad (`p.community`) o todas (sin `community`, como antes). Cada post dice de cuál es.
CREATE OR REPLACE FUNCTION app_servicio.community_feed(p_product_id uuid, p jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_ws uuid;
  v_filter text := COALESCE(p ->> 'filter', 'all');
  v_limit integer := LEAST(100, GREATEST(1, COALESCE((p ->> 'limit')::integer, 30)));
BEGIN
  SELECT workspace_id INTO v_ws FROM public.products WHERE id = p_product_id;
  IF v_ws IS NULL THEN RETURN '[]'::jsonb; END IF;
  IF NOT app_servicio.is_system() THEN PERFORM app_servicio.require_permission(v_ws, 'community.view'); END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(row ORDER BY (row ->> 'pinned') DESC, (row ->> 'created_at') DESC)
      FROM (
        SELECT jsonb_build_object(
          'id', t.id, 'community_key', t.community_key, 'space_key', t.space_key, 'program_item_id', t.program_item_id, 'body', t.body, 'media', t.media,
          'author_contact_id', t.author_contact_id, 'author_name', c.display_name, 'author_user_id', t.author_user_id, 'as_business', t.as_business,
          'pinned', t.pinned_at IS NOT NULL, 'hidden', t.hidden_at IS NOT NULL, 'hidden_reason', t.hidden_reason, 'seen', t.team_seen_at IS NOT NULL,
          'deleted', t.deleted_at IS NOT NULL, 'created_at', t.created_at, 'edited_at', t.edited_at,
          'unanswered', app_servicio.community_is_unanswered(t.id),
          'reactions', COALESCE((SELECT jsonb_object_agg(k.kind, k.n) FROM (SELECT kind, count(*)::int n FROM app_servicio_portal.community_reactions WHERE post_id = t.id AND kind <> 'report' GROUP BY kind) k), '{}'::jsonb),
          'reports', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'reason', r.report_reason, 'created_at', r.created_at)) FROM app_servicio_portal.community_reactions r WHERE r.post_id = t.id AND r.kind = 'report' AND r.resolved_at IS NULL), '[]'::jsonb),
          'replies', COALESCE((SELECT jsonb_agg(jsonb_build_object(
              'id', x.id, 'body', x.body, 'author_contact_id', x.author_contact_id, 'author_name', xc.display_name, 'author_user_id', x.author_user_id,
              'as_business', x.as_business, 'hidden', x.hidden_at IS NOT NULL, 'created_at', x.created_at) ORDER BY x.created_at)
            FROM app_servicio_portal.community_posts x LEFT JOIN public.contacts xc ON xc.id = x.author_contact_id
           WHERE x.parent_id = t.id AND x.deleted_at IS NULL), '[]'::jsonb)) AS row
          FROM app_servicio_portal.community_posts t
          LEFT JOIN public.contacts c ON c.id = t.author_contact_id
         WHERE t.product_id = p_product_id AND t.parent_id IS NULL AND t.deleted_at IS NULL
           AND (NULLIF(p ->> 'community', '') IS NULL OR t.community_key = p ->> 'community')
           AND (NULLIF(p ->> 'space', '') IS NULL OR t.space_key = p ->> 'space')
           AND (NULLIF(p ->> 'program_item_id', '') IS NULL OR t.program_item_id = (p ->> 'program_item_id')::uuid)
           AND (NULLIF(p ->> 'before', '') IS NULL OR t.created_at < (p ->> 'before')::timestamptz)
           AND (v_filter <> 'unanswered' OR (t.created_at >= now() - interval '30 days' AND app_servicio.community_is_unanswered(t.id)))
           AND (v_filter <> 'reported' OR EXISTS (SELECT 1 FROM app_servicio_portal.community_reactions r WHERE r.post_id = t.id AND r.kind = 'report' AND r.resolved_at IS NULL))
         ORDER BY t.pinned_at DESC NULLS LAST, t.created_at DESC
         LIMIT v_limit) q), '[]'::jsonb);
END;
$function$;

-- Los contadores de siempre (todas las comunidades) y, aparte, los de cada comunidad (`by_community`).
CREATE OR REPLACE FUNCTION app_servicio.community_item_counts(p_product_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_ws uuid;
BEGIN
  SELECT workspace_id INTO v_ws FROM public.products WHERE id = p_product_id;
  IF v_ws IS NULL THEN RETURN '{}'::jsonb; END IF;
  IF NOT app_servicio.is_system() AND NOT (public.is_workspace_member(v_ws) AND (public.has_permission(v_ws, 'community.view') OR public.has_permission(v_ws, 'program.manage'))) THEN
    RETURN '{}'::jsonb;
  END IF;
  RETURN jsonb_build_object(
    'unanswered', app_servicio.community_unanswered(p_product_id, 30),
    'reported', (SELECT count(DISTINCT r.post_id)::int FROM app_servicio_portal.community_reactions r JOIN app_servicio_portal.community_posts t ON t.id = r.post_id
                  WHERE t.product_id = p_product_id AND r.kind = 'report' AND r.resolved_at IS NULL AND t.deleted_at IS NULL),
    'by_item', COALESCE((SELECT jsonb_object_agg(item, n) FROM (
        SELECT t.program_item_id AS item, count(*)::int n FROM app_servicio_portal.community_posts t
         WHERE t.product_id = p_product_id AND t.program_item_id IS NOT NULL AND t.created_at >= now() - interval '30 days'
           AND app_servicio.community_is_unanswered(t.id) GROUP BY 1) z), '{}'::jsonb),
    'by_community', COALESCE((SELECT jsonb_object_agg(k, jsonb_build_object('unanswered', u, 'reported', r)) FROM (
        SELECT t.community_key AS k,
               count(*) FILTER (WHERE t.parent_id IS NULL AND t.created_at >= now() - interval '30 days' AND app_servicio.community_is_unanswered(t.id))::int AS u,
               count(*) FILTER (WHERE t.deleted_at IS NULL AND EXISTS (SELECT 1 FROM app_servicio_portal.community_reactions rr
                                                                      WHERE rr.post_id = t.id AND rr.kind = 'report' AND rr.resolved_at IS NULL))::int AS r
          FROM app_servicio_portal.community_posts t WHERE t.product_id = p_product_id GROUP BY 1) z), '{}'::jsonb));
END;
$function$;

-- R4.2: el equipo publica en una comunidad o en varias a la vez (`p.community_keys`; sin nada, en la principal): un post
-- por comunidad, con el mismo texto y las mismas fotos. Devuelve el primero. Una respuesta va en la comunidad de su post.
CREATE OR REPLACE FUNCTION app_servicio.community_team_post(p_product_id uuid, p jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_ws uuid;
  v_parent_id uuid := NULL;
  v_space text := p ->> 'space_key';
  v_item uuid := NULLIF(p ->> 'program_item_id', '')::uuid;
  v_check jsonb;
  v_media jsonb;
  v_id uuid;
  v_first uuid := NULL;
  v_keys text[];
  v_key text;
BEGIN
  SELECT workspace_id INTO v_ws FROM public.products WHERE id = p_product_id;
  IF v_ws IS NULL THEN RAISE EXCEPTION 'No existe el programa' USING ERRCODE = 'CO002'; END IF;
  PERFORM app_servicio.require_permission(v_ws, 'community.reply');
  IF NULLIF(btrim(p ->> 'body'), '') IS NULL THEN RAISE EXCEPTION 'Escribí el mensaje' USING ERRCODE = 'CO002'; END IF;
  v_media := app_servicio.community_team_media(v_ws, p_product_id, p -> 'media');
  IF NULLIF(p ->> 'parent_id', '') IS NOT NULL THEN
    SELECT id, space_key, program_item_id, ARRAY[community_key] INTO v_parent_id, v_space, v_item, v_keys FROM app_servicio_portal.community_posts
     WHERE id = (p ->> 'parent_id')::uuid AND product_id = p_product_id AND deleted_at IS NULL;
    IF v_parent_id IS NULL THEN RAISE EXCEPTION 'No existe ese post' USING ERRCODE = 'CO002'; END IF;
  ELSE
    IF v_item IS NOT NULL THEN v_space := 'clases'; END IF;
    v_keys := COALESCE(
      (SELECT array_agg(DISTINCT x) FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(p -> 'community_keys') = 'array' THEN p -> 'community_keys' END) x),
      CASE WHEN NULLIF(p ->> 'community_key', '') IS NOT NULL THEN ARRAY[p ->> 'community_key'] END,
      ARRAY[app_servicio.community_main_key(p_product_id)]);
    FOREACH v_key IN ARRAY v_keys LOOP
      v_check := app_servicio.community_can_post_check_in(NULL, p_product_id, v_key, v_space, v_item);
      IF NOT COALESCE((v_check ->> 'ok')::boolean, false) THEN
        RAISE EXCEPTION '%', CASE WHEN cardinality(v_keys) > 1 THEN COALESCE((SELECT x ->> 'name' FROM jsonb_array_elements(app_servicio.community_list(p_product_id)) x WHERE x ->> 'key' = v_key), v_key) || ': ' ELSE '' END
                             || (v_check ->> 'reason') USING ERRCODE = 'CO002';
      END IF;
    END LOOP;
  END IF;
  FOREACH v_key IN ARRAY v_keys LOOP
    INSERT INTO app_servicio_portal.community_posts (workspace_id, product_id, community_key, space_key, parent_id, program_item_id, author_user_id, as_business, body, media)
    VALUES (v_ws, p_product_id, v_key, v_space, v_parent_id, v_item, auth.uid(), COALESCE((p ->> 'as_business')::boolean, false), btrim(p ->> 'body'), v_media)
    RETURNING id INTO v_id;
    v_first := COALESCE(v_first, v_id);
    PERFORM app_servicio.audit(v_ws, 'product', p_product_id, CASE WHEN v_parent_id IS NULL THEN 'community.posted' ELSE 'community.replied' END,
      jsonb_build_object('post_id', v_id, 'parent_id', v_parent_id, 'space_key', v_space, 'community_key', v_key, 'media', jsonb_array_length(v_media)));
  END LOOP;
  RETURN v_first;
END;
$function$;

-- ─── 4. El portal: cada estudiante ve y publica en su comunidad ─────────────
CREATE OR REPLACE FUNCTION app_servicio_portal.portal_spaces(p_session text, p_product_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  pf jsonb;
BEGIN
  pf := app_servicio_portal.require_section(sess, p_product_id, 'community');
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('key', s ->> 'key', 'name', s ->> 'name', 'team_only', COALESCE((s ->> 'team_only')::boolean, false)))
                     FROM jsonb_array_elements(COALESCE(app_servicio.community_spaces_of(p_product_id,
                            app_servicio.contact_current_community((pf ->> 'contact_id')::uuid, p_product_id)), '[]'::jsonb)) s
                    WHERE NOT COALESCE((s ->> 'archived')::boolean, false)), '[]'::jsonb);
END;
$function$;
CREATE OR REPLACE FUNCTION app_servicio_portal.portal_feed(p_session text, p_product_id uuid, p_space text DEFAULT NULL::text, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  pf jsonb := app_servicio_portal.require_section(sess, p_product_id, 'community');
  v_me uuid := (pf ->> 'contact_id')::uuid;
  v_rows jsonb;
  v_comm text := app_servicio.contact_current_community(v_me, p_product_id);
BEGIN
  SELECT COALESCE(jsonb_agg(app_servicio_portal.post_row(v_me, t) ORDER BY t.pinned_at DESC NULLS LAST, t.created_at DESC), '[]'::jsonb) INTO v_rows FROM (
    SELECT * FROM app_servicio_portal.community_posts t
     WHERE t.product_id = p_product_id AND t.community_key = v_comm AND t.parent_id IS NULL AND t.deleted_at IS NULL AND t.space_key <> 'clases'
       AND (t.hidden_at IS NULL OR t.author_contact_id = v_me)
       AND (NULLIF(p_space, '') IS NULL OR t.space_key = p_space)
       AND (p_before IS NULL OR t.created_at < p_before)
     ORDER BY t.pinned_at DESC NULLS LAST, t.created_at DESC LIMIT 20) t;
  RETURN jsonb_build_object('posts', v_rows,
    'next', CASE WHEN jsonb_array_length(v_rows) = 20 THEN v_rows -> 19 ->> 'created_at' END,
    'can_post', app_servicio.community_can_post_check_in(v_me, p_product_id, v_comm, COALESCE(NULLIF(p_space, ''), 'general'), NULL));
END;
$function$;
CREATE OR REPLACE FUNCTION app_servicio_portal.portal_lesson_comments(p_session text, p_item_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  i app_servicio.program_items;
  pf jsonb;
  v_me uuid;
  v_comm text;
BEGIN
  SELECT * INTO i FROM app_servicio.program_items WHERE id = p_item_id AND kind = 'lesson';
  IF i.id IS NULL THEN PERFORM app_servicio_portal.err('PO404', 'Esta clase no existe'); END IF;
  pf := app_servicio_portal.require_section(sess, i.product_id, 'program');
  v_me := (pf ->> 'contact_id')::uuid;
  v_comm := app_servicio.contact_current_community(v_me, i.product_id);
  RETURN jsonb_build_object(
    'can_post', app_servicio.community_can_post_check_in(v_me, i.product_id, v_comm, 'clases', i.id),
    'posts', COALESCE((SELECT jsonb_agg(app_servicio_portal.post_row(v_me, t) ORDER BY t.created_at DESC)
                         FROM app_servicio_portal.community_posts t
                        WHERE t.program_item_id = i.id AND t.community_key = v_comm AND t.parent_id IS NULL AND t.deleted_at IS NULL AND (t.hidden_at IS NULL OR t.author_contact_id = v_me)), '[]'::jsonb));
END;
$function$;

-- R3.1 y criterio 3: la comunidad la decide la base (la del post que responde, o en la que está), nunca el pedido.
CREATE OR REPLACE FUNCTION app_servicio_portal.portal_post_create(p_session text, p_product_id uuid, p_space text, p_body text, p_parent_id uuid DEFAULT NULL::uuid, p_program_item_id uuid DEFAULT NULL::uuid, p_media jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  pf jsonb;
  par app_servicio_portal.community_posts;
  v_space text := COALESCE(NULLIF(p_space, ''), 'general');
  v_item uuid := p_program_item_id;
  v_check jsonb;
  v_comm text;
  v_id uuid;
BEGIN
  PERFORM app_servicio_portal.require_write(sess);
  IF p_parent_id IS NOT NULL THEN
    SELECT * INTO par FROM app_servicio_portal.community_posts WHERE id = p_parent_id AND product_id = p_product_id AND deleted_at IS NULL AND hidden_at IS NULL;
    IF par.id IS NULL THEN PERFORM app_servicio_portal.err('PO404', 'Esa publicación ya no está'); END IF;
    IF par.parent_id IS NOT NULL THEN PERFORM app_servicio_portal.err('PO400', 'Se responde a la publicación, no a una respuesta'); END IF;
    v_space := par.space_key; v_item := par.program_item_id;
  END IF;
  pf := app_servicio_portal.require_section(sess, p_product_id, CASE WHEN v_space = 'clases' THEN 'program' ELSE 'community' END);
  IF par.id IS NOT NULL THEN
    IF NOT (par.community_key = ANY (app_servicio.contact_communities((pf ->> 'contact_id')::uuid, p_product_id))) THEN
      PERFORM app_servicio_portal.err('PO404', 'Esa publicación ya no está');
    END IF;
    v_comm := par.community_key;
  ELSE
    v_comm := app_servicio.contact_current_community((pf ->> 'contact_id')::uuid, p_product_id);
  END IF;
  IF btrim(COALESCE(p_body, '')) = '' OR char_length(p_body) > 10000 THEN PERFORM app_servicio_portal.err('PO400', 'Escribí algo (hasta 10.000 caracteres)'); END IF;
  IF p_media IS NOT NULL AND (jsonb_typeof(p_media) <> 'array' OR jsonb_array_length(p_media) > 10
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_media) m WHERE jsonb_typeof(m) <> 'object' OR NOT ((m ->> 'path') LIKE (pf ->> 'workspace_id') || '/' || p_product_id::text || '/' || (pf ->> 'contact_id') || '/%'))) THEN
    PERFORM app_servicio_portal.err('PO400', 'Las fotos no son válidas');
  END IF;
  v_check := app_servicio.community_can_post_check_in((pf ->> 'contact_id')::uuid, p_product_id, v_comm, v_space, v_item);
  IF NOT COALESCE((v_check ->> 'ok')::boolean, false) THEN PERFORM app_servicio_portal.err('PO403', COALESCE(v_check ->> 'reason', 'No podés publicar acá')); END IF;
  INSERT INTO app_servicio_portal.community_posts (workspace_id, product_id, community_key, space_key, parent_id, program_item_id, author_contact_id, body, media)
  VALUES ((pf ->> 'workspace_id')::uuid, p_product_id, v_comm, v_space, p_parent_id, v_item, (pf ->> 'contact_id')::uuid, btrim(p_body), COALESCE(p_media, '[]'::jsonb))
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$function$;

-- Reaccionar, reportar y ver las fotos: solo en publicaciones de una comunidad de la persona.
CREATE OR REPLACE FUNCTION app_servicio_portal.visible_post(p_sess jsonb, p_post_id uuid)
 RETURNS app_servicio_portal.community_posts
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  t app_servicio_portal.community_posts;
BEGIN
  SELECT * INTO t FROM app_servicio_portal.community_posts WHERE id = p_post_id AND deleted_at IS NULL AND hidden_at IS NULL;
  IF t.id IS NULL THEN PERFORM app_servicio_portal.err('PO404', 'Esa publicación ya no está'); END IF;
  PERFORM app_servicio_portal.require_section(p_sess, t.product_id, CASE WHEN t.space_key = 'clases' THEN 'program' ELSE 'community' END);
  IF NOT (t.community_key = ANY (app_servicio.contact_communities((p_sess ->> 'contact_id')::uuid, t.product_id))) THEN
    PERFORM app_servicio_portal.err('PO404', 'Esa publicación ya no está');
  END IF;
  RETURN t;
END;
$function$;

-- La cabecera de la comunidad: miembros, en línea y niveles de SU comunidad, más sus comunidades (para el selector).
CREATE OR REPLACE FUNCTION app_servicio_portal.portal_community_info(p_session text, p_product_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  pf jsonb := app_servicio_portal.require_section(sess, p_product_id, 'community');
  v_ws uuid := (pf ->> 'workspace_id')::uuid;
  v_settings jsonb;
  v_out jsonb;
  v_me uuid := (pf ->> 'contact_id')::uuid;
  v_comm text := app_servicio.contact_current_community(v_me, p_product_id);
  v_multi boolean := app_servicio.community_count(p_product_id) > 1;
BEGIN
  SELECT portal_settings -> 'points' INTO v_settings FROM public.products WHERE id = p_product_id;
  WITH m AS (
    SELECT DISTINCT a.contact_id FROM app_servicio_portal.portal_access a
     WHERE a.product_id = p_product_id AND a.section = 'community' AND a.revoked_at IS NULL
       AND app_servicio.portal_access_effective(a.contact_id, p_product_id, 'community') IS NOT NULL
       AND (NOT v_multi OR app_servicio.community_member(a.contact_id, p_product_id, v_comm))
  ), seen AS (
    SELECT acc.contact_id, max(s.last_seen_at) AS last_seen
      FROM app_servicio_portal.portal_sessions s
      JOIN app_servicio_portal.portal_accounts acc ON acc.id = s.account_id
     WHERE s.kind = 'student' AND s.revoked_at IS NULL AND s.expires_at > now() AND s.last_seen_at IS NOT NULL
       AND acc.workspace_id = v_ws AND acc.status <> 'suspended' AND acc.contact_id IN (SELECT contact_id FROM m)
     GROUP BY acc.contact_id
  )
  SELECT jsonb_build_object(
    'members', (SELECT count(*) FROM m),
    'online', (SELECT count(*) FROM seen WHERE seen.last_seen > now() - interval '5 minutes'),
    'faces', COALESCE((SELECT jsonb_agg(f.n ORDER BY f.last_seen DESC) FROM (
                SELECT app_servicio_portal.public_name(COALESCE(acc.display_name, c.display_name)) AS n, seen.last_seen
                  FROM seen JOIN public.contacts c ON c.id = seen.contact_id
                  LEFT JOIN app_servicio_portal.portal_accounts acc ON acc.contact_id = c.id AND acc.workspace_id = v_ws
                 ORDER BY seen.last_seen DESC LIMIT 5) f), '[]'::jsonb),
    'levels', CASE WHEN v_settings -> 'enabled' = 'true'::jsonb THEN COALESCE((
                SELECT jsonb_object_agg(md5(t.contact_id::text), (app_servicio.level_of(t.total, v_settings -> 'levels') ->> 'level')::integer)
                  FROM (SELECT l.contact_id, sum(l.points)::integer AS total FROM app_servicio_portal.points_ledger l
                         WHERE l.product_id = p_product_id GROUP BY l.contact_id) t
                  LEFT JOIN app_servicio_portal.portal_accounts acc ON acc.contact_id = t.contact_id AND acc.workspace_id = v_ws
                 WHERE COALESCE((acc.notification_prefs ->> 'hide_from_ranking')::boolean, false) IS NOT TRUE
                   AND (NOT v_multi OR app_servicio.community_member(t.contact_id, p_product_id, v_comm))), '{}'::jsonb)
              ELSE '{}'::jsonb END,
    'community', v_comm,
    'communities', COALESCE((SELECT jsonb_agg(jsonb_build_object('key', x ->> 'key', 'name', x ->> 'name') ORDER BY o)
                               FROM jsonb_array_elements(app_servicio.community_list(p_product_id)) WITH ORDINALITY t(x, o)
                              WHERE x ->> 'key' = ANY (app_servicio.contact_communities(v_me, p_product_id))), '[]'::jsonb))
  INTO v_out;
  RETURN v_out;
END;
$function$;

-- El número de comentarios de cada clase: los de la comunidad de la persona.
CREATE OR REPLACE FUNCTION app_servicio_portal.lesson_row(p_contact uuid, i app_servicio.program_items)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  u jsonb := app_servicio.program_item_unlocked(p_contact, i.id);
  pp app_servicio_portal.program_progress;
BEGIN
  IF NOT COALESCE((u ->> 'visible')::boolean, false) THEN RETURN NULL; END IF;
  SELECT * INTO pp FROM app_servicio_portal.program_progress WHERE contact_id = p_contact AND program_item_id = i.id ORDER BY updated_at DESC LIMIT 1;
  RETURN jsonb_build_object('id', i.id, 'kind', i.kind, 'title', i.title, 'description', left(i.description, 280), 'lesson_type', i.lesson_type,
    'duration_seconds', i.duration_seconds, 'thumbnail_url', i.thumbnail_url, 'thumbnail_path', i.thumbnail_path, 'required', i.required,
    'unlocked', COALESCE((u ->> 'unlocked')::boolean, false), 'display', u ->> 'display', 'reason', u ->> 'reason', 'opens_on', u ->> 'opensOn',
    'viewed', pp.viewed_at IS NOT NULL, 'completed', pp.completed_at IS NOT NULL,
    'new', COALESCE(pp.unlocked_at, i.created_at) > now() - interval '7 days' AND pp.viewed_at IS NULL,
    'comments', (SELECT count(*) FROM app_servicio_portal.community_posts p WHERE p.program_item_id = i.id AND p.deleted_at IS NULL AND p.hidden_at IS NULL
                  AND (app_servicio.community_count(i.product_id) <= 1 OR p.community_key = app_servicio.contact_current_community(p_contact, i.product_id))));
END;
$function$;

-- El número de la Comunidad en el menú: lo nuevo de su comunidad.
CREATE OR REPLACE FUNCTION app_servicio_portal.ctx_context_base(p_session text, p_host text, p_product_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  v_ws uuid := (sess ->> 'workspace_id')::uuid;
  v_contact uuid := (sess ->> 'contact_id')::uuid;
  w public.workspaces;
  a app_servicio_portal.portal_accounts;
  c public.contacts;
  pr record;
  v_programs jsonb := '[]'::jsonb;
  v_program jsonb;
  v_sections jsonb := '[]'::jsonb;
  v_excluded jsonb := '[]'::jsonb;
  v_status text := 'ended';
  v_pause jsonb;
  v_moment text;
  v_points jsonb;
  v_total integer;
  v_notif integer := 0;
  v_st jsonb;
  k record;
  v_any_open boolean := false;
BEGIN
  IF app_servicio_portal.ws_by_host(p_host) IS DISTINCT FROM v_ws THEN PERFORM app_servicio_portal.err('PO401', 'Tu sesión venció. Volvé a entrar'); END IF;
  SELECT * INTO w FROM public.workspaces WHERE id = v_ws;
  SELECT * INTO c FROM public.contacts WHERE id = v_contact;
  SELECT * INTO a FROM app_servicio_portal.portal_accounts WHERE workspace_id = v_ws AND contact_id = v_contact;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', x.product_id, 'name', x.name, 'short', x.name, 'detail', COALESCE(x.product_type, ''),
           'kind', CASE WHEN x.product_type = 'event' THEN 'event' ELSE 'program' END, 'nick', 'el programa «' || x.name || '»')
           ORDER BY (x.status IN ('active', 'paused')) DESC, x.name), '[]'::jsonb)
    INTO v_programs FROM app_servicio_portal.ctx_programs(v_ws, v_contact) x;

  SELECT * INTO pr FROM app_servicio_portal.ctx_programs(v_ws, v_contact) x
   ORDER BY (x.product_id = p_product_id) DESC, (x.status IN ('active', 'paused')) DESC, x.name LIMIT 1;

  IF pr.product_id IS NOT NULL THEN
    v_program := (SELECT e FROM jsonb_array_elements(v_programs) e WHERE e ->> 'id' = pr.product_id::text);
    -- Las secciones del menú, en el orden del portal.
    FOR k IN SELECT * FROM (VALUES (1, 'inicio', NULL), (2, 'camino', NULL), (3, 'programa', 'program'), (4, 'calendario', 'calendar'),
                                   (5, 'reto', 'challenge'), (6, 'comunidad', 'community'), (7, 'referidos', 'affiliates'),
                                   (8, 'asistente', 'assistant'), (9, 'perfil', NULL)) t(pos, key, section) ORDER BY pos LOOP
      IF k.section IS NULL THEN
        v_sections := v_sections || jsonb_build_object('key', k.key, 'display', 'open');
        CONTINUE;
      END IF;
      v_st := app_servicio_portal.ctx_section(v_contact, pr.product_id, pr.variant_id, k.section, pr.starts_on);
      IF v_st IS NULL THEN
        IF app_servicio.portal_section_rule(pr.variant_id, k.section) IS NULL OR NOT app_servicio.portal_section_enabled(pr.product_id, k.section) THEN
          v_excluded := v_excluded || to_jsonb(k.key);
        END IF;
        CONTINUE;
      END IF;
      IF v_st ->> 'display' = 'open' THEN v_any_open := true; END IF;
      IF k.key = 'comunidad' AND v_st ->> 'display' = 'open' THEN
        v_st := v_st || jsonb_build_object('count', (SELECT count(*) FROM app_servicio_portal.community_posts p
          WHERE p.product_id = pr.product_id AND p.parent_id IS NULL AND p.deleted_at IS NULL AND p.hidden_at IS NULL
            AND p.author_contact_id IS DISTINCT FROM v_contact
            AND (app_servicio.community_count(pr.product_id) <= 1 OR p.community_key = app_servicio.contact_current_community(v_contact, pr.product_id))
            AND p.created_at > GREATEST(COALESCE(a.notifications_seen_at, '-infinity'::timestamptz), now() - interval '7 days')));
      END IF;
      v_sections := v_sections || (jsonb_build_object('key', k.key) || v_st);
    END LOOP;

    -- El estado del programa (F212).
    IF pr.status = 'paused' AND pr.pause_cut_access THEN
      v_status := 'paused';
      v_pause := jsonb_build_object('since', to_char(app_servicio.local_date(pr.paused_at, v_ws), 'YYYY-MM-DD'), 'until', to_char(pr.pause_resume_on, 'YYYY-MM-DD'));
    ELSIF pr.status IN ('active', 'paused', 'pending_confirmation') OR v_any_open THEN
      v_status := 'active';
    END IF;

    -- El momento (para el Inicio): terminado, en pausa, certificado, en el reto, en el onboarding o a mitad de camino.
    v_moment := CASE
      WHEN v_status = 'ended' THEN 'exp'
      WHEN v_status = 'paused' THEN 'pausa'
      WHEN EXISTS (SELECT 1 FROM app_servicio.service_items i WHERE i.service_id = pr.service_id AND i.kind = 'certificate' AND i.status = 'completed') THEN 'cert'
      WHEN EXISTS (SELECT 1 FROM app_servicio.service_phases ph WHERE ph.service_id = pr.service_id AND ph.status = 'in_progress' AND ph.challenge -> 'enabled' = 'true'::jsonb) THEN 'reto'
      WHEN COALESCE((SELECT ph.position FROM app_servicio.service_phases ph WHERE ph.service_id = pr.service_id AND ph.status = 'in_progress' ORDER BY ph.position LIMIT 1), 0)
           = (SELECT min(ph.position) FROM app_servicio.service_phases ph WHERE ph.service_id = pr.service_id) THEN 'onb'
      ELSE 'mid' END;

    SELECT portal_settings -> 'points' INTO v_points FROM public.products WHERE id = pr.product_id;
    SELECT COALESCE(sum(points), 0)::integer INTO v_total FROM app_servicio_portal.points_ledger WHERE contact_id = v_contact AND product_id = pr.product_id;
    IF a.id IS NOT NULL THEN
      v_notif := COALESCE((app_servicio.portal_notifications_view(a.id, pr.product_id) ->> 'unseen')::integer, 0)
               + COALESCE(jsonb_array_length(app_servicio.portal_notifications_view(a.id, pr.product_id) -> 'today_items'), 0);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'contract', app_servicio.contract_version()::integer,
    'brand', jsonb_build_object('name', COALESCE(NULLIF(w.brand_name, ''), w.name), 'short', upper(left(COALESCE(NULLIF(w.brand_name, ''), w.name), 1)),
                                'logo_path', w.brand_logo_path, 'color', w.brand_color, 'host', w.portal_settings ->> 'host',
                                'support', w.portal_settings ->> 'support_whatsapp'),
    'programs', v_programs,
    'program', v_program,
    'moment', COALESCE(v_moment, 'exp'),
    'variant', 'full',
    'status', v_status,
    'pause', v_pause,
    'terms_pending', CASE WHEN pr.product_id IS NULL THEN false ELSE app_servicio.portal_terms_pending(v_contact, pr.product_id) END,
    'preview', sess ->> 'kind' = 'preview',
    'points_enabled', COALESCE(v_points -> 'enabled' = 'true'::jsonb, false),
    'levels', (SELECT jsonb_agg(jsonb_build_object('level', n, 'name', l ->> 'name', 'min', (l ->> 'min')::integer) ORDER BY n)
                 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_points -> 'levels') = 'array' AND jsonb_array_length(v_points -> 'levels') = 9 THEN v_points -> 'levels'
                   ELSE '[{"name":"Explorador","min":0},{"name":"Aprendiz","min":10},{"name":"Constructor","min":30},{"name":"Builder","min":60},{"name":"Builder Pro","min":100},{"name":"Arquitecto","min":160},{"name":"Experto","min":250},{"name":"Maestro","min":400},{"name":"Leyenda","min":600}]'::jsonb END)
                   WITH ORDINALITY AS t(l, n)),
    'me', jsonb_build_object('name', COALESCE(a.display_name, c.display_name, ''), 'first_name', split_part(COALESCE(a.display_name, c.display_name, ''), ' ', 1),
                             'email', COALESCE(a.email, c.email), 'points', CASE WHEN COALESCE(v_points -> 'enabled' = 'true'::jsonb, false) THEN v_total END,
                             'theme', COALESCE(a.notification_prefs ->> 'theme', 'dark')),
    'sections', v_sections,
    'excluded', v_excluded,
    'notifications_count', v_notif);
END;
$function$;

-- Avisos y resumen semanal: los anuncios y posts nuevos de sus comunidades.
CREATE OR REPLACE FUNCTION app_servicio.portal_notifications_view(p_account_id uuid, p_product_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  a app_servicio_portal.portal_accounts;
  v_today date; v_since timestamptz; v_prefs jsonb; v_today_items jsonb; v_news jsonb;
BEGIN
  SELECT * INTO a FROM app_servicio_portal.portal_accounts WHERE id = p_account_id;
  IF a.id IS NULL THEN RETURN NULL; END IF;
  v_today := app_servicio.portal_account_today(a.id);
  v_since := GREATEST(COALESCE(a.notifications_seen_at, '-infinity'::timestamptz), now() - interval '30 days');
  v_prefs := app_servicio.portal_notification_prefs(a.notification_prefs);
  SELECT COALESCE(jsonb_agg(jsonb_build_object('item_id', i.id, 'name', i.name, 'kind', i.kind, 'due_on', i.due_on, 'due_at', i.due_at,
           'occurrence', i.parent_item_id IS NOT NULL) ORDER BY i.due_at NULLS LAST, i.position), '[]'::jsonb)
    INTO v_today_items
    FROM app_servicio.service_items i JOIN app_servicio.services s ON s.id = i.service_id
   WHERE s.contact_id = a.contact_id AND s.product_id = p_product_id AND s.status = 'active' AND s.workspace_id = a.workspace_id
     AND i.status = 'pending' AND NOT i.is_recurring_template AND i.visible_to_client AND i.due_on = v_today;
  SELECT COALESCE(jsonb_agg(n ORDER BY n ->> 'at' DESC), '[]'::jsonb) INTO v_news FROM (
    SELECT jsonb_build_object('kind', 'review', 'at', fs.reviewed_at, 'title', f.name, 'status', fs.review_status, 'submission_id', fs.id) AS n
      FROM public.form_submissions fs JOIN public.forms f ON f.id = fs.form_id
     WHERE (v_prefs ->> 'review_done')::boolean AND fs.contact_id = a.contact_id AND f.product_id = p_product_id
       AND fs.review_status IN ('reviewed', 'needs_changes') AND fs.reviewed_at > v_since
    UNION ALL
    SELECT jsonb_build_object('kind', 'reply', 'at', r.created_at, 'post_id', r.parent_id, 'reply_id', r.id)
      FROM app_servicio_portal.community_posts r JOIN app_servicio_portal.community_posts p ON p.id = r.parent_id
     WHERE (v_prefs ->> 'community_reply')::boolean AND p.author_contact_id = a.contact_id AND r.author_contact_id IS DISTINCT FROM a.contact_id
       AND r.product_id = p_product_id AND r.created_at > v_since AND r.deleted_at IS NULL AND r.hidden_at IS NULL
    UNION ALL
    SELECT jsonb_build_object('kind', 'announcement', 'at', p.created_at, 'post_id', p.id)
      FROM app_servicio_portal.community_posts p
     WHERE (v_prefs ->> 'announcements')::boolean AND p.as_business AND p.parent_id IS NULL AND p.product_id = p_product_id
       AND p.community_key = ANY (app_servicio.contact_communities(a.contact_id, p_product_id))
       AND p.created_at > v_since AND p.deleted_at IS NULL AND p.hidden_at IS NULL
    UNION ALL
    SELECT jsonb_build_object('kind', 'content', 'at', pi.created_at, 'title', pi.title, 'program_item_id', pi.id)
      FROM app_servicio.program_items pi
     WHERE pi.product_id = p_product_id AND pi.workspace_id = a.workspace_id AND pi.status = 'active' AND pi.kind = 'lesson' AND pi.created_at > v_since
  ) x;
  RETURN jsonb_build_object('today', v_today, 'today_items', v_today_items, 'news', v_news, 'unseen', jsonb_array_length(v_news), 'prefs', v_prefs);
END;
$function$;
CREATE OR REPLACE FUNCTION app_servicio.portal_digest_data(p_account_id uuid, p_product_id uuid, p_since timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  a app_servicio_portal.portal_accounts;
  v_done integer; v_pending integer; v_reports integer; v_content integer; v_community integer; v_today date;
BEGIN
  SELECT * INTO a FROM app_servicio_portal.portal_accounts WHERE id = p_account_id;
  IF a.id IS NULL THEN RETURN NULL; END IF;
  v_today := app_servicio.portal_account_today(a.id);
  SELECT count(*) FILTER (WHERE i.status = 'completed' AND i.completed_at >= p_since AND i.parent_item_id IS NULL),
         count(*) FILTER (WHERE i.status = 'pending' AND i.visible_to_client AND i.parent_item_id IS NULL AND i.due_on IS NOT NULL AND i.due_on <= v_today + 7),
         count(*) FILTER (WHERE i.status = 'completed' AND i.completed_at >= p_since AND i.parent_item_id IS NOT NULL)
    INTO v_done, v_pending, v_reports
    FROM app_servicio.service_items i JOIN app_servicio.services s ON s.id = i.service_id
   WHERE s.contact_id = a.contact_id AND s.product_id = p_product_id AND s.status = 'active' AND NOT i.is_recurring_template;
  SELECT count(*) INTO v_content FROM app_servicio.program_items pi
   WHERE pi.product_id = p_product_id AND pi.status = 'active' AND pi.kind = 'lesson' AND pi.created_at >= p_since;
  SELECT count(*) INTO v_community FROM app_servicio_portal.community_posts cp
   WHERE cp.product_id = p_product_id AND cp.parent_id IS NULL AND cp.created_at >= p_since AND cp.deleted_at IS NULL AND cp.hidden_at IS NULL
     AND cp.community_key = ANY (app_servicio.contact_communities(a.contact_id, p_product_id));
  RETURN jsonb_build_object('done', v_done, 'pending', v_pending, 'challenge', v_reports, 'content', v_content, 'community', v_community);
END;
$function$;

-- ─── 5. Puntos, niveles y salón de la fama por comunidad (decisión 4) ──────────
-- Los puntos son de la persona en el programa (un upgrade los conserva); el ranking, «mi puesto», cuántos hay en cada
-- nivel y la Sala de la fama se arman solo con las personas de SU comunidad. Con una sola comunidad, igual que antes.
CREATE OR REPLACE FUNCTION app_servicio_portal.portal_points(p_session text, p_product_id uuid, p_period text DEFAULT '30d'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  pf jsonb := app_servicio_portal.program_for(sess, p_product_id, true);
  v_me uuid := (pf ->> 'contact_id')::uuid;
  v_settings jsonb;
  v_today date := (now() AT TIME ZONE app_servicio.points_tz(v_me, (pf ->> 'workspace_id')::uuid))::date;
  v_from date := CASE p_period WHEN '7d' THEN v_today - 6 WHEN 'all' THEN DATE '1900-01-01' ELSE v_today - 29 END;
  v_total integer;
  v_comm text := app_servicio.contact_current_community(v_me, p_product_id);
  v_members uuid[];
BEGIN
  SELECT portal_settings -> 'points' INTO v_settings FROM public.products WHERE id = p_product_id;
  IF v_settings -> 'enabled' IS DISTINCT FROM 'true'::jsonb THEN RETURN jsonb_build_object('enabled', false); END IF;
  SELECT COALESCE(sum(points), 0)::integer INTO v_total FROM app_servicio_portal.points_ledger WHERE contact_id = v_me AND product_id = p_product_id;
  SELECT COALESCE(array_agg(d.c), '{}'::uuid[]) INTO v_members
    FROM (SELECT DISTINCT contact_id AS c FROM app_servicio_portal.points_ledger WHERE product_id = p_product_id) d
   WHERE app_servicio.community_member(d.c, p_product_id, v_comm);
  RETURN jsonb_build_object(
    'enabled', true, 'period', p_period, 'total', v_total, 'level', app_servicio.level_of(v_total, v_settings -> 'levels'),
    'ranking_visible', COALESCE((v_settings #>> '{ranking,visible}')::boolean, true),
    'ranking', CASE WHEN COALESCE((v_settings #>> '{ranking,visible}')::boolean, true) THEN COALESCE((
      SELECT jsonb_agg(jsonb_build_object('name', app_servicio_portal.public_name(COALESCE(a.display_name, c.display_name)), 'me', r.contact_id = v_me,
               'period', r.period_points, 'total', r.total, 'level', (app_servicio.level_of(r.total, v_settings -> 'levels') ->> 'level')::integer,
               'by_group', r.by_group) ORDER BY r.period_points DESC, r.total DESC)
        FROM (SELECT l.contact_id,
                     sum(l.points) FILTER (WHERE l.local_day >= v_from)::integer AS period_points,
                     sum(l.points)::integer AS total,
                     (SELECT jsonb_object_agg(g.point_group, g.n) FROM (SELECT point_group, sum(points)::integer n FROM app_servicio_portal.points_ledger
                       WHERE contact_id = l.contact_id AND product_id = p_product_id AND local_day >= v_from GROUP BY point_group) g) AS by_group
                FROM app_servicio_portal.points_ledger l WHERE l.product_id = p_product_id AND l.contact_id = ANY (v_members) GROUP BY l.contact_id
               ORDER BY 2 DESC NULLS LAST LIMIT 50) r
        JOIN public.contacts c ON c.id = r.contact_id
        LEFT JOIN app_servicio_portal.portal_accounts a ON a.contact_id = r.contact_id AND a.workspace_id = c.workspace_id
       WHERE r.contact_id = v_me OR COALESCE((a.notification_prefs ->> 'hide_from_ranking')::boolean, false) IS NOT TRUE), '[]'::jsonb) END,
    'my_place', (SELECT x.n FROM (SELECT contact_id, row_number() OVER (ORDER BY sum(points) FILTER (WHERE local_day >= v_from) DESC NULLS LAST) n
                                    FROM app_servicio_portal.points_ledger WHERE product_id = p_product_id AND contact_id = ANY (v_members) GROUP BY contact_id) x WHERE x.contact_id = v_me),
    'levels_count', (SELECT COALESCE(jsonb_object_agg(lv, n), '{}'::jsonb) FROM (
                       SELECT (app_servicio.level_of(t.total, v_settings -> 'levels') ->> 'level') lv, count(*) n
                         FROM (SELECT sum(points)::integer total FROM app_servicio_portal.points_ledger WHERE product_id = p_product_id AND contact_id = ANY (v_members) GROUP BY contact_id) t GROUP BY 1) q),
    'my_groups', (SELECT COALESCE(jsonb_object_agg(point_group, n), '{}'::jsonb) FROM (SELECT point_group, sum(points)::integer n FROM app_servicio_portal.points_ledger
                    WHERE contact_id = v_me AND product_id = p_product_id AND local_day >= v_from GROUP BY point_group) g),
    'history', COALESCE((SELECT jsonb_agg(jsonb_build_object('points', l.points, 'group', l.point_group, 'kind', split_part(l.source_key, ':', 1), 'reason', l.reason, 'day', l.local_day) ORDER BY l.created_at DESC)
                           FROM (SELECT * FROM app_servicio_portal.points_ledger WHERE contact_id = v_me AND product_id = p_product_id ORDER BY created_at DESC LIMIT 20) l), '[]'::jsonb),
    'settings', jsonb_build_object('values', v_settings -> 'values', 'caps', v_settings -> 'caps'));
END;
$function$;
CREATE OR REPLACE FUNCTION app_servicio_portal.portal_fame(p_session text, p_product_id uuid, p_period text DEFAULT 'all'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  pf jsonb := app_servicio_portal.program_for(sess, p_product_id, true);
  v_ws uuid := (pf ->> 'workspace_id')::uuid;
  v_rev jsonb := NULL;
  v_comm text := app_servicio.contact_current_community((pf ->> 'contact_id')::uuid, p_product_id);
BEGIN
  IF app_servicio_proyectos.enabled(v_ws) AND app_servicio.portal_section_enabled(p_product_id, 'fame') THEN
    v_rev := COALESCE((SELECT jsonb_agg(jsonb_build_object(
               'name', app_servicio_portal.public_name(COALESCE(a.display_name, c.display_name)),
               'me', c.id = (pf ->> 'contact_id')::uuid,
               'amount_cents', CASE WHEN COALESCE(a.show_amount_in_fame, false) OR c.id = (pf ->> 'contact_id')::uuid THEN (f ->> 'amount_cents')::bigint END,
               'projects_won', (f ->> 'projects_won')::integer) ORDER BY o)
      FROM jsonb_array_elements(app_servicio_proyectos.fame_ranking(p_product_id, CASE WHEN p_period = 'month' THEN 'month' ELSE 'all' END)) WITH ORDINALITY x(f, o)
      JOIN public.contacts c ON c.id = (f ->> 'contact_id')::uuid
      LEFT JOIN app_servicio_portal.portal_accounts a ON a.contact_id = c.id AND a.workspace_id = v_ws
     WHERE (NOT COALESCE((a.notification_prefs ->> 'hide_from_ranking')::boolean, false) OR c.id = (pf ->> 'contact_id')::uuid)
       AND app_servicio.community_member(c.id, p_product_id, v_comm)), '[]'::jsonb);
  END IF;
  RETURN jsonb_build_object(
    'show_amount', COALESCE((SELECT a.show_amount_in_fame FROM app_servicio_portal.portal_accounts a WHERE a.id = (sess ->> 'account_id')::uuid), false),
    'points_enabled', (SELECT portal_settings #> '{points,enabled}' = 'true'::jsonb FROM public.products WHERE id = p_product_id),
    'revenue', v_rev);
END;
$function$;

-- El ranking del equipo (pestaña Puntos), de una comunidad (`p_community`) o de todas (sin comunidad, como antes).
DROP FUNCTION IF EXISTS app_servicio.points_ranking(uuid, integer);
CREATE OR REPLACE FUNCTION app_servicio.points_ranking(p_product_id uuid, p_limit integer DEFAULT 50, p_community text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_ws uuid; v_settings jsonb;
BEGIN
  SELECT workspace_id, portal_settings -> 'points' INTO v_ws, v_settings FROM public.products WHERE id = p_product_id;
  IF v_ws IS NULL THEN RETURN NULL; END IF;
  IF NOT app_servicio.is_system() AND NOT (public.has_permission(v_ws, 'portal.points') OR public.has_permission(v_ws, 'portal.view')) THEN
    RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004';
  END IF;
  RETURN jsonb_build_object(
    'students', (SELECT count(DISTINCT contact_id) FROM app_servicio_portal.points_ledger WHERE product_id = p_product_id
                   AND (p_community IS NULL OR app_servicio.community_member(contact_id, p_product_id, p_community))),
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'contact_id', r.contact_id, 'name', COALESCE(c.display_name, c.email, 'Sin nombre'), 'total', r.total,
               'level', app_servicio.level_of(r.total, v_settings -> 'levels'),
               'service_id', (SELECT sv.id FROM app_servicio.services sv
                               WHERE sv.contact_id = r.contact_id AND sv.product_id = p_product_id AND NOT sv.is_test
                               ORDER BY (sv.status IN ('active', 'paused')) DESC, sv.created_at DESC LIMIT 1))
             ORDER BY r.total DESC, c.display_name)
        FROM (SELECT contact_id, sum(points)::integer AS total FROM app_servicio_portal.points_ledger
               WHERE product_id = p_product_id AND (p_community IS NULL OR app_servicio.community_member(contact_id, p_product_id, p_community)) GROUP BY contact_id
               ORDER BY 2 DESC LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)) r
        JOIN public.contacts c ON c.id = r.contact_id), '[]'::jsonb));
END;
$function$;

-- ─── 6. Upgrade (R5): al activarse, el servicio nuevo cierra los que marca su variante ─────
CREATE OR REPLACE FUNCTION app_servicio.svc_activate(p_service_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  s app_servicio.services;
BEGIN
  PERFORM app_servicio.svc_instantiate_journey(p_service_id);
  PERFORM app_servicio.svc_grant_initial_access(p_service_id);
  PERFORM app_servicio.svc_compute_light(p_service_id);
  SELECT * INTO s FROM app_servicio.services WHERE id = p_service_id;
  IF s.starts_on IS NULL OR s.starts_on <= app_servicio.today_in(s.workspace_id) THEN
    PERFORM app_servicio.emit(s, 'service_started');
    UPDATE app_servicio.services SET flags = flags || '{"started_emitted": true}'::jsonb WHERE id = p_service_id;
  END IF;
  PERFORM app_servicio.svc_close_on_upgrade(p_service_id);
END;
$function$;

-- ─── 7. Clases en vivo (R7): una fecha se abre también a otras variantes ─────────────
CREATE OR REPLACE FUNCTION app_servicio.live_date_save(p_live_session_id uuid, p_occurs_on date, p jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  ls record;
  cur record;
  v_extra uuid[];
BEGIN
  SELECT id, workspace_id, product_id INTO ls FROM app_servicio.live_sessions WHERE id = p_live_session_id;
  IF ls.id IS NULL THEN RAISE EXCEPTION 'No existe la sesión' USING ERRCODE = 'CA002'; END IF;
  IF NOT app_servicio.is_system() AND NOT public.has_permission(ls.workspace_id, 'live_sessions.manage') THEN
    RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004';
  END IF;
  SELECT * INTO cur FROM app_servicio.live_session_dates WHERE live_session_id = ls.id AND occurs_on = p_occurs_on FOR UPDATE;
  IF app_servicio.is_system() AND cur.recording_source = 'manual' AND (p ? 'recording_url' OR p ? 'recording_call_id') THEN
    p := p - 'recording_url' - 'recording_call_id' - 'recording_source';
  END IF;
  -- La grabacion elegida tiene que ser del mismo negocio (el id viene del navegador).
  IF NULLIF(p ->> 'recording_call_id', '') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.calls c WHERE c.id = (p ->> 'recording_call_id')::uuid AND c.workspace_id = ls.workspace_id) THEN
    RAISE EXCEPTION 'No existe esa grabación' USING ERRCODE = 'CA002';
  END IF;
  -- `extra_variant_ids`: las variantes del programa que ven esta fecha además de las de la sesión.
  IF p ? 'extra_variant_ids' THEN
    IF jsonb_typeof(p -> 'extra_variant_ids') NOT IN ('array', 'null')
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(NULLIF(p -> 'extra_variant_ids', 'null'::jsonb), '[]'::jsonb)) x
                   WHERE jsonb_typeof(x) <> 'string' OR (x #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
      RAISE EXCEPTION 'Las variantes no son válidas' USING ERRCODE = 'CA002';
    END IF;
    SELECT COALESCE(array_agg(DISTINCT x::uuid), '{}'::uuid[]) INTO v_extra
      FROM jsonb_array_elements_text(COALESCE(NULLIF(p -> 'extra_variant_ids', 'null'::jsonb), '[]'::jsonb)) x;
    IF EXISTS (SELECT 1 FROM unnest(v_extra) e WHERE NOT EXISTS (SELECT 1 FROM public.product_variants v WHERE v.id = e AND v.product_id = ls.product_id)) THEN
      RAISE EXCEPTION 'Elegí variantes de este programa' USING ERRCODE = 'CA002';
    END IF;
  END IF;
  INSERT INTO app_servicio.live_session_dates (workspace_id, live_session_id, occurs_on, status, moved_to, recording_url, recording_call_id, recording_source, recording_active, note, extra_variant_ids)
  VALUES (ls.workspace_id, ls.id, p_occurs_on, COALESCE(p ->> 'status', 'normal'), NULLIF(p ->> 'moved_to', '')::timestamptz,
          NULLIF(p ->> 'recording_url', ''), NULLIF(p ->> 'recording_call_id', '')::uuid, NULLIF(p ->> 'recording_source', ''),
          COALESCE((p ->> 'recording_active')::boolean, true), NULLIF(p ->> 'note', ''), COALESCE(v_extra, '{}'::uuid[]))
  ON CONFLICT (live_session_id, occurs_on) DO UPDATE SET
    status = CASE WHEN p ? 'status' THEN p ->> 'status' ELSE app_servicio.live_session_dates.status END,
    moved_to = CASE WHEN p ? 'moved_to' THEN NULLIF(p ->> 'moved_to', '')::timestamptz ELSE app_servicio.live_session_dates.moved_to END,
    recording_url = CASE WHEN p ? 'recording_url' THEN NULLIF(p ->> 'recording_url', '') ELSE app_servicio.live_session_dates.recording_url END,
    recording_call_id = CASE WHEN p ? 'recording_call_id' THEN NULLIF(p ->> 'recording_call_id', '')::uuid ELSE app_servicio.live_session_dates.recording_call_id END,
    recording_source = CASE WHEN p ? 'recording_source' THEN NULLIF(p ->> 'recording_source', '') ELSE app_servicio.live_session_dates.recording_source END,
    recording_active = CASE WHEN p ? 'recording_active' THEN (p ->> 'recording_active')::boolean ELSE app_servicio.live_session_dates.recording_active END,
    note = CASE WHEN p ? 'note' THEN NULLIF(p ->> 'note', '') ELSE app_servicio.live_session_dates.note END,
    extra_variant_ids = CASE WHEN p ? 'extra_variant_ids' THEN v_extra ELSE app_servicio.live_session_dates.extra_variant_ids END,
    updated_at = now();
  PERFORM app_servicio.audit(ls.workspace_id, 'live_session', ls.id, 'live_session.date_saved', jsonb_build_object('occurs_on', p_occurs_on, 'keys', (SELECT jsonb_agg(k) FROM jsonb_object_keys(p) k)));
END;
$function$;
CREATE OR REPLACE FUNCTION app_servicio.attendance_base_members(p_live_session_id uuid, p_occurs_on date)
 RETURNS TABLE(contact_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  WITH ls AS (SELECT * FROM app_servicio.live_sessions WHERE id = p_live_session_id),
  day_end AS (SELECT app_servicio.end_of_day(p_occurs_on, ls.timezone) AS t FROM ls)
  SELECT DISTINCT s.contact_id
    FROM ls, day_end, app_servicio.services s
   WHERE s.product_id = ls.product_id AND s.status IN ('active', 'paused', 'completed')
     AND app_servicio.attendance_base_plan(jsonb_build_object(
       'base', ls.attendance_base,
       'sessionVariantIds', to_jsonb(CASE WHEN cardinality(ls.variant_ids) > 0
                                          THEN ls.variant_ids || COALESCE((SELECT d.extra_variant_ids FROM app_servicio.live_session_dates d
                                                                            WHERE d.live_session_id = ls.id AND d.occurs_on = p_occurs_on), '{}'::uuid[])
                                          ELSE ls.variant_ids END),
       'occursOn', p_occurs_on,
       'member', jsonb_build_object(
         'calendarAccess', EXISTS (SELECT 1 FROM app_servicio_portal.portal_access a
                                    WHERE a.service_id = s.id AND a.section = 'calendar' AND a.starts_at <= day_end.t
                                      AND (a.ends_at IS NULL OR a.ends_at >= day_end.t) AND (a.revoked_at IS NULL OR a.revoked_at > day_end.t)),
         'variantId', s.product_variant_id,
         'serviceStartsOn', s.starts_on,
         'phaseKeyOnDate', (SELECT ph.template_key FROM app_servicio.service_phases ph
                             WHERE ph.service_id = s.id AND ph.started_at IS NOT NULL AND ph.started_at <= day_end.t
                               AND (ph.completed_at IS NULL OR ph.completed_at > day_end.t)
                             ORDER BY ph.started_at DESC LIMIT 1))));
$function$;
CREATE OR REPLACE FUNCTION app_servicio_portal.portal_calendar(p_session text, p_product_id uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  pf jsonb := app_servicio_portal.require_section(sess, p_product_id, 'calendar');
  v_contact uuid := (pf ->> 'contact_id')::uuid;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 120 THEN PERFORM app_servicio_portal.err('PO400', 'El rango de fechas no es válido'); END IF;
  RETURN jsonb_build_object(
    'timezone', app_servicio.points_tz(v_contact, (pf ->> 'workspace_id')::uuid),
    'dates', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'session_id', o.live_session_id, 'title', ls.title, 'kind', ls.kind, 'occurs_on', o.occurs_on, 'starts_at', o.starts_at, 'ends_at', o.ends_at,
               'status', o.status, 'keyword_required', NULLIF(ls.keyword, '') IS NOT NULL,
               'can_enter', o.ends_at > now() - interval '30 minutes' AND o.starts_at < now() + interval '10 minutes' AND NULLIF(ls.meeting_url, '') IS NOT NULL,
               'can_mark', app_servicio.live_attendance_window(o.starts_at, o.ends_at, now()),
               'attended', EXISTS (SELECT 1 FROM app_servicio_portal.live_attendance a WHERE a.live_session_id = ls.id AND a.occurs_on = o.occurs_on
                                    AND a.contact_id = v_contact AND a.removed_at IS NULL),
               'recording', EXISTS (SELECT 1 FROM app_servicio.live_session_dates d WHERE d.live_session_id = ls.id AND d.occurs_on = o.occurs_on
                                     AND d.recording_active AND (NULLIF(d.recording_url, '') IS NOT NULL OR d.recording_call_id IS NOT NULL)))
             ORDER BY o.starts_at)
        FROM app_servicio.live_session_occurrences(p_product_id, p_from, p_to) o
        JOIN app_servicio.live_sessions ls ON ls.id = o.live_session_id
       WHERE ls.archived_at IS NULL
         AND app_servicio.live_date_visible(ls.variant_ids,
               (SELECT d.extra_variant_ids FROM app_servicio.live_session_dates d WHERE d.live_session_id = ls.id AND d.occurs_on = o.occurs_on),
               (pf ->> 'variant_id')::uuid)), '[]'::jsonb));
END;
$function$;
CREATE OR REPLACE FUNCTION app_servicio_portal.live_for(p_sess jsonb, p_session_id uuid, p_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  ls app_servicio.live_sessions;
  pf jsonb;
  o record;
BEGIN
  SELECT * INTO ls FROM app_servicio.live_sessions WHERE id = p_session_id AND archived_at IS NULL;
  IF ls.id IS NULL THEN PERFORM app_servicio_portal.err('PO404', 'Esta clase no existe'); END IF;
  pf := app_servicio_portal.require_section(p_sess, ls.product_id, 'calendar');
  IF NOT app_servicio.live_date_visible(ls.variant_ids,
           (SELECT d.extra_variant_ids FROM app_servicio.live_session_dates d WHERE d.live_session_id = ls.id AND d.occurs_on = p_date),
           (pf ->> 'variant_id')::uuid) THEN
    PERFORM app_servicio_portal.err('PO404', 'Esta clase no existe');
  END IF;
  SELECT * INTO o FROM app_servicio.live_session_occurrences(ls.product_id, p_date, p_date) x WHERE x.live_session_id = ls.id AND x.occurs_on = p_date;
  IF o.live_session_id IS NULL OR o.status = 'cancelled' THEN PERFORM app_servicio_portal.err('PO404', 'Esa fecha no tiene clase'); END IF;
  RETURN jsonb_build_object('session_id', ls.id, 'product_id', ls.product_id, 'title', ls.title, 'occurs_on', p_date, 'starts_at', o.starts_at, 'ends_at', o.ends_at,
    'meeting_url', ls.meeting_url, 'keyword', ls.keyword, 'click_counts', ls.click_counts_as_attendance, 'workspace_id', ls.workspace_id,
    'contact_id', pf ->> 'contact_id', 'in_window', app_servicio.live_attendance_window(o.starts_at, o.ends_at, now()));
END;
$function$;

-- ─── 8. Configuración: comunidades del programa, comunidad de la variante y cierre por upgrade ─────
-- Gemela de `communitiesProblems` (lib/portal-admin/settings.ts, portal-settings.cases.json). Lo que depende de la base
-- (archivar una comunidad que usa una variante) solo con el programa.
CREATE OR REPLACE FUNCTION app_servicio.community_settings_problems(c jsonb, p_product_id uuid DEFAULT NULL)
RETURNS text[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v text[] := ARRAY[]::text[];
  x jsonb; sp jsonb;
  v_keys text[] := ARRAY[]::text[];
  v_names text[] := ARRAY[]::text[];
  v_skeys text[];
  v_name text;
  v_mains integer := 0;
  v_used text;
BEGIN
  IF c IS NULL OR jsonb_typeof(c) <> 'object' OR NOT c ? 'communities' THEN RETURN v; END IF;
  IF jsonb_typeof(c -> 'communities') <> 'array' THEN RETURN ARRAY['las comunidades no son válidas']; END IF;
  IF jsonb_array_length(c -> 'communities') = 0 THEN RETURN ARRAY['dejá al menos una comunidad']; END IF;
  FOR x IN SELECT e FROM jsonb_array_elements(c -> 'communities') e LOOP
    IF jsonb_typeof(x) <> 'object' OR jsonb_typeof(x -> 'key') IS DISTINCT FROM 'string' OR (x ->> 'key') !~ '^[a-z0-9_]{1,40}$'
       OR jsonb_typeof(x -> 'name') IS DISTINCT FROM 'string' OR btrim(x ->> 'name') = '' THEN
      v := v || 'hay una comunidad sin nombre o con una clave inválida'::text;
      CONTINUE;
    END IF;
    v_name := btrim(x ->> 'name');
    v := v || app_servicio.unknown_keys(x, ARRAY['key','name','main','archived','spaces']);
    IF (x ->> 'key') = ANY (v_keys) THEN v := v || format('la comunidad %s está repetida', x ->> 'key'); END IF;
    v_keys := v_keys || (x ->> 'key');
    IF lower(v_name) = ANY (v_names) THEN v := v || format('ya hay una comunidad que se llama %s', v_name); END IF;
    v_names := v_names || lower(v_name);
    IF (x ? 'main' AND jsonb_typeof(x -> 'main') <> 'boolean') OR (x ? 'archived' AND jsonb_typeof(x -> 'archived') <> 'boolean') THEN
      v := v || format('%s: principal y archivada son sí o no', v_name);
    END IF;
    IF x -> 'main' = 'true'::jsonb THEN
      v_mains := v_mains + 1;
      IF x -> 'archived' = 'true'::jsonb THEN v := v || 'la comunidad principal no se puede archivar'::text; END IF;
    END IF;
    IF x ? 'spaces' THEN
      IF jsonb_typeof(x -> 'spaces') <> 'array' THEN v := v || format('%s: los espacios no son válidos', v_name);
      ELSE
        v_skeys := ARRAY[]::text[];
        FOR sp IN SELECT s FROM jsonb_array_elements(x -> 'spaces') s LOOP
          IF jsonb_typeof(sp) <> 'object' OR jsonb_typeof(sp -> 'key') IS DISTINCT FROM 'string' OR (sp ->> 'key') !~ '^[a-z0-9_]{1,40}$'
             OR jsonb_typeof(sp -> 'name') IS DISTINCT FROM 'string' OR btrim(sp ->> 'name') = '' THEN
            v := v || format('%s: hay un espacio sin nombre o con una clave inválida', v_name);
            CONTINUE;
          END IF;
          IF (sp ->> 'key') = ANY (v_skeys) THEN v := v || format('%s: el espacio %s está repetido', v_name, sp ->> 'key'); END IF;
          v_skeys := v_skeys || (sp ->> 'key');
        END LOOP;
      END IF;
    END IF;
  END LOOP;
  IF v_mains <> 1 THEN v := v || 'elegí una sola comunidad principal'::text; END IF;
  IF p_product_id IS NOT NULL THEN
    FOR x IN SELECT e FROM jsonb_array_elements(c -> 'communities') e WHERE jsonb_typeof(e) = 'object' AND e -> 'archived' = 'true'::jsonb LOOP
      SELECT string_agg(pv.name, ', ' ORDER BY pv.display_order, pv.name) INTO v_used FROM public.product_variants pv
       WHERE pv.product_id = p_product_id AND pv.archived_at IS NULL AND pv.portal_settings ->> 'community_key' = x ->> 'key';
      IF v_used IS NOT NULL THEN
        v := v || format('«%s» la usan estas variantes: %s. Cambiales la comunidad antes de archivarla', btrim(x ->> 'name'), v_used);
      END IF;
    END LOOP;
  END IF;
  RETURN v;
END;
$$;
CREATE OR REPLACE FUNCTION app_servicio.validate_program_portal_settings(p jsonb, p_product_id uuid DEFAULT NULL::uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v text[] := ARRAY[]::text[];
  k text; t jsonb; c jsonb; sp jsonb; a jsonb;
  v_keys text[] := ARRAY[]::text[];
  v_ext boolean := COALESCE((SELECT app_servicio_proyectos.enabled(pr.workspace_id) FROM public.products pr WHERE pr.id = p_product_id), false);
  v_allowed text[] := ARRAY['v','sections','terms','community','affiliates','assistant','notifications','points'];
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN RETURN ARRAY['la configuración tiene que ser un objeto']; END IF;
  IF v_ext THEN v_allowed := v_allowed || ARRAY['fame','projects']; END IF;
  v := v || app_servicio.unknown_keys(p, v_allowed);
  IF p ? 'v' AND p -> 'v' <> '1'::jsonb THEN v := v || 'versión desconocida'::text; END IF;
  IF p ? 'sections' THEN
    IF jsonb_typeof(p -> 'sections') <> 'object' THEN v := v || 'las secciones no son válidas'::text;
    ELSE
      FOR k IN SELECT key FROM jsonb_object_keys(p -> 'sections') WITH ORDINALITY AS t(key, ord) ORDER BY ord LOOP
        IF NOT COALESCE(k = ANY (ARRAY['program','calendar','challenge','certificate','assistant','community','affiliates','fame','projects']), false) THEN v := v || ('sección desconocida: ' || k);
        ELSIF NOT COALESCE(k = ANY (ARRAY['program','calendar','challenge','certificate','assistant','community','affiliates']), false) AND NOT v_ext THEN v := v || 'Todavía no está disponible'::text;
        ELSIF jsonb_typeof(p -> 'sections' -> k) <> 'boolean' THEN v := v || (k || ': tiene que ser sí o no');
        END IF;
      END LOOP;
    END IF;
  END IF;
  IF p ? 'terms' THEN
    t := p -> 'terms';
    IF jsonb_typeof(t) <> 'object' THEN v := v || 'los términos no son válidos'::text;
    ELSE
      v := v || app_servicio.unknown_keys(t, ARRAY['enabled','form_id','ask_again_on_change']);
      IF t -> 'enabled' = 'true'::jsonb AND NOT app_servicio.j_uuid(t -> 'form_id') THEN v := v || 'cargá los términos antes de prenderlos'::text; END IF;
    END IF;
  END IF;
  IF p ? 'community' THEN
    c := p -> 'community';
    IF jsonb_typeof(c) <> 'object' THEN v := v || 'la comunidad no es válida'::text;
    ELSE
      v := v || app_servicio.unknown_keys(c, ARRAY['lesson_comments','spaces','communities']);
      v := v || app_servicio.community_settings_problems(c, p_product_id);
      IF c ? 'spaces' THEN
        IF jsonb_typeof(c -> 'spaces') <> 'array' THEN v := v || 'los espacios no son válidos'::text;
        ELSE
          FOR sp IN SELECT x FROM jsonb_array_elements(c -> 'spaces') x LOOP
            IF jsonb_typeof(sp) <> 'object' OR jsonb_typeof(sp -> 'key') IS DISTINCT FROM 'string' OR (sp ->> 'key') !~ '^[a-z0-9_]{1,40}$'
               OR jsonb_typeof(sp -> 'name') IS DISTINCT FROM 'string' OR btrim(sp ->> 'name') = '' THEN
              v := v || 'hay un espacio sin nombre o con una clave inválida'::text;
              CONTINUE;
            END IF;
            IF (sp ->> 'key') = ANY (v_keys) THEN v := v || format('el espacio %s está repetido', sp ->> 'key'); END IF;
            v_keys := v_keys || (sp ->> 'key');
          END LOOP;
        END IF;
      END IF;
    END IF;
  END IF;
  IF p ? 'affiliates' THEN
    a := p -> 'affiliates';
    IF jsonb_typeof(a) <> 'object' OR (a ? 'visible_link_keys' AND NOT (jsonb_typeof(a -> 'visible_link_keys') = 'array'
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(a -> 'visible_link_keys') x WHERE jsonb_typeof(x) <> 'string' OR (x #>> '{}') !~ '^lk_[a-z0-9]{6}$'))) THEN
      v := v || 'los links de afiliados no son válidos'::text;
    END IF;
  END IF;
  IF p ? 'assistant' THEN
    a := p -> 'assistant';
    IF jsonb_typeof(a) <> 'object' THEN v := v || 'el asistente no es válido'::text;
    ELSE
      v := v || app_servicio.unknown_keys(a, ARRAY['excluded_kb_ids','monthly_limit_usd_per_student','credits_per_usd','credits_name','suggestions']);
      IF a ? 'monthly_limit_usd_per_student' AND NOT (jsonb_typeof(a -> 'monthly_limit_usd_per_student') = 'number'
         AND app_servicio.j_num(a -> 'monthly_limit_usd_per_student') BETWEEN 0 AND 10000) THEN
        v := v || 'el límite por estudiante va de 0 a 10.000 dólares'::text;
      END IF;
      IF a ? 'credits_per_usd' AND NOT (app_servicio.j_int(a -> 'credits_per_usd') AND app_servicio.j_num(a -> 'credits_per_usd') BETWEEN 1 AND 100000) THEN
        v := v || 'los créditos por dólar tienen que ser un número entero positivo'::text;
      END IF;
    END IF;
  END IF;
  IF p ? 'notifications' THEN
    a := p -> 'notifications';
    IF jsonb_typeof(a) <> 'object' THEN v := v || 'los avisos no son válidos'::text;
    ELSE
      v := v || app_servicio.unknown_keys(a, ARRAY['weekly_digest','due_today_email']);
      IF (a ? 'weekly_digest' AND jsonb_typeof(a -> 'weekly_digest') <> 'boolean') OR (a ? 'due_today_email' AND jsonb_typeof(a -> 'due_today_email') <> 'boolean') THEN
        v := v || 'los avisos tienen que ser sí o no'::text;
      END IF;
    END IF;
  END IF;
  IF p ? 'points' THEN v := v || app_servicio.points_settings_problems(p -> 'points'); END IF;
  -- Corrida C: la Sala de la fama y Mis proyectos (solo con la extensión; si no, ya cayeron como clave desconocida).
  IF v_ext AND p ? 'fame' THEN v := v || app_servicio_proyectos.fame_settings_problems(p -> 'fame'); END IF;
  IF v_ext AND p ? 'projects' THEN v := v || app_servicio_proyectos.projects_settings_problems(p -> 'projects'); END IF;
  RETURN v;
END;
$function$;

-- Guardar el programa: una comunidad nunca se borra (se archiva), y un cambio de `community` que no trae `communities`
-- (los espacios de antes) no se las lleva puestas.
CREATE OR REPLACE FUNCTION app_servicio.portal_admin_save_program_settings(p_product_id uuid, p_patch jsonb, p_rev integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_row public.products;
  v_new jsonb;
  v_problems text[];
  k text;
BEGIN
  SELECT * INTO v_row FROM public.products WHERE id = p_product_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'No existe el producto' USING ERRCODE = 'SV002'; END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN RAISE EXCEPTION 'El cambio no es válido' USING ERRCODE = 'SV001'; END IF;
  IF p_patch ? 'projects' THEN RAISE EXCEPTION 'Mis proyectos se configura desde la Mesa de trabajo' USING ERRCODE = 'SV001'; END IF;
  FOR k IN SELECT jsonb_object_keys(p_patch) LOOP
    PERFORM app_servicio.require_permission(v_row.workspace_id, CASE k
      WHEN 'sections' THEN 'portal.sections'
      WHEN 'terms' THEN 'portal.sections'
      WHEN 'affiliates' THEN 'portal.sections'
      WHEN 'community' THEN 'community.spaces'
      WHEN 'assistant' THEN 'tutor.manage'
      WHEN 'points' THEN 'portal.points'
      WHEN 'fame' THEN 'fame.manage'
      ELSE 'portal.sections' END);
  END LOOP;
  v_new := COALESCE(v_row.portal_settings, '{}'::jsonb) || p_patch;
  IF p_patch ? 'community' AND jsonb_typeof(p_patch -> 'community') = 'object' AND NOT (p_patch -> 'community' ? 'communities')
     AND jsonb_typeof(v_row.portal_settings #> '{community,communities}') = 'array' THEN
    v_new := jsonb_set(v_new, '{community,communities}', v_row.portal_settings #> '{community,communities}');
  END IF;
  v_problems := app_servicio.validate_program_portal_settings(v_new, p_product_id);
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(app_servicio.community_list_plan(COALESCE(v_row.portal_settings, '{}'::jsonb))) o
              WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(app_servicio.community_list_plan(v_new)) n WHERE n ->> 'key' = o ->> 'key')) THEN
    v_problems := COALESCE(v_problems, ARRAY[]::text[]) || 'una comunidad no se borra: archivala'::text;
  END IF;
  IF array_length(v_problems, 1) > 0 THEN
    RETURN jsonb_build_object('status', 'invalid', 'problems', to_jsonb(v_problems));
  END IF;
  UPDATE public.products
     SET portal_settings = v_new, portal_settings_rev = portal_settings_rev + 1
   WHERE id = p_product_id AND portal_settings_rev = p_rev;
  IF NOT FOUND THEN
    SELECT * INTO v_row FROM public.products WHERE id = p_product_id;
    RETURN jsonb_build_object('status', 'conflict', 'current', v_row.portal_settings, 'rev', v_row.portal_settings_rev);
  END IF;
  INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, performed_by, actor_type)
  VALUES (v_row.workspace_id, 'product', p_product_id, 'svc.config_saved',
          jsonb_build_object('part', 'program', 'keys', (SELECT jsonb_agg(x) FROM jsonb_object_keys(p_patch) x)), auth.uid(), 'user');
  RETURN jsonb_build_object('status', 'ok', 'rev', p_rev + 1, 'current', v_new);
END;
$function$;

-- La comunidad de la variante (`community_key`; vacío = la principal).
CREATE OR REPLACE FUNCTION app_servicio.validate_variant_portal_settings(p jsonb, p_variant_id uuid DEFAULT NULL::uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v text[] := ARRAY[]::text[];
  s jsonb;
  v_seen text[] := ARRAY[]::text[];
  v_ext boolean := COALESCE((SELECT app_servicio_proyectos.enabled(pr.workspace_id) FROM public.product_variants pv
                              JOIN public.products pr ON pr.id = pv.product_id WHERE pv.id = p_variant_id), false);
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN RETURN ARRAY['la configuración tiene que ser un objeto']; END IF;
  v := v || app_servicio.unknown_keys(p, ARRAY['v','enabled','ask_terms','sections','community_key']);
  IF p ? 'v' AND p -> 'v' <> '1'::jsonb THEN v := v || 'versión desconocida'::text; END IF;
  IF p ? 'enabled' AND jsonb_typeof(p -> 'enabled') <> 'boolean' THEN v := v || '«Acceso al portal» tiene que ser sí o no'::text; END IF;
  IF p ? 'ask_terms' AND jsonb_typeof(p -> 'ask_terms') <> 'boolean' THEN v := v || '«Esta variante los pide» tiene que ser sí o no'::text; END IF;
  IF p ? 'community_key' AND jsonb_typeof(p -> 'community_key') <> 'null' THEN
    IF jsonb_typeof(p -> 'community_key') <> 'string' OR (p ->> 'community_key') !~ '^[a-z0-9_]{1,40}$' THEN
      v := v || 'la comunidad no es válida'::text;
    -- (Al crear la variante todavía no existe: se controla al guardar su portal.)
    ELSIF EXISTS (SELECT 1 FROM public.product_variants pv WHERE pv.id = p_variant_id) AND NOT EXISTS (
      SELECT 1 FROM public.product_variants pv, jsonb_array_elements(app_servicio.community_list(pv.product_id)) x
       WHERE pv.id = p_variant_id AND x ->> 'key' = p ->> 'community_key' AND NOT (x ->> 'archived')::boolean) THEN
      v := v || 'esa comunidad no existe o está archivada'::text;
    END IF;
  END IF;
  IF p ? 'sections' THEN
    IF jsonb_typeof(p -> 'sections') <> 'array' THEN v := v || 'las secciones no son válidas'::text;
    ELSE
      FOR s IN SELECT x FROM jsonb_array_elements(p -> 'sections') x LOOP
        IF jsonb_typeof(s) <> 'object' THEN v := v || 'hay una sección que no es válida'::text; CONTINUE; END IF;
        IF jsonb_typeof(s -> 'section') = 'string' THEN
          IF (s ->> 'section') = ANY (v_seen) THEN v := v || format('la sección %s está repetida', s ->> 'section'); END IF;
          v_seen := v_seen || (s ->> 'section');
        END IF;
        v := v || app_servicio.portal_section_rule_problems(s, v_ext);
      END LOOP;
    END IF;
  END IF;
  RETURN v;
END;
$function$;

-- «Si tiene un servicio activo de: [variantes] → cerrarlo al crear este» (`closes_variant_ids`), en cualquier modo.
CREATE OR REPLACE FUNCTION app_servicio.validate_service_settings(p jsonb, p_variant_id uuid DEFAULT NULL::uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v text[] := ARRAY[]::text[];
  v_mode text;
  v_allowed text[];
  v_when jsonb; v_owner jsonb; v_ext jsonb; v_x jsonb;
  v_product uuid; v_ws uuid;
  v_fb_product uuid; v_fb_mode text;
  v_n numeric;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN
    RETURN ARRAY['la configuración tiene que ser un objeto'];
  END IF;
  IF p ? 'v' AND p -> 'v' <> '1'::jsonb THEN v := v || 'versión desconocida'::text; END IF;
  IF p ? 'mode' AND NOT COALESCE(p ->> 'mode' = ANY (ARRAY['create','extend','none']), false) THEN
    RETURN v || 'modo desconocido'::text;
  END IF;
  v_mode := COALESCE(p ->> 'mode', 'none');
  v_allowed := CASE v_mode
    WHEN 'none' THEN ARRAY['v','mode','closes_variant_ids']
    WHEN 'create' THEN ARRAY['v','mode','when','confirm','start','owner','renewal','light','overdue_cut','closes_variant_ids']
    ELSE ARRAY['v','mode','when','extend','light','overdue_cut','closes_variant_ids'] END;
  v := v || app_servicio.unknown_keys(p, v_allowed);
  IF p ? 'closes_variant_ids' AND jsonb_typeof(p -> 'closes_variant_ids') <> 'null' THEN
    IF jsonb_typeof(p -> 'closes_variant_ids') <> 'array' OR jsonb_array_length(p -> 'closes_variant_ids') > 20
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(p -> 'closes_variant_ids') x WHERE NOT app_servicio.j_uuid(x)) THEN
      v := v || 'las variantes a cerrar no son válidas'::text;
    ELSIF p_variant_id IS NOT NULL AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(p -> 'closes_variant_ids') t(id) WHERE t.id = p_variant_id::text) THEN
      v := v || 'la variante no se cierra a sí misma'::text;
    ELSIF EXISTS (SELECT 1 FROM public.product_variants pv WHERE pv.id = p_variant_id) AND EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(p -> 'closes_variant_ids') t(id)
       WHERE NOT EXISTS (SELECT 1 FROM public.product_variants a JOIN public.product_variants b ON b.workspace_id = a.workspace_id
                          WHERE a.id = p_variant_id AND b.id::text = t.id)) THEN
      v := v || 'las variantes a cerrar tienen que ser de este negocio'::text;
    END IF;
  END IF;
  IF v_mode = 'none' THEN RETURN v; END IF;

  IF p_variant_id IS NOT NULL THEN
    SELECT pv.product_id, pv.workspace_id INTO v_product, v_ws FROM public.product_variants pv WHERE pv.id = p_variant_id;
  END IF;

  v_when := p -> 'when';
  IF v_when IS NULL OR jsonb_typeof(v_when) <> 'object' OR NOT COALESCE(v_when ->> 'rule' = ANY (ARRAY['any_payment','non_reservation','percent','amount']), false) THEN
    v := v || 'elegí cuándo se crea'::text;
  ELSIF v_when ->> 'rule' = 'percent' AND NOT (app_servicio.j_int(v_when -> 'value') AND app_servicio.j_num(v_when -> 'value') BETWEEN 1 AND 100) THEN
    v := v || 'el porcentaje va de 1 a 100'::text;
  ELSIF v_when ->> 'rule' = 'amount' AND NOT (app_servicio.j_int(v_when -> 'value') AND app_servicio.j_num(v_when -> 'value') >= 1) THEN
    v := v || 'el monto tiene que ser mayor a cero'::text;
  END IF;

  IF p ? 'light' THEN
    v_x := p -> 'light';
    IF jsonb_typeof(v_x) <> 'object' OR (v_x ? 'overdue_red_days' AND NOT (app_servicio.j_int(v_x -> 'overdue_red_days') AND app_servicio.j_num(v_x -> 'overdue_red_days') BETWEEN 1 AND 365)) THEN
      v := v || 'los días para rojo por pagos van de 1 a 365'::text;
    END IF;
  END IF;
  IF p ? 'overdue_cut' THEN
    v_x := p -> 'overdue_cut';
    IF jsonb_typeof(v_x) <> 'object' OR (v_x ? 'days' AND NOT (app_servicio.j_int(v_x -> 'days') AND app_servicio.j_num(v_x -> 'days') BETWEEN 1 AND 365)) THEN
      v := v || 'los días de mora van de 1 a 365'::text;
    END IF;
  END IF;

  IF v_mode = 'create' THEN
    IF p ? 'confirm' AND jsonb_typeof(p -> 'confirm') <> 'boolean' THEN v := v || '«Pedir confirmación» tiene que ser sí o no'::text; END IF;
    IF p ? 'start' AND NOT COALESCE(p ->> 'start' = ANY (ARRAY['payment_date','sale_date','manual']), false) THEN v := v || 'elegí la fecha de inicio'::text; END IF;
    IF p ? 'renewal' AND NOT COALESCE(p ->> 'renewal' = ANY (ARRAY['new_linked','extend','ask']), false) THEN v := v || 'elegí qué pasa si vuelve a comprar'::text; END IF;
    v_owner := p -> 'owner';
    IF v_owner IS NULL OR jsonb_typeof(v_owner) <> 'object' OR NOT COALESCE(v_owner ->> 'mode' = ANY (ARRAY['fixed','round_robin','conditions','previous']), false) THEN
      v := v || 'elegí cómo se asigna el responsable'::text;
    ELSE
      IF v_owner ->> 'mode' = 'fixed' AND NOT app_servicio.j_uuid(v_owner -> 'user_id') THEN v := v || 'elegí la persona'::text; END IF;
      IF v_owner ->> 'mode' = 'round_robin' AND NOT (jsonb_typeof(v_owner -> 'members') = 'array' AND jsonb_array_length(v_owner -> 'members') > 0) THEN
        v := v || 'elegí las personas del reparto'::text;
      END IF;
      IF v_owner ->> 'mode' = 'conditions' AND NOT (jsonb_typeof(v_owner -> 'conditions') = 'array' AND jsonb_array_length(v_owner -> 'conditions') > 0) THEN
        v := v || 'agregá al menos una condición'::text;
      END IF;
      IF NOT app_servicio.j_uuid(v_owner -> 'fallback_user_id') THEN v := v || 'elegí la persona de respaldo'::text; END IF;
      IF v_ws IS NOT NULL AND EXISTS (
        SELECT 1 FROM (
          SELECT x #>> '{}' AS uid FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_owner -> 'members') = 'array' THEN v_owner -> 'members' ELSE '[]'::jsonb END) x
          UNION ALL SELECT v_owner ->> 'user_id' WHERE jsonb_typeof(v_owner -> 'user_id') = 'string'
          UNION ALL SELECT v_owner ->> 'fallback_user_id' WHERE jsonb_typeof(v_owner -> 'fallback_user_id') = 'string'
        ) people
        WHERE NOT EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.workspace_id = v_ws AND m.user_id::text = people.uid)
      ) THEN
        v := v || 'hay una persona que no es del equipo'::text;
      END IF;
    END IF;
  END IF;

  IF v_mode = 'extend' THEN
    v_ext := p -> 'extend';
    IF v_ext IS NULL OR jsonb_typeof(v_ext) <> 'object' THEN
      v := v || 'elegí cuánto suma'::text;
      v := v || 'elegí la variante de respaldo'::text;
    ELSE
      IF NOT (app_servicio.j_int(v_ext -> 'n') AND app_servicio.j_num(v_ext -> 'n') BETWEEN 1 AND 1000) THEN v := v || 'elegí cuánto suma'::text; END IF;
      IF v_ext ? 'unit' AND NOT COALESCE(v_ext ->> 'unit' = ANY (ARRAY['days','weeks','months']), false) THEN v := v || 'elegí días, semanas o meses'::text; END IF;
      IF v_ext ? 'if_no_service' AND NOT COALESCE(v_ext ->> 'if_no_service' = ANY (ARRAY['confirm','create']), false) THEN
        v := v || 'elegí qué pasa si no tiene un servicio para extender'::text;
      END IF;
      IF v_ext ? 'target_variant_ids' AND jsonb_typeof(v_ext -> 'target_variant_ids') <> 'null'
         AND NOT (jsonb_typeof(v_ext -> 'target_variant_ids') = 'array'
                  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_ext -> 'target_variant_ids') x WHERE NOT app_servicio.j_uuid(x))) THEN
        v := v || 'las variantes a extender no son válidas'::text;
      END IF;
      IF NOT app_servicio.j_uuid(v_ext -> 'fallback_variant_id') THEN
        v := v || 'elegí la variante de respaldo'::text;
      ELSIF v_product IS NOT NULL THEN
        SELECT pv.product_id, COALESCE(pv.service_settings ->> 'mode', 'none') INTO v_fb_product, v_fb_mode
          FROM public.product_variants pv WHERE pv.id = (v_ext ->> 'fallback_variant_id')::uuid;
        IF v_fb_product IS DISTINCT FROM v_product THEN v := v || 'la variante de respaldo tiene que ser de este producto'::text;
        ELSIF v_fb_mode <> 'create' THEN v := v || 'la variante de respaldo tiene que crear un servicio'::text;
        END IF;
      END IF;
      IF v_product IS NOT NULL AND jsonb_typeof(v_ext -> 'target_variant_ids') = 'array' AND EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(v_ext -> 'target_variant_ids') t(id)
        WHERE NOT EXISTS (SELECT 1 FROM public.product_variants pv WHERE pv.id::text = t.id AND pv.product_id = v_product)
      ) THEN
        v := v || 'las variantes a extender tienen que ser de este producto'::text;
      END IF;
    END IF;
  END IF;
  RETURN v;
END;
$function$;

-- ─── 9. Permisos de ejecución ────────────────────────────────────────────────
REVOKE ALL ON FUNCTION
  app_servicio.community_list_plan(jsonb), app_servicio.community_list(uuid), app_servicio.community_main_key(uuid), app_servicio.community_count(uuid),
  app_servicio.community_spaces_of(uuid, text), app_servicio.community_of_variant(uuid), app_servicio.contact_communities(uuid, uuid),
  app_servicio.contact_current_community(uuid, uuid), app_servicio.community_member(uuid, uuid, text),
  app_servicio.community_can_post_check_in(uuid, uuid, text, text, uuid), app_servicio.svc_close_on_upgrade(uuid),
  app_servicio.live_date_visible(uuid[], uuid[], uuid), app_servicio.community_settings_problems(jsonb, uuid),
  app_servicio_portal.portal_community_choose(text, uuid, text), app_servicio.points_ranking(uuid, integer, text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  app_servicio.community_list_plan(jsonb), app_servicio.community_list(uuid), app_servicio.community_main_key(uuid), app_servicio.community_count(uuid),
  app_servicio.community_spaces_of(uuid, text), app_servicio.community_of_variant(uuid), app_servicio.contact_communities(uuid, uuid),
  app_servicio.contact_current_community(uuid, uuid), app_servicio.community_member(uuid, uuid, text),
  app_servicio.community_can_post_check_in(uuid, uuid, text, text, uuid), app_servicio.svc_close_on_upgrade(uuid),
  app_servicio.live_date_visible(uuid[], uuid[], uuid), app_servicio.community_settings_problems(jsonb, uuid),
  app_servicio_portal.portal_community_choose(text, uuid, text), app_servicio.points_ranking(uuid, integer, text)
TO service_role;
GRANT EXECUTE ON FUNCTION app_servicio_portal.portal_community_choose(text, uuid, text) TO portal_app;
-- Como antes (00380): el equipo lee el ranking con su sesión (la función pide portal.points o portal.view).
GRANT EXECUTE ON FUNCTION app_servicio.points_ranking(uuid, integer, text) TO authenticated;
