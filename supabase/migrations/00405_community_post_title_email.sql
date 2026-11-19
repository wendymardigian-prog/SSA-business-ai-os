-- @plantilla-quitar(servicios)
-- 00405 · Comunidad: título en cada post del equipo y aviso por correo a los estudiantes
--
-- Decisión de producto (18/11/2026): al publicar en la comunidad desde SSA, el post lleva un título (con emojis) y un interruptor
-- «Avisar por correo a los estudiantes», prendido de entrada. El correo lo arma y lo manda la app (job
-- `community_post_email`, un envío por persona); la base solo guarda el título y dice a quién le toca.
--
--   community_posts.title                      columna nueva (NULL en lo viejo, en las respuestas y en lo del portal).
--   app_servicio.community_team_post            exige título en un post nuevo del equipo (no en una respuesta).
--   app_servicio.community_team_edit            cambia el título (vaciar uno que tenía, no).
--   app_servicio.community_feed                 devuelve `title`.
--   app_servicio_portal.post_row                devuelve `title` (el portal ya lo dibuja: PostCard.tsx).
--   app_servicio.community_email_targets        a quién le llega el correo: cuenta del portal ACTIVA, con email, acceso
--                                               efectivo a la comunidad y miembro de alguna de las comunidades del post.
--                                               Solo service_role.
--   app_servicio.community_post_for_email       lo que el correo necesita del post (y si sigue vivo). Solo service_role.
--
-- Aditiva: va antes o después del código (sin la columna, publicar falla; aplicar ANTES del deploy).
-- Las cuatro funciones se copiaron de la base viva (pg_get_functiondef, 18/11/2026) y cambian solo lo marcado «00405».
--
-- Para volver atrás: las definiciones de abajo y
--   ALTER TABLE app_servicio_portal.community_posts DROP COLUMN title;
--   DROP FUNCTION app_servicio.community_email_targets(uuid, text[]);
--   DROP FUNCTION app_servicio.community_post_for_email(uuid);
--
-- Definiciones anteriores:
--   CREATE OR REPLACE FUNCTION app_servicio.community_team_post(p_product_id uuid, p jsonb)
--    RETURNS uuid
--    LANGUAGE plpgsql
--    SECURITY DEFINER
--    SET search_path TO ''
--   AS $function$
--   DECLARE
--     v_ws uuid;
--     v_parent_id uuid := NULL;
--     v_space text := p ->> 'space_key';
--     v_item uuid := NULLIF(p ->> 'program_item_id', '')::uuid;
--     v_check jsonb;
--     v_media jsonb;
--     v_id uuid;
--     v_first uuid := NULL;
--     v_keys text[];
--     v_key text;
--   BEGIN
--     SELECT workspace_id INTO v_ws FROM public.products WHERE id = p_product_id;
--     IF v_ws IS NULL THEN RAISE EXCEPTION 'No existe el programa' USING ERRCODE = 'CO002'; END IF;
--     PERFORM app_servicio.require_permission(v_ws, 'community.reply');
--     IF NULLIF(btrim(p ->> 'body'), '') IS NULL THEN RAISE EXCEPTION 'Escribí el mensaje' USING ERRCODE = 'CO002'; END IF;
--     v_media := app_servicio.community_team_media(v_ws, p_product_id, p -> 'media');
--     IF NULLIF(p ->> 'parent_id', '') IS NOT NULL THEN
--       SELECT id, space_key, program_item_id, ARRAY[community_key] INTO v_parent_id, v_space, v_item, v_keys FROM app_servicio_portal.community_posts
--        WHERE id = (p ->> 'parent_id')::uuid AND product_id = p_product_id AND deleted_at IS NULL;
--       IF v_parent_id IS NULL THEN RAISE EXCEPTION 'No existe ese post' USING ERRCODE = 'CO002'; END IF;
--     ELSE
--       IF v_item IS NOT NULL THEN v_space := 'clases'; END IF;
--       v_keys := COALESCE(
--         (SELECT array_agg(DISTINCT x) FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(p -> 'community_keys') = 'array' THEN p -> 'community_keys' END) x),
--         CASE WHEN NULLIF(p ->> 'community_key', '') IS NOT NULL THEN ARRAY[p ->> 'community_key'] END,
--         ARRAY[app_servicio.community_main_key(p_product_id)]);
--       FOREACH v_key IN ARRAY v_keys LOOP
--         v_check := app_servicio.community_can_post_check_in(NULL, p_product_id, v_key, v_space, v_item);
--         IF NOT COALESCE((v_check ->> 'ok')::boolean, false) THEN
--           RAISE EXCEPTION '%', CASE WHEN cardinality(v_keys) > 1 THEN COALESCE((SELECT x ->> 'name' FROM jsonb_array_elements(app_servicio.community_list(p_product_id)) x WHERE x ->> 'key' = v_key), v_key) || ': ' ELSE '' END
--                                || (v_check ->> 'reason') USING ERRCODE = 'CO002';
--         END IF;
--       END LOOP;
--     END IF;
--     FOREACH v_key IN ARRAY v_keys LOOP
--       INSERT INTO app_servicio_portal.community_posts (workspace_id, product_id, community_key, space_key, parent_id, program_item_id, author_user_id, as_business, body, media)
--       VALUES (v_ws, p_product_id, v_key, v_space, v_parent_id, v_item, auth.uid(), COALESCE((p ->> 'as_business')::boolean, false), btrim(p ->> 'body'), v_media)
--       RETURNING id INTO v_id;
--       v_first := COALESCE(v_first, v_id);
--       PERFORM app_servicio.audit(v_ws, 'product', p_product_id, CASE WHEN v_parent_id IS NULL THEN 'community.posted' ELSE 'community.replied' END,
--         jsonb_build_object('post_id', v_id, 'parent_id', v_parent_id, 'space_key', v_space, 'community_key', v_key, 'media', jsonb_array_length(v_media)));
--     END LOOP;
--     RETURN v_first;
--   END;
--   $function$
--
--   CREATE OR REPLACE FUNCTION app_servicio.community_team_edit(p_post_id uuid, p jsonb)
--    RETURNS void
--    LANGUAGE plpgsql
--    SECURITY DEFINER
--    SET search_path TO ''
--   AS $function$
--   DECLARE
--     t app_servicio_portal.community_posts;
--     v_media jsonb;
--   BEGIN
--     SELECT * INTO t FROM app_servicio_portal.community_posts WHERE id = p_post_id AND deleted_at IS NULL;
--     IF t.id IS NULL THEN RAISE EXCEPTION 'No existe ese post' USING ERRCODE = 'CO002'; END IF;
--     PERFORM app_servicio.require_permission(t.workspace_id, 'community.reply');
--     IF t.author_contact_id IS NOT NULL THEN RAISE EXCEPTION 'El post de un estudiante no se edita' USING ERRCODE = 'CO002'; END IF;
--     IF t.author_user_id IS DISTINCT FROM auth.uid() AND NOT public.has_permission(t.workspace_id, 'community.moderate') THEN
--       RAISE EXCEPTION 'Solo quien lo escribió (o quien modera) lo puede editar' USING ERRCODE = 'CO002';
--     END IF;
--     IF NULLIF(btrim(p ->> 'body'), '') IS NULL THEN RAISE EXCEPTION 'Escribí el mensaje' USING ERRCODE = 'CO002'; END IF;
--     IF char_length(btrim(p ->> 'body')) > 10000 THEN RAISE EXCEPTION 'Hasta 10.000 caracteres' USING ERRCODE = 'CO002'; END IF;
--     v_media := CASE WHEN p ? 'media' THEN app_servicio.community_team_media(t.workspace_id, t.product_id, p -> 'media') ELSE t.media END;
--     UPDATE app_servicio_portal.community_posts SET body = btrim(p ->> 'body'), media = v_media, edited_at = now() WHERE id = t.id;
--     PERFORM app_servicio.audit(t.workspace_id, 'product', t.product_id, 'community.edited', jsonb_build_object('post_id', t.id, 'media', jsonb_array_length(v_media)));
--   END;
--   $function$
--
--   CREATE OR REPLACE FUNCTION app_servicio.community_feed(p_product_id uuid, p jsonb DEFAULT '{}'::jsonb)
--    RETURNS jsonb
--    LANGUAGE plpgsql
--    STABLE SECURITY DEFINER
--    SET search_path TO ''
--   AS $function$
--   DECLARE
--     v_ws uuid;
--     v_filter text := COALESCE(p ->> 'filter', 'all');
--     v_limit integer := LEAST(100, GREATEST(1, COALESCE((p ->> 'limit')::integer, 30)));
--   BEGIN
--     SELECT workspace_id INTO v_ws FROM public.products WHERE id = p_product_id;
--     IF v_ws IS NULL THEN RETURN '[]'::jsonb; END IF;
--     IF NOT app_servicio.is_system() THEN PERFORM app_servicio.require_permission(v_ws, 'community.view'); END IF;
--     RETURN COALESCE((
--       SELECT jsonb_agg(row ORDER BY (row ->> 'pinned') DESC, (row ->> 'created_at') DESC)
--         FROM (
--           SELECT jsonb_build_object(
--             'id', t.id, 'community_key', t.community_key, 'space_key', t.space_key, 'program_item_id', t.program_item_id, 'body', t.body, 'media', t.media,
--             'author_contact_id', t.author_contact_id, 'author_name', c.display_name, 'author_user_id', t.author_user_id, 'as_business', t.as_business,
--             'pinned', t.pinned_at IS NOT NULL, 'hidden', t.hidden_at IS NOT NULL, 'hidden_reason', t.hidden_reason, 'seen', t.team_seen_at IS NOT NULL,
--             'deleted', t.deleted_at IS NOT NULL, 'created_at', t.created_at, 'edited_at', t.edited_at,
--             'unanswered', app_servicio.community_is_unanswered(t.id),
--             'reactions', COALESCE((SELECT jsonb_object_agg(k.kind, k.n) FROM (SELECT kind, count(*)::int n FROM app_servicio_portal.community_reactions WHERE post_id = t.id AND kind <> 'report' GROUP BY kind) k), '{}'::jsonb),
--             'reports', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'reason', r.report_reason, 'created_at', r.created_at)) FROM app_servicio_portal.community_reactions r WHERE r.post_id = t.id AND r.kind = 'report' AND r.resolved_at IS NULL), '[]'::jsonb),
--             'replies', COALESCE((SELECT jsonb_agg(jsonb_build_object(
--                 'id', x.id, 'body', x.body, 'author_contact_id', x.author_contact_id, 'author_name', xc.display_name, 'author_user_id', x.author_user_id,
--                 'as_business', x.as_business, 'hidden', x.hidden_at IS NOT NULL, 'created_at', x.created_at) ORDER BY x.created_at)
--               FROM app_servicio_portal.community_posts x LEFT JOIN public.contacts xc ON xc.id = x.author_contact_id
--              WHERE x.parent_id = t.id AND x.deleted_at IS NULL), '[]'::jsonb)) AS row
--             FROM app_servicio_portal.community_posts t
--             LEFT JOIN public.contacts c ON c.id = t.author_contact_id
--            WHERE t.product_id = p_product_id AND t.parent_id IS NULL AND t.deleted_at IS NULL
--              AND (NULLIF(p ->> 'community', '') IS NULL OR t.community_key = p ->> 'community')
--              AND (NULLIF(p ->> 'space', '') IS NULL OR t.space_key = p ->> 'space')
--              AND (NULLIF(p ->> 'program_item_id', '') IS NULL OR t.program_item_id = (p ->> 'program_item_id')::uuid)
--              AND (NULLIF(p ->> 'before', '') IS NULL OR t.created_at < (p ->> 'before')::timestamptz)
--              AND (v_filter <> 'unanswered' OR (t.created_at >= now() - interval '30 days' AND app_servicio.community_is_unanswered(t.id)))
--              AND (v_filter <> 'reported' OR EXISTS (SELECT 1 FROM app_servicio_portal.community_reactions r WHERE r.post_id = t.id AND r.kind = 'report' AND r.resolved_at IS NULL))
--            ORDER BY t.pinned_at DESC NULLS LAST, t.created_at DESC
--            LIMIT v_limit) q), '[]'::jsonb);
--   END;
--   $function$
--
--   CREATE OR REPLACE FUNCTION app_servicio_portal.post_row(p_me uuid, t app_servicio_portal.community_posts)
--    RETURNS jsonb
--    LANGUAGE sql
--    STABLE SECURITY DEFINER
--    SET search_path TO ''
--   AS $function$
--     SELECT jsonb_build_object(
--       'id', t.id, 'space', t.space_key, 'program_item_id', t.program_item_id, 'body', t.body, 'media_count', jsonb_array_length(t.media),
--       'author', CASE WHEN t.as_business OR t.author_user_id IS NOT NULL THEN jsonb_build_object('name', 'Equipo', 'team', true)
--                      ELSE jsonb_build_object('name', app_servicio_portal.public_name((SELECT COALESCE(a.display_name, c.display_name) FROM public.contacts c
--                             LEFT JOIN app_servicio_portal.portal_accounts a ON a.contact_id = c.id WHERE c.id = t.author_contact_id LIMIT 1)), 'team', false,
--                                              'contact_ref', md5(t.author_contact_id::text)) END,
--       'mine', t.author_contact_id = p_me, 'pinned', t.pinned_at IS NOT NULL, 'created_at', t.created_at, 'edited_at', t.edited_at,
--       'reactions', COALESCE((SELECT jsonb_object_agg(k.kind, k.n) FROM (SELECT kind, count(*)::int n FROM app_servicio_portal.community_reactions
--                               WHERE post_id = t.id AND kind <> 'report' GROUP BY kind) k), '{}'::jsonb),
--       'my_reactions', COALESCE((SELECT jsonb_agg(r.kind) FROM app_servicio_portal.community_reactions r WHERE r.post_id = t.id AND r.contact_id = p_me AND r.kind <> 'report'), '[]'::jsonb),
--       'replies', COALESCE((SELECT jsonb_agg(jsonb_build_object(
--                     'id', x.id, 'body', x.body, 'created_at', x.created_at, 'mine', x.author_contact_id = p_me,
--                     'author', CASE WHEN x.as_business OR x.author_user_id IS NOT NULL THEN jsonb_build_object('name', 'Equipo', 'team', true)
--                                    ELSE jsonb_build_object('name', app_servicio_portal.public_name((SELECT c.display_name FROM public.contacts c WHERE c.id = x.author_contact_id)), 'team', false) END)
--                     ORDER BY x.created_at)
--                   FROM app_servicio_portal.community_posts x
--                  WHERE x.parent_id = t.id AND x.deleted_at IS NULL AND (x.hidden_at IS NULL OR x.author_contact_id = p_me)), '[]'::jsonb));
--   $function$

