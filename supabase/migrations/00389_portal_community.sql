-- @plantilla-quitar(servicios)
-- ============================================================================
-- 00389_portal_community  (Portal de estudiantes, Corrida B2 · P08)
-- ============================================================================
-- La comunidad del portal (F228, F229, F220): sobre las tablas y reglas de la Corrida A (00351).
--   portal_spaces(session, product_id)                          los espacios del programa (y cuáles son solo del equipo).
--   portal_feed(session, product_id, space, before)            20 publicaciones (las fijadas primero), con sus respuestas
--                                                               (un nivel) y reacciones. De los demás, solo el nombre: ni
--                                                               email ni datos de contacto. Lo oculto por moderación no viene.
--   portal_lesson_comments(session, item_id)                   lo mismo, del espacio Clases de esa clase.
--   portal_post_create(session, product_id, space, body, parent_id, program_item_id, media)   con
--                                                               `community_can_post_check` (acceso, silenciado, espacio).
--   portal_post_edit / portal_post_delete                      solo lo propio.
--   portal_react(session, post_id, kind)                       pone o saca like · fire · clap.
--   portal_report(session, post_id, reason)                    una vez por persona y publicación.
--   app_servicio.portal_file_grant                             suma subir una foto a la comunidad y ver las fotos de un
--                                                               post del programa de la persona (el resto, igual que la 00387).
--
-- La vista previa no escribe (PO403). Aditiva (portal_file_grant se redefine con lo de antes intacto).
--
-- Volver atrás: DROP de las funciones nuevas y volver a crear portal_file_grant como en la 00387.
-- ============================================================================

-- El nombre que ve otro estudiante: nombre y la inicial del apellido.
CREATE OR REPLACE FUNCTION app_servicio_portal.public_name(p_name text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  -- Un nombre sin letras (un teléfono o un número cargado como nombre) nunca se muestra.
  SELECT CASE WHEN NULLIF(btrim(p_name), '') IS NULL OR p_name !~ '[[:alpha:]]' THEN 'Estudiante'
              WHEN position(' ' IN btrim(p_name)) = 0 THEN btrim(p_name)
              ELSE split_part(btrim(p_name), ' ', 1) || ' ' || left(split_part(btrim(p_name), ' ', 2), 1) || '.' END;
$$;

CREATE OR REPLACE FUNCTION app_servicio_portal.post_row(p_me uuid, t app_servicio_portal.community_posts)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'id', t.id, 'space', t.space_key, 'program_item_id', t.program_item_id, 'body', t.body, 'media_count', jsonb_array_length(t.media),
    'author', CASE WHEN t.as_business OR t.author_user_id IS NOT NULL THEN jsonb_build_object('name', 'Equipo', 'team', true)
                   ELSE jsonb_build_object('name', app_servicio_portal.public_name((SELECT COALESCE(a.display_name, c.display_name) FROM public.contacts c
                          LEFT JOIN app_servicio_portal.portal_accounts a ON a.contact_id = c.id WHERE c.id = t.author_contact_id LIMIT 1)), 'team', false,
                                           'contact_ref', md5(t.author_contact_id::text)) END,
    'mine', t.author_contact_id = p_me, 'pinned', t.pinned_at IS NOT NULL, 'created_at', t.created_at, 'edited_at', t.edited_at,
    'reactions', COALESCE((SELECT jsonb_object_agg(k.kind, k.n) FROM (SELECT kind, count(*)::int n FROM app_servicio_portal.community_reactions
                            WHERE post_id = t.id AND kind <> 'report' GROUP BY kind) k), '{}'::jsonb),
    'my_reactions', COALESCE((SELECT jsonb_agg(r.kind) FROM app_servicio_portal.community_reactions r WHERE r.post_id = t.id AND r.contact_id = p_me AND r.kind <> 'report'), '[]'::jsonb),
    'replies', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                  'id', x.id, 'body', x.body, 'created_at', x.created_at, 'mine', x.author_contact_id = p_me,
                  'author', CASE WHEN x.as_business OR x.author_user_id IS NOT NULL THEN jsonb_build_object('name', 'Equipo', 'team', true)
                                 ELSE jsonb_build_object('name', app_servicio_portal.public_name((SELECT c.display_name FROM public.contacts c WHERE c.id = x.author_contact_id)), 'team', false) END)
                  ORDER BY x.created_at)
                FROM app_servicio_portal.community_posts x
               WHERE x.parent_id = t.id AND x.deleted_at IS NULL AND (x.hidden_at IS NULL OR x.author_contact_id = p_me)), '[]'::jsonb));
