-- 00505_community_team_author_name
--
-- Un post o comentario del equipo en el portal muestra el nombre de quien lo escribió (con la marca «Equipo» al lado,
-- que la pone el portal por `team: true`). Solo el que se publica «como el negocio» (`as_business`) sigue diciendo
-- «Equipo». El nombre sale del perfil de la persona en SSA (`full_name`, si no `name`, de auth.users); sin nombre
-- cargado, «Equipo», como antes.
--
-- Cambia a propósito `app_servicio_portal.post_row` (solo el autor del post y de cada respuesta). Suma
-- `app_servicio_portal.team_author_name`, que solo usa `post_row` (SECURITY DEFINER): nadie más la puede llamar.
-- Aditiva: puede ir antes o después del deploy (el portal ya muestra `author.name`).
--
-- Definición vigente de post_row antes de esta migración (leída de la base el 20/11/2026, para volver atrás):
--
--   CREATE OR REPLACE FUNCTION app_servicio_portal.post_row(p_me uuid, t app_servicio_portal.community_posts)
--    RETURNS jsonb
--    LANGUAGE sql
--    STABLE SECURITY DEFINER
--    SET search_path TO ''
--   AS $function$
--     SELECT jsonb_build_object(
--       'id', t.id, 'space', t.space_key, 'program_item_id', t.program_item_id, 'title', t.title, 'body', t.body, 'media_count', jsonb_array_length(t.media),
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
--   

CREATE OR REPLACE FUNCTION app_servicio_portal.team_author_name(p_user_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT NULLIF(btrim(COALESCE(NULLIF(btrim(u.raw_user_meta_data ->> 'full_name'), ''), u.raw_user_meta_data ->> 'name', '')), '')
    FROM auth.users u
   WHERE u.id = p_user_id;
$function$;
REVOKE ALL ON FUNCTION app_servicio_portal.team_author_name(uuid) FROM PUBLIC, anon, authenticated, service_role;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'portal_app') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION app_servicio_portal.team_author_name(uuid) FROM portal_app';
  END IF;
END $$;

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
                  'id', x.id, 'body', x.body, 'created_at', x.created_at, 'mine', x.author_contact_id = p_me,
                  'author', CASE WHEN x.as_business THEN jsonb_build_object('name', 'Equipo', 'team', true)
                                 WHEN x.author_user_id IS NOT NULL THEN jsonb_build_object('name', COALESCE(app_servicio_portal.team_author_name(x.author_user_id), 'Equipo'), 'team', true)
                                 ELSE jsonb_build_object('name', app_servicio_portal.public_name((SELECT c.display_name FROM public.contacts c WHERE c.id = x.author_contact_id)), 'team', false) END)
                  ORDER BY x.created_at)
                FROM app_servicio_portal.community_posts x
               WHERE x.parent_id = t.id AND x.deleted_at IS NULL AND (x.hidden_at IS NULL OR x.author_contact_id = p_me)), '[]'::jsonb));
$function$;