-- ─── 1. La columna ──────────────────────────────────────────────────────────
ALTER TABLE app_servicio_portal.community_posts ADD COLUMN IF NOT EXISTS title text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'community_posts_title_check'
                   AND conrelid = 'app_servicio_portal.community_posts'::regclass) THEN
    ALTER TABLE app_servicio_portal.community_posts
      ADD CONSTRAINT community_posts_title_check CHECK (title IS NULL OR (char_length(title) BETWEEN 1 AND 200 AND title = btrim(title)));
  END IF;
END $$;
COMMENT ON COLUMN app_servicio_portal.community_posts.title IS
  '00405: el título de un post del equipo (hasta 200, con emojis). NULL en lo anterior, en las respuestas y en lo que publica un estudiante.';

-- ─── 2. Publicar, editar y leer ─────────────────────────────────────────────
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
  v_title text := NULLIF(btrim(COALESCE(p ->> 'title', '')), '');
BEGIN
  SELECT workspace_id INTO v_ws FROM public.products WHERE id = p_product_id;
  IF v_ws IS NULL THEN RAISE EXCEPTION 'No existe el programa' USING ERRCODE = 'CO002'; END IF;
  PERFORM app_servicio.require_permission(v_ws, 'community.reply');
  IF NULLIF(btrim(p ->> 'body'), '') IS NULL THEN RAISE EXCEPTION 'Escribí el mensaje' USING ERRCODE = 'CO002'; END IF;
  v_media := app_servicio.community_team_media(v_ws, p_product_id, p -> 'media');
  -- 00405: un post nuevo del equipo lleva título (hasta 200); una respuesta nunca.
  IF NULLIF(p ->> 'parent_id', '') IS NOT NULL THEN v_title := NULL;
  ELSIF v_title IS NULL THEN RAISE EXCEPTION 'Escribí el título' USING ERRCODE = 'CO002';
  ELSIF char_length(v_title) > 200 THEN RAISE EXCEPTION 'El título va hasta 200 caracteres' USING ERRCODE = 'CO002';
  END IF;
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
    INSERT INTO app_servicio_portal.community_posts (workspace_id, product_id, community_key, space_key, parent_id, program_item_id, author_user_id, as_business, title, body, media)
    VALUES (v_ws, p_product_id, v_key, v_space, v_parent_id, v_item, auth.uid(), COALESCE((p ->> 'as_business')::boolean, false), v_title, btrim(p ->> 'body'), v_media)
    RETURNING id INTO v_id;
    v_first := COALESCE(v_first, v_id);
    PERFORM app_servicio.audit(v_ws, 'product', p_product_id, CASE WHEN v_parent_id IS NULL THEN 'community.posted' ELSE 'community.replied' END,
      jsonb_build_object('post_id', v_id, 'parent_id', v_parent_id, 'space_key', v_space, 'community_key', v_key, 'media', jsonb_array_length(v_media)));
  END LOOP;
  RETURN v_first;
