-- 00506_community_comment_threads
--
-- En el portal, cada comentario de un post (del muro o de una clase) se puede likear y responder. La respuesta queda
-- colgada debajo del comentario, con un solo nivel: responder a una respuesta la deja en el mismo hilo (el portal le
-- antepone «@Nombre»).
--
-- La respuesta a un comentario sigue siendo un comentario más del post (`parent_id` = el post), así que no cambia nada
-- de lo que ya cuenta comentarios (el trigger de estructura, los puntos, «sin responder», las métricas, el panel, que
-- la sigue viendo en la lista del post). Solo se suma `reply_to_id`: el comentario al que responde.
--
-- Suma:
--   · `community_posts.reply_to_id` (+ índice).
--   · `app_servicio_portal.portal_comment_reply(session, product, comment, body)`: valida con `portal_post_create`
--     (acceso, comunidad, silenciado, largo) y marca a qué comentario responde.
-- Cambia a propósito:
--   · `app_servicio_portal.post_row`: cada respuesta trae `reply_to`, `reactions` y `my_reactions` (el me gusta de
--     un comentario ya se guardaba con `portal_react`, que acepta cualquier post visible; faltaba devolverlo).
--   · `app_servicio.portal_notifications_view`: a quien escribió el comentario le llega «Te respondieron en la
--     comunidad» (si no es también quien escribió el post, que ya lo recibía).
-- Aditiva: puede ir antes o después del deploy del portal (el portal viejo ignora los campos nuevos).
--
-- Para volver atrás: las definiciones anteriores de post_row (00505) y portal_notifications_view (leída de la base
-- el 20/11/2026) están en esas migraciones / en la base; borrar la función y la columna:
--   DROP FUNCTION app_servicio_portal.portal_comment_reply(text, uuid, uuid, text);
--   ALTER TABLE app_servicio_portal.community_posts DROP COLUMN reply_to_id;

ALTER TABLE app_servicio_portal.community_posts
  ADD COLUMN IF NOT EXISTS reply_to_id uuid REFERENCES app_servicio_portal.community_posts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS community_posts_reply_to_idx
  ON app_servicio_portal.community_posts (reply_to_id) WHERE reply_to_id IS NOT NULL;

CREATE OR REPLACE FUNCTION app_servicio_portal.post_row(p_me uuid, t app_servicio_portal.community_posts)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT jsonb_build_object(
    'id', t.id, 'space', t.space_key, 'program_item_id', t.program_item_id, 'title', t.title, 'body', t.body, 'media_count', jsonb_array_length(t.media),
    'author', CASE WHEN t.as_business THEN jsonb_build_object('name', 'Equipo', 'team', true)
                   WHEN t.author_user_id IS NOT NULL THEN jsonb_build_object('name', COALESCE(app_servicio_portal.team_author_name(t.author_user_id), 'Equipo'), 'team', true)
                   ELSE jsonb_build_object('name', app_servicio_portal.public_name((SELECT COALESCE(a.display_name, c.display_name) FROM public.contacts c
                          LEFT JOIN app_servicio_portal.portal_accounts a ON a.contact_id = c.id WHERE c.id = t.author_contact_id LIMIT 1)), 'team', false,
                                           'contact_ref', md5(t.author_contact_id::text)) END,
    'mine', t.author_contact_id = p_me, 'pinned', t.pinned_at IS NOT NULL, 'created_at', t.created_at, 'edited_at', t.edited_at,
    'reactions', COALESCE((SELECT jsonb_object_agg(k.kind, k.n) FROM (SELECT kind, count(*)::int n FROM app_servicio_portal.community_reactions
                            WHERE post_id = t.id AND kind <> 'report' GROUP BY kind) k), '{}'::jsonb),
    'my_reactions', COALESCE((SELECT jsonb_agg(r.kind) FROM app_servicio_portal.community_reactions r WHERE r.post_id = t.id AND r.contact_id = p_me AND r.kind <> 'report'), '[]'::jsonb),
    'replies', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                  'id', x.id, 'body', x.body, 'created_at', x.created_at, 'mine', x.author_contact_id = p_me, 'reply_to', x.reply_to_id,
                  'author', CASE WHEN x.as_business THEN jsonb_build_object('name', 'Equipo', 'team', true)
                                 WHEN x.author_user_id IS NOT NULL THEN jsonb_build_object('name', COALESCE(app_servicio_portal.team_author_name(x.author_user_id), 'Equipo'), 'team', true)
                                 ELSE jsonb_build_object('name', app_servicio_portal.public_name((SELECT c.display_name FROM public.contacts c WHERE c.id = x.author_contact_id)), 'team', false) END,
                  'reactions', COALESCE((SELECT jsonb_object_agg(k.kind, k.n) FROM (SELECT kind, count(*)::int n FROM app_servicio_portal.community_reactions
                                          WHERE post_id = x.id AND kind <> 'report' GROUP BY kind) k), '{}'::jsonb),
                  'my_reactions', COALESCE((SELECT jsonb_agg(r.kind) FROM app_servicio_portal.community_reactions r WHERE r.post_id = x.id AND r.contact_id = p_me AND r.kind <> 'report'), '[]'::jsonb))
                  ORDER BY x.created_at)
                FROM app_servicio_portal.community_posts x
               WHERE x.parent_id = t.id AND x.deleted_at IS NULL AND (x.hidden_at IS NULL OR x.author_contact_id = p_me)), '[]'::jsonb));
