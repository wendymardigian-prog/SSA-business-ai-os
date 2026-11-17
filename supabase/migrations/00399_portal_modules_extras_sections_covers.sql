-- @plantilla-quitar(servicios)
-- ============================================================================
-- 00399_portal_modules_extras_sections_covers  (Portal: módulos numerados, Extras, submódulos y portadas)
-- ============================================================================
-- Lo que el portal necesita para mostrar bien el Contenido (17/11/2026):
--
-- 1. `program_items.is_extra`: el módulo va en la sección «Extras» del portal (sin número, fuera del avance). Se
--    marca desde el editor (`program_update_item` acepta `is_extra`; solo en módulos).
-- 2. `module_row` (lo que devuelven `portal_program` y `portal_module`) suma:
--      `number`     el número del módulo (1, 2, 3…) contando los módulos no extra y no archivados del programa,
--                   por posición. Es el mismo para todos: no cambia si a alguien le falta uno (inactivo, variante).
--                   NULL en un extra.
--      `extra`      si va en Extras.
--      `has_cover`  si tiene imagen de portada. La imagen se pide con `portal_file_grant(kind 'module_cover')`.
--    Deja de mandar `cover_path`: el portal nunca ve una ruta de Storage.
--    `items` ahora trae también las clases de los submódulos, en orden, cada una con `section` {id, title}
--    (las directas del módulo, sin `section`). Antes solo venían los hijos directos, y el portal descartaba los
--    submódulos: sus clases no se veían.
-- 3. `portal_lesson`: `module` es siempre el módulo de arriba; suma `section` si la clase está en un submódulo;
--    anterior y siguiente recorren el módulo entero (submódulos incluidos), en el mismo orden que `items`.
-- 4. `portal_file_grant`: kinds nuevos `module_cover` (item = el módulo) y `thumbnail` (item = una clase), con las
--    mismas reglas de visibilidad que el contenido.
--
-- Aditiva (una columna con default y funciones reemplazadas). Volver atrás: correr de nuevo las definiciones de
-- 00387 (module_row, portal_lesson), 00389 (portal_file_grant) y 00382 (program_update_item), y
-- ALTER TABLE app_servicio.program_items DROP COLUMN is_extra;
-- ============================================================================

-- ─── 1. Extras ──────────────────────────────────────────────────────────────
ALTER TABLE app_servicio.program_items ADD COLUMN IF NOT EXISTS is_extra boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN app_servicio.program_items.is_extra IS
  'Portal (00399): el módulo va en la sección Extras (sin número y fuera del avance). Solo tiene sentido en módulos.';