END;
$function$;

CREATE OR REPLACE FUNCTION app_servicio.community_team_edit(p_post_id uuid, p jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  t app_servicio_portal.community_posts;
  v_media jsonb;
  v_title text;
BEGIN
  SELECT * INTO t FROM app_servicio_portal.community_posts WHERE id = p_post_id AND deleted_at IS NULL;
  IF t.id IS NULL THEN RAISE EXCEPTION 'No existe ese post' USING ERRCODE = 'CO002'; END IF;
  PERFORM app_servicio.require_permission(t.workspace_id, 'community.reply');
  IF t.author_contact_id IS NOT NULL THEN RAISE EXCEPTION 'El post de un estudiante no se edita' USING ERRCODE = 'CO002'; END IF;
  IF t.author_user_id IS DISTINCT FROM auth.uid() AND NOT public.has_permission(t.workspace_id, 'community.moderate') THEN
    RAISE EXCEPTION 'Solo quien lo escribió (o quien modera) lo puede editar' USING ERRCODE = 'CO002';
  END IF;
  IF NULLIF(btrim(p ->> 'body'), '') IS NULL THEN RAISE EXCEPTION 'Escribí el mensaje' USING ERRCODE = 'CO002'; END IF;
  IF char_length(btrim(p ->> 'body')) > 10000 THEN RAISE EXCEPTION 'Hasta 10.000 caracteres' USING ERRCODE = 'CO002'; END IF;
  v_media := CASE WHEN p ? 'media' THEN app_servicio.community_team_media(t.workspace_id, t.product_id, p -> 'media') ELSE t.media END;
  -- 00405: el título se cambia solo en un post (no en una respuesta); sin la clave, queda como está.
  v_title := t.title;
  IF t.parent_id IS NULL AND p ? 'title' THEN
    v_title := NULLIF(btrim(COALESCE(p ->> 'title', '')), '');
    IF v_title IS NULL AND t.title IS NOT NULL THEN RAISE EXCEPTION 'Escribí el título' USING ERRCODE = 'CO002'; END IF;
    IF char_length(v_title) > 200 THEN RAISE EXCEPTION 'El título va hasta 200 caracteres' USING ERRCODE = 'CO002'; END IF;
  END IF;
  UPDATE app_servicio_portal.community_posts SET title = v_title, body = btrim(p ->> 'body'), media = v_media, edited_at = now() WHERE id = t.id;
  PERFORM app_servicio.audit(t.workspace_id, 'product', t.product_id, 'community.edited', jsonb_build_object('post_id', t.id, 'media', jsonb_array_length(v_media)));
END;
$function$;

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
          'id', t.id, 'community_key', t.community_key, 'space_key', t.space_key, 'program_item_id', t.program_item_id, 'title', t.title, 'body', t.body, 'media', t.media,
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

CREATE OR REPLACE FUNCTION app_servicio_portal.post_row(p_me uuid, t app_servicio_portal.community_posts)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT jsonb_build_object(
    'id', t.id, 'space', t.space_key, 'program_item_id', t.program_item_id, 'title', t.title, 'body', t.body, 'media_count', jsonb_array_length(t.media),
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
$function$;

-- ─── 3. A quién le llega el correo ──────────────────────────────────────────
-- Una fila por persona (la cuenta del portal es única por contacto y negocio). Con una sola comunidad, todos los que
-- tienen la comunidad; con varias, los que están en alguna de `p_keys` (sin keys, la principal).
CREATE OR REPLACE FUNCTION app_servicio.community_email_targets(p_product_id uuid, p_keys text[] DEFAULT NULL)
 RETURNS TABLE (contact_id uuid, email text, display_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT a.contact_id, a.email, COALESCE(NULLIF(btrim(a.display_name), ''), c.display_name)
    FROM public.products p
    JOIN app_servicio_portal.portal_accounts a ON a.workspace_id = p.workspace_id
    JOIN public.contacts c ON c.id = a.contact_id AND c.deleted_at IS NULL
   WHERE p.id = p_product_id
     AND app_servicio.module_on(p.workspace_id)
     AND a.status = 'active'
     AND a.email IS NOT NULL AND a.email <> ''
     AND app_servicio.portal_access_effective(a.contact_id, p_product_id, 'community') IS NOT NULL
     AND EXISTS (SELECT 1 FROM unnest(COALESCE(NULLIF(p_keys, '{}'::text[]), ARRAY[app_servicio.community_main_key(p_product_id)])) k
                  WHERE app_servicio.community_member(a.contact_id, p_product_id, k))
   ORDER BY a.email;
$function$;
REVOKE ALL ON FUNCTION app_servicio.community_email_targets(uuid, text[]) FROM PUBLIC, anon, authenticated, portal_app;
GRANT EXECUTE ON FUNCTION app_servicio.community_email_targets(uuid, text[]) TO service_role;

-- Lo que el correo necesita de un post (el job lo relee al mandar: si se borró o se ocultó, no sale). Solo service_role.
CREATE OR REPLACE FUNCTION app_servicio.community_post_for_email(p_post_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT jsonb_build_object(
    'id', t.id, 'workspace_id', t.workspace_id, 'product_id', t.product_id, 'product_name', p.name, 'community_key', t.community_key,
    'title', t.title, 'body', t.body, 'photo_count', jsonb_array_length(COALESCE(t.media, '[]'::jsonb)),
    'live', t.deleted_at IS NULL AND t.hidden_at IS NULL AND t.parent_id IS NULL)
    FROM app_servicio_portal.community_posts t
    JOIN public.products p ON p.id = t.product_id
   WHERE t.id = p_post_id;
$function$;
REVOKE ALL ON FUNCTION app_servicio.community_post_for_email(uuid) FROM PUBLIC, anon, authenticated, portal_app;
GRANT EXECUTE ON FUNCTION app_servicio.community_post_for_email(uuid) TO service_role;
