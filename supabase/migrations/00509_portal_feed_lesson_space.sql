-- 00509_portal_feed_lesson_space
--
-- En el portal, la Comunidad suma la pestaña «Clases»: ahí se ven los comentarios que se escribieron dentro de una
-- clase (posts del espacio reservado `clases`, con `program_item_id`), cada uno con «En la clase: <título>», que
-- lleva a la clase. En «Clases» no se publica desde el muro: solo desde la clase (eso ya lo asegura
-- `community_can_post_check_in`, porque `clases` no es un espacio de la comunidad).
--
-- Cambia a propósito:
--   · `app_servicio_portal.portal_feed`:
--       - con `p_space = 'clases'` devuelve los posts de las clases de la comunidad de la persona (solo de clases
--         activas y si los comentarios de clase están prendidos en el programa); sin espacio o con otro espacio sigue
--         igual que antes (sin los de las clases: «Todo» es el muro).
--       - cada post de una clase trae `lesson: { id, title }` (la clase a la que pertenece).
--       - devuelve `lessons_on`: si el programa tiene los comentarios de clase prendidos (el portal muestra la
--         pestaña solo entonces).
--       - en «Clases», `can_post` es siempre no (se comenta desde la clase).
-- Aditiva: puede ir antes o después del deploy del portal (el portal viejo no pide `clases` e ignora los campos nuevos).
--
-- Para volver atrás: la definición anterior de `portal_feed` está en 00402_community_by_variant.sql.

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
  v_space text := NULLIF(p_space, '');
  v_lessons_on boolean := COALESCE((SELECT portal_settings #>> '{community,lesson_comments}' FROM public.products WHERE id = p_product_id), 'true') <> 'false';
BEGIN
  SELECT COALESCE(jsonb_agg(
           app_servicio_portal.post_row(v_me, t)
             || CASE WHEN t.program_item_id IS NOT NULL THEN jsonb_build_object('lesson',
                  (SELECT jsonb_build_object('id', pi.id, 'title', pi.title) FROM app_servicio.program_items pi WHERE pi.id = t.program_item_id))
                ELSE '{}'::jsonb END
           ORDER BY t.pinned_at DESC NULLS LAST, t.created_at DESC), '[]'::jsonb) INTO v_rows FROM (
    SELECT * FROM app_servicio_portal.community_posts t
     WHERE t.product_id = p_product_id AND t.community_key = v_comm AND t.parent_id IS NULL AND t.deleted_at IS NULL
       AND (t.hidden_at IS NULL OR t.author_contact_id = v_me)
       AND CASE WHEN v_space = 'clases' THEN
             t.space_key = 'clases' AND v_lessons_on
             AND EXISTS (SELECT 1 FROM app_servicio.program_items pi
                          WHERE pi.id = t.program_item_id AND pi.product_id = p_product_id AND pi.kind = 'lesson' AND pi.status = 'active')
           ELSE t.space_key <> 'clases' AND (v_space IS NULL OR t.space_key = v_space) END
       AND (p_before IS NULL OR t.created_at < p_before)
     ORDER BY t.pinned_at DESC NULLS LAST, t.created_at DESC LIMIT 20) t;
  RETURN jsonb_build_object('posts', v_rows,
    'next', CASE WHEN jsonb_array_length(v_rows) = 20 THEN v_rows -> 19 ->> 'created_at' END,
    'lessons_on', v_lessons_on,
    'can_post', CASE WHEN v_space = 'clases' THEN jsonb_build_object('ok', false, 'reason', 'En Clases se comenta desde cada clase')
                     ELSE app_servicio.community_can_post_check_in(v_me, p_product_id, v_comm, COALESCE(v_space, 'general'), NULL) END);
END;
$function$;