CREATE OR REPLACE FUNCTION app_servicio.program_update_item(p_item_id uuid, p jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  it record;
  v_points jsonb;
  k text;
BEGIN
  SELECT id, workspace_id, product_id INTO it FROM app_servicio.program_items WHERE id = p_item_id FOR UPDATE;
  IF it.id IS NULL THEN RAISE EXCEPTION 'No existe' USING ERRCODE = 'PR002'; END IF;
  PERFORM app_servicio.program_require(it.workspace_id, 'program.manage');
  IF p ? 'form_id' AND NULLIF(p ->> 'form_id', '') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.forms f WHERE f.id = (p ->> 'form_id')::uuid AND f.workspace_id = it.workspace_id) THEN
    RAISE EXCEPTION 'Ese formulario no es de este negocio' USING ERRCODE = 'PR002';
  END IF;
  IF p ? 'source_call_id' AND NULLIF(p ->> 'source_call_id', '') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.calls c WHERE c.id = (p ->> 'source_call_id')::uuid AND c.workspace_id = it.workspace_id) THEN
    RAISE EXCEPTION 'Esa grabación no es de este negocio' USING ERRCODE = 'PR002';
  END IF;
  IF p ? 'is_extra' AND jsonb_typeof(p -> 'is_extra') <> 'boolean' THEN
    RAISE EXCEPTION '«Extra» no es válido' USING ERRCODE = 'PR001';
  END IF;
  IF p ? 'points' THEN
    v_points := CASE WHEN jsonb_typeof(p -> 'points') = 'object' THEN jsonb_strip_nulls(p -> 'points') END;
    IF p -> 'points' IS NOT NULL AND jsonb_typeof(p -> 'points') NOT IN ('object', 'null') THEN
      RAISE EXCEPTION 'Los puntos no son válidos' USING ERRCODE = 'PR001';
    END IF;
    IF v_points IS NOT NULL THEN
      FOR k IN SELECT jsonb_object_keys(v_points) LOOP
        IF k NOT IN ('submit', 'pass') OR (CASE WHEN app_servicio.j_int(v_points -> k) THEN (v_points ->> k)::numeric BETWEEN 0 AND 10000 END) IS NOT TRUE THEN
          RAISE EXCEPTION 'Los puntos al entregar y al aprobar van de 0 a 10.000' USING ERRCODE = 'PR001';
        END IF;
      END LOOP;
      IF v_points = '{}'::jsonb THEN v_points := NULL; END IF;
    END IF;
  END IF;
  UPDATE app_servicio.program_items SET
    title = CASE WHEN p ? 'title' THEN btrim(p ->> 'title') ELSE title END,
    description = CASE WHEN p ? 'description' THEN NULLIF(p ->> 'description', '') ELSE description END,
    lesson_type = CASE WHEN p ? 'lesson_type' AND kind = 'lesson' THEN p ->> 'lesson_type' ELSE lesson_type END,
    video_url = CASE WHEN p ? 'video_url' THEN NULLIF(p ->> 'video_url', '') ELSE video_url END,
    video_embed_url = CASE WHEN p ? 'video_embed_url' THEN NULLIF(p ->> 'video_embed_url', '') ELSE video_embed_url END,
    duration_seconds = CASE WHEN p ? 'duration_seconds' THEN NULLIF(p ->> 'duration_seconds', '')::integer ELSE duration_seconds END,
    html_content = CASE WHEN p ? 'html_content' THEN NULLIF(p ->> 'html_content', '') ELSE html_content END,
    document_path = CASE WHEN p ? 'document_path' THEN NULLIF(p ->> 'document_path', '') ELSE document_path END,
    form_id = CASE WHEN p ? 'form_id' THEN NULLIF(p ->> 'form_id', '')::uuid ELSE form_id END,
    resources = CASE WHEN p ? 'resources' THEN p -> 'resources' ELSE resources END,
    cover_path = CASE WHEN p ? 'cover_path' THEN NULLIF(p ->> 'cover_path', '') ELSE cover_path END,
    thumbnail_path = CASE WHEN p ? 'thumbnail_path' THEN NULLIF(p ->> 'thumbnail_path', '') ELSE thumbnail_path END,
    thumbnail_url = CASE WHEN p ? 'thumbnail_url' THEN NULLIF(p ->> 'thumbnail_url', '') ELSE thumbnail_url END,
    comments_enabled = CASE WHEN p ? 'comments_enabled' THEN (p ->> 'comments_enabled')::boolean ELSE comments_enabled END,
    unlock_rule = CASE WHEN p ? 'unlock_rule' THEN p -> 'unlock_rule' ELSE unlock_rule END,
    required = CASE WHEN p ? 'required' THEN (p ->> 'required')::boolean ELSE required END,
    source_call_id = CASE WHEN p ? 'source_call_id' THEN NULLIF(p ->> 'source_call_id', '')::uuid ELSE source_call_id END,
    points = CASE WHEN p ? 'points' THEN v_points ELSE points END,
    is_extra = CASE WHEN p ? 'is_extra' AND kind = 'module' THEN (p ->> 'is_extra')::boolean ELSE is_extra END
  WHERE id = it.id;
  PERFORM app_servicio.audit(it.workspace_id, 'product', it.product_id, 'program.item_updated',
    jsonb_build_object('item_id', it.id, 'keys', (SELECT jsonb_agg(k2) FROM jsonb_object_keys(p) k2)));