$function$;

CREATE OR REPLACE FUNCTION app_servicio_portal.portal_comment_reply(p_session text, p_product_id uuid, p_comment_id uuid, p_body text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  c app_servicio_portal.community_posts;
  v_root uuid;
  v_res jsonb;
BEGIN
  SELECT * INTO c FROM app_servicio_portal.community_posts
   WHERE id = p_comment_id AND product_id = p_product_id AND deleted_at IS NULL AND hidden_at IS NULL;
  IF c.id IS NULL OR c.parent_id IS NULL THEN PERFORM app_servicio_portal.err('PO404', 'Ese comentario ya no está'); END IF;
  -- Un solo nivel: responder a una respuesta queda en el hilo de su comentario (si ese comentario sigue ahí).
  v_root := c.id;
  IF c.reply_to_id IS NOT NULL AND EXISTS (SELECT 1 FROM app_servicio_portal.community_posts
                                            WHERE id = c.reply_to_id AND deleted_at IS NULL AND hidden_at IS NULL) THEN
    v_root := c.reply_to_id;
  END IF;
  -- portal_post_create valida todo (sesión, acceso, comunidad, silenciado, largo) y publica en el post del comentario.
  v_res := app_servicio_portal.portal_post_create(p_session, p_product_id, '', p_body, c.parent_id, NULL, '[]'::jsonb);
  UPDATE app_servicio_portal.community_posts SET reply_to_id = v_root WHERE id = (v_res ->> 'id')::uuid;
  RETURN v_res;
END;
$function$;

REVOKE ALL ON FUNCTION app_servicio_portal.portal_comment_reply(text, uuid, uuid, text) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION app_servicio_portal.portal_comment_reply(text, uuid, uuid, text) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION app_servicio_portal.portal_comment_reply(text, uuid, uuid, text) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'portal_app') THEN
    GRANT EXECUTE ON FUNCTION app_servicio_portal.portal_comment_reply(text, uuid, uuid, text) TO portal_app;
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION app_servicio_portal.portal_comment_reply(text, uuid, uuid, text) TO service_role;

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
    -- 00506: la respuesta a mi comentario (si el post no es mío: ese aviso ya está arriba).
    SELECT jsonb_build_object('kind', 'reply', 'at', r.created_at, 'post_id', r.parent_id, 'reply_id', r.id)
      FROM app_servicio_portal.community_posts r
      JOIN app_servicio_portal.community_posts c ON c.id = r.reply_to_id
      JOIN app_servicio_portal.community_posts p ON p.id = r.parent_id
     WHERE (v_prefs ->> 'community_reply')::boolean AND c.author_contact_id = a.contact_id
       AND p.author_contact_id IS DISTINCT FROM a.contact_id AND r.author_contact_id IS DISTINCT FROM a.contact_id
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