$$;

CREATE OR REPLACE FUNCTION app_servicio_portal.portal_spaces(p_session text, p_product_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
BEGIN
  PERFORM app_servicio_portal.require_section(sess, p_product_id, 'community');
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('key', s ->> 'key', 'name', s ->> 'name', 'team_only', COALESCE((s ->> 'team_only')::boolean, false)))
                     FROM jsonb_array_elements(COALESCE(app_servicio.community_spaces(p_product_id), '[]'::jsonb)) s
                    WHERE NOT COALESCE((s ->> 'archived')::boolean, false)), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio_portal.portal_feed(p_session text, p_product_id uuid, p_space text DEFAULT NULL, p_before timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  pf jsonb := app_servicio_portal.require_section(sess, p_product_id, 'community');
  v_me uuid := (pf ->> 'contact_id')::uuid;
  v_rows jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(app_servicio_portal.post_row(v_me, t) ORDER BY t.pinned_at DESC NULLS LAST, t.created_at DESC), '[]'::jsonb) INTO v_rows FROM (
    SELECT * FROM app_servicio_portal.community_posts t
     WHERE t.product_id = p_product_id AND t.parent_id IS NULL AND t.deleted_at IS NULL AND t.space_key <> 'clases'
       AND (t.hidden_at IS NULL OR t.author_contact_id = v_me)
       AND (NULLIF(p_space, '') IS NULL OR t.space_key = p_space)
       AND (p_before IS NULL OR t.created_at < p_before)
     ORDER BY t.pinned_at DESC NULLS LAST, t.created_at DESC LIMIT 20) t;
  RETURN jsonb_build_object('posts', v_rows,
    'next', CASE WHEN jsonb_array_length(v_rows) = 20 THEN v_rows -> 19 ->> 'created_at' END,
    'can_post', app_servicio.community_can_post_check(v_me, p_product_id, COALESCE(NULLIF(p_space, ''), 'general'), NULL));
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio_portal.portal_lesson_comments(p_session text, p_item_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  i app_servicio.program_items;
  pf jsonb;
  v_me uuid;
BEGIN
  SELECT * INTO i FROM app_servicio.program_items WHERE id = p_item_id AND kind = 'lesson';
  IF i.id IS NULL THEN PERFORM app_servicio_portal.err('PO404', 'Esta clase no existe'); END IF;
  pf := app_servicio_portal.require_section(sess, i.product_id, 'program');
  v_me := (pf ->> 'contact_id')::uuid;
  RETURN jsonb_build_object(
    'can_post', app_servicio.community_can_post_check(v_me, i.product_id, 'clases', i.id),
    'posts', COALESCE((SELECT jsonb_agg(app_servicio_portal.post_row(v_me, t) ORDER BY t.created_at DESC)
                         FROM app_servicio_portal.community_posts t
                        WHERE t.program_item_id = i.id AND t.parent_id IS NULL AND t.deleted_at IS NULL AND (t.hidden_at IS NULL OR t.author_contact_id = v_me)), '[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio_portal.portal_post_create(p_session text, p_product_id uuid, p_space text, p_body text, p_parent_id uuid DEFAULT NULL,
                                                                  p_program_item_id uuid DEFAULT NULL, p_media jsonb DEFAULT '[]'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  pf jsonb;
  par app_servicio_portal.community_posts;
  v_space text := COALESCE(NULLIF(p_space, ''), 'general');
  v_item uuid := p_program_item_id;
  v_check jsonb;
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
  IF btrim(COALESCE(p_body, '')) = '' OR char_length(p_body) > 10000 THEN PERFORM app_servicio_portal.err('PO400', 'Escribí algo (hasta 10.000 caracteres)'); END IF;
  IF p_media IS NOT NULL AND (jsonb_typeof(p_media) <> 'array' OR jsonb_array_length(p_media) > 10
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_media) m WHERE jsonb_typeof(m) <> 'object' OR NOT ((m ->> 'path') LIKE (pf ->> 'workspace_id') || '/' || p_product_id::text || '/' || (pf ->> 'contact_id') || '/%'))) THEN
    PERFORM app_servicio_portal.err('PO400', 'Las fotos no son válidas');
  END IF;
  v_check := app_servicio.community_can_post_check((pf ->> 'contact_id')::uuid, p_product_id, v_space, v_item);
  IF NOT COALESCE((v_check ->> 'ok')::boolean, false) THEN PERFORM app_servicio_portal.err('PO403', COALESCE(v_check ->> 'reason', 'No podés publicar acá')); END IF;
  INSERT INTO app_servicio_portal.community_posts (workspace_id, product_id, space_key, parent_id, program_item_id, author_contact_id, body, media)
  VALUES ((pf ->> 'workspace_id')::uuid, p_product_id, v_space, p_parent_id, v_item, (pf ->> 'contact_id')::uuid, btrim(p_body), COALESCE(p_media, '[]'::jsonb))
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio_portal.own_post(p_sess jsonb, p_post_id uuid)
RETURNS app_servicio_portal.community_posts LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  t app_servicio_portal.community_posts;
BEGIN
  SELECT * INTO t FROM app_servicio_portal.community_posts WHERE id = p_post_id AND deleted_at IS NULL;
  IF t.id IS NULL OR t.author_contact_id IS DISTINCT FROM (p_sess ->> 'contact_id')::uuid THEN PERFORM app_servicio_portal.err('PO404', 'Esa publicación no es tuya'); END IF;
  RETURN t;
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio_portal.portal_post_edit(p_session text, p_post_id uuid, p_body text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  t app_servicio_portal.community_posts;
BEGIN
  PERFORM app_servicio_portal.require_write(sess);
  t := app_servicio_portal.own_post(sess, p_post_id);
  IF btrim(COALESCE(p_body, '')) = '' OR char_length(p_body) > 10000 THEN PERFORM app_servicio_portal.err('PO400', 'Escribí algo (hasta 10.000 caracteres)'); END IF;
  UPDATE app_servicio_portal.community_posts SET body = btrim(p_body), edited_at = now() WHERE id = t.id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio_portal.portal_post_delete(p_session text, p_post_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  t app_servicio_portal.community_posts;
BEGIN
  PERFORM app_servicio_portal.require_write(sess);
  t := app_servicio_portal.own_post(sess, p_post_id);
  UPDATE app_servicio_portal.community_posts SET deleted_at = now() WHERE id = t.id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Una publicación del programa de la persona, visible para ella.
CREATE OR REPLACE FUNCTION app_servicio_portal.visible_post(p_sess jsonb, p_post_id uuid)
RETURNS app_servicio_portal.community_posts LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  t app_servicio_portal.community_posts;
BEGIN
  SELECT * INTO t FROM app_servicio_portal.community_posts WHERE id = p_post_id AND deleted_at IS NULL AND hidden_at IS NULL;
  IF t.id IS NULL THEN PERFORM app_servicio_portal.err('PO404', 'Esa publicación ya no está'); END IF;
  PERFORM app_servicio_portal.require_section(p_sess, t.product_id, CASE WHEN t.space_key = 'clases' THEN 'program' ELSE 'community' END);
  RETURN t;
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio_portal.portal_react(p_session text, p_post_id uuid, p_kind text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  t app_servicio_portal.community_posts;
  v_me uuid := (sess ->> 'contact_id')::uuid;
  v_id uuid;
BEGIN
  PERFORM app_servicio_portal.require_write(sess);
  IF p_kind IS NULL OR p_kind NOT IN ('like', 'fire', 'clap') THEN PERFORM app_servicio_portal.err('PO400', 'Esa reacción no existe'); END IF;
  t := app_servicio_portal.visible_post(sess, p_post_id);
  PERFORM pg_advisory_xact_lock(hashtextextended('portal-react:' || v_me::text || ':' || t.id::text || ':' || p_kind, 0));
  SELECT id INTO v_id FROM app_servicio_portal.community_reactions WHERE post_id = t.id AND contact_id = v_me AND kind = p_kind LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO app_servicio_portal.community_reactions (workspace_id, post_id, contact_id, kind) VALUES (t.workspace_id, t.id, v_me, p_kind);
    RETURN jsonb_build_object('ok', true, 'on', true);
  END IF;
  DELETE FROM app_servicio_portal.community_reactions WHERE id = v_id;
  RETURN jsonb_build_object('ok', true, 'on', false);
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio_portal.portal_report(p_session text, p_post_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  t app_servicio_portal.community_posts;
  v_me uuid := (sess ->> 'contact_id')::uuid;
BEGIN
  PERFORM app_servicio_portal.require_write(sess);
  t := app_servicio_portal.visible_post(sess, p_post_id);
  IF t.author_contact_id = v_me THEN PERFORM app_servicio_portal.err('PO400', 'No podés reportar lo tuyo'); END IF;
  IF NOT EXISTS (SELECT 1 FROM app_servicio_portal.community_reactions WHERE post_id = t.id AND contact_id = v_me AND kind = 'report') THEN
    INSERT INTO app_servicio_portal.community_reactions (workspace_id, post_id, contact_id, kind, report_reason)
    VALUES (t.workspace_id, t.id, v_me, 'report', left(NULLIF(btrim(p_reason), ''), 500));
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- portal_file_grant: lo de la 00387 + community_upload (p_item = el programa, p_ref = la extensión) y community_media
-- (p_item = la publicación, p_ref = el número de foto).
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

REVOKE ALL ON FUNCTION app_servicio_portal.public_name(text), app_servicio_portal.post_row(uuid, app_servicio_portal.community_posts),
  app_servicio_portal.portal_spaces(text, uuid), app_servicio_portal.portal_feed(text, uuid, text, timestamptz),
  app_servicio_portal.portal_lesson_comments(text, uuid), app_servicio_portal.portal_post_create(text, uuid, text, text, uuid, uuid, jsonb),
  app_servicio_portal.own_post(jsonb, uuid), app_servicio_portal.portal_post_edit(text, uuid, text), app_servicio_portal.portal_post_delete(text, uuid),
  app_servicio_portal.visible_post(jsonb, uuid), app_servicio_portal.portal_react(text, uuid, text), app_servicio_portal.portal_report(text, uuid, text),
  app_servicio.portal_file_grant(text, text, uuid, text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_servicio_portal.portal_spaces(text, uuid), app_servicio_portal.portal_feed(text, uuid, text, timestamptz),
  app_servicio_portal.portal_lesson_comments(text, uuid), app_servicio_portal.portal_post_create(text, uuid, text, text, uuid, uuid, jsonb),
  app_servicio_portal.portal_post_edit(text, uuid, text), app_servicio_portal.portal_post_delete(text, uuid),
  app_servicio_portal.portal_react(text, uuid, text), app_servicio_portal.portal_report(text, uuid, text)
TO portal_app, service_role;
GRANT EXECUTE ON FUNCTION app_servicio.portal_file_grant(text, text, uuid, text) TO service_role;