END;
$$;

-- ─── 2. El módulo para el portal ────────────────────────────────────────────
-- Las clases activas de un módulo en el orden del portal: las directas y las de cada submódulo activo, por la
-- posición de su lugar en el módulo y después por la suya. `section_id` es el submódulo (NULL si es directa).
CREATE OR REPLACE FUNCTION app_servicio_portal.module_lessons(p_module_id uuid)
RETURNS TABLE (item_id uuid, section_id uuid, ord integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT x.id, x.section_id, (row_number() OVER (ORDER BY x.p1, x.p2, x.id))::integer
    FROM (
      SELECT c.id, NULL::uuid AS section_id, c.position AS p1, -1 AS p2
        FROM app_servicio.program_items c
       WHERE c.parent_id = p_module_id AND c.kind = 'lesson' AND c.status = 'active'
      UNION ALL
      SELECT l.id, s.id, s.position, l.position
        FROM app_servicio.program_items s
        JOIN app_servicio.program_items l ON l.parent_id = s.id AND l.kind = 'lesson' AND l.status = 'active'
       WHERE s.parent_id = p_module_id AND s.kind = 'submodule' AND s.status = 'active'
    ) x;
$$;
REVOKE ALL ON FUNCTION app_servicio_portal.module_lessons(uuid) FROM PUBLIC, anon, authenticated, portal_app;

CREATE OR REPLACE FUNCTION app_servicio_portal.module_row(p_contact uuid, m app_servicio.program_items)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  u jsonb := app_servicio.program_item_unlocked(p_contact, m.id);
  v_number integer;
BEGIN
  IF NOT COALESCE((u ->> 'visible')::boolean, false) THEN RETURN NULL; END IF;
  IF m.kind = 'module' AND NOT m.is_extra THEN
    SELECT count(*) INTO v_number FROM app_servicio.program_items o
     WHERE o.product_id = m.product_id AND o.kind = 'module' AND o.parent_id IS NULL AND o.status <> 'archived' AND NOT o.is_extra
       AND (o.position, o.id) <= (m.position, m.id);
  END IF;
  RETURN jsonb_build_object('id', m.id, 'title', m.title, 'description', m.description,
    'number', v_number, 'extra', m.is_extra, 'has_cover', m.cover_path IS NOT NULL, 'thumbnail_url', m.thumbnail_url,
    'unlocked', COALESCE((u ->> 'unlocked')::boolean, false), 'display', u ->> 'display', 'reason', u ->> 'reason', 'opens_on', u ->> 'opensOn',
    'items', CASE WHEN COALESCE((u ->> 'unlocked')::boolean, false) THEN COALESCE((
      SELECT jsonb_agg(r ORDER BY ord) FROM (
        SELECT app_servicio_portal.lesson_row(p_contact, c)
                 || CASE WHEN ml.section_id IS NOT NULL THEN jsonb_build_object('section', jsonb_build_object('id', s.id, 'title', s.title)) ELSE '{}'::jsonb END r,
               ml.ord
          FROM app_servicio_portal.module_lessons(m.id) ml
          JOIN app_servicio.program_items c ON c.id = ml.item_id
          LEFT JOIN app_servicio.program_items s ON s.id = ml.section_id) x WHERE r IS NOT NULL), '[]'::jsonb) ELSE '[]'::jsonb END);
END;
$$;

-- ─── 3. La clase ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_servicio_portal.portal_lesson(p_session text, p_item_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  i app_servicio.program_items;
  m app_servicio.program_items;
  sec app_servicio.program_items;
  pf jsonb;
  u jsonb;
  v_contact uuid;
  v_sib uuid[];
  v_idx integer;
  pp app_servicio_portal.program_progress;
BEGIN
  SELECT * INTO i FROM app_servicio.program_items WHERE id = p_item_id AND kind = 'lesson';
  IF i.id IS NULL THEN PERFORM app_servicio_portal.err('PO404', 'Esta clase no existe'); END IF;
  pf := app_servicio_portal.require_section(sess, i.product_id, 'program');
  v_contact := (pf ->> 'contact_id')::uuid;
  IF i.status <> 'active' THEN PERFORM app_servicio_portal.err('PO410', 'Esta clase ya no está disponible'); END IF;
  u := app_servicio.program_item_unlocked(v_contact, i.id);
  IF NOT COALESCE((u ->> 'visible')::boolean, false) THEN PERFORM app_servicio_portal.err('PO404', 'Esta clase no existe'); END IF;
  IF NOT COALESCE((u ->> 'unlocked')::boolean, false) THEN PERFORM app_servicio_portal.err('PO403', COALESCE(u ->> 'reason', 'Esta clase todavía no está abierta')); END IF;
  SELECT * INTO m FROM app_servicio.program_items WHERE id = i.parent_id;
  IF m.kind = 'submodule' THEN
    sec := m;
    SELECT * INTO m FROM app_servicio.program_items WHERE id = sec.parent_id;
  END IF;
  SELECT array_agg(ml.item_id ORDER BY ml.ord) INTO v_sib FROM app_servicio_portal.module_lessons(m.id) ml;
  v_idx := array_position(v_sib, i.id);
  SELECT * INTO pp FROM app_servicio_portal.program_progress WHERE contact_id = v_contact AND program_item_id = i.id ORDER BY updated_at DESC LIMIT 1;
  RETURN jsonb_build_object(
    'id', i.id, 'title', i.title, 'description', i.description, 'lesson_type', i.lesson_type, 'duration_seconds', i.duration_seconds,
    'module', jsonb_build_object('id', m.id, 'title', m.title),
    'section', CASE WHEN sec.id IS NOT NULL THEN jsonb_build_object('id', sec.id, 'title', sec.title) END,
    'video_embed_url', i.video_embed_url, 'video_url', i.video_url, 'thumbnail_url', i.thumbnail_url,
    'fathom', CASE WHEN i.source_call_id IS NOT NULL AND i.video_embed_url IS NULL THEN jsonb_build_object('url', (SELECT c.share_url FROM public.calls c WHERE c.id = i.source_call_id)) END,
    'html', CASE WHEN i.lesson_type = 'html' THEN i.html_content END,
    'has_document', i.document_path IS NOT NULL,
    'resources', COALESCE((SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', r ->> 'id', 'name', COALESCE(r ->> 'name', r ->> 'title'),
                     'kind', CASE WHEN r ? 'url' AND NOT r ? 'path' THEN 'link' ELSE 'file' END, 'url', CASE WHEN NOT r ? 'path' THEN r ->> 'url' END)))
                   FROM jsonb_array_elements(COALESCE(i.resources, '[]'::jsonb)) r), '[]'::jsonb),
    'comments_enabled', i.comments_enabled,
    'viewed', pp.viewed_at IS NOT NULL, 'completed', pp.completed_at IS NOT NULL, 'position_seconds', pp.last_position_seconds,
    'prev_id', CASE WHEN v_idx > 1 THEN v_sib[v_idx - 1] END, 'next_id', CASE WHEN v_idx < cardinality(v_sib) THEN v_sib[v_idx + 1] END);
END;
$$;

-- ─── 4. Portadas y miniaturas ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_servicio.portal_file_grant(p_session text, p_kind text, p_item_id uuid DEFAULT NULL, p_ref text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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
    IF NOT COALESCE((app_servicio.program_item_unlocked((pf ->> 'contact_id')::uuid, i.id) ->> 'visible')::boolean, false) THEN
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
$$;
GRANT EXECUTE ON FUNCTION app_servicio.portal_file_grant(text, text, uuid, text) TO service_role;
