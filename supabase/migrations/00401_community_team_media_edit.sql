-- @plantilla-quitar(servicios)
-- ============================================================================
-- 00401_community_team_media_edit  (Comunidad con formato, desde el panel)
-- ============================================================================
-- El equipo publica en la comunidad con formato (Markdown acotado en `body`, el mismo lector que el contrato:
-- títulos, negrita, cursiva, listas y links), con fotos y editando lo que ya publicó.
--
--   community_team_post(product_id, p)   ahora acepta `p.media` = [{path}] (hasta 10 fotos). Cada foto la subió el
--                                        equipo al bucket `community-media` en `<negocio>/<programa>/team/<id>.<ext>`;
--                                        un path de otro negocio, de otro programa o de un estudiante no se acepta.
--   community_team_edit(post_id, p)      cambia el texto y las fotos de un post del EQUIPO (nunca el de un
--                                        estudiante): quien lo escribió, o quien tiene community.moderate.
--                                        Deja `edited_at`.
--
-- El portal ya muestra las fotos (`media_count` + `portal_file_grant` kind `community_media`, 00389) y lo fijado
-- primero: no cambia nada del lado del estudiante.
--
-- Aditiva: se redefine community_team_post con lo de antes intacto (sin `media`, igual que siempre).
-- Volver atrás: DROP de community_team_edit y community_team_media; volver a crear community_team_post como en la 00351.
-- ============================================================================

-- Las fotos que manda el equipo: un arreglo de hasta 10 objetos {path}, todos del negocio y del programa.
CREATE OR REPLACE FUNCTION app_servicio.community_team_media(p_ws uuid, p_product_id uuid, p_media jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  v_prefix text := p_ws::text || '/' || p_product_id::text || '/team/';
BEGIN
  IF p_media IS NULL OR p_media = 'null'::jsonb THEN RETURN '[]'::jsonb; END IF;
  IF jsonb_typeof(p_media) <> 'array' OR jsonb_array_length(p_media) > 10 THEN
    RAISE EXCEPTION 'Hasta 10 fotos por publicación' USING ERRCODE = 'CO002';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_media) m
     WHERE jsonb_typeof(m) <> 'object'
        OR left(COALESCE(m ->> 'path', ''), length(v_prefix)) <> v_prefix
        OR substr(m ->> 'path', length(v_prefix) + 1) !~ '^[0-9a-f-]{36}\.(png|jpg|jpeg|webp|gif)$'
  ) THEN
    RAISE EXCEPTION 'Una de las fotos no es válida' USING ERRCODE = 'CO002';
  END IF;
  RETURN (SELECT COALESCE(jsonb_agg(jsonb_build_object('path', m ->> 'path')), '[]'::jsonb) FROM jsonb_array_elements(p_media) m);
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio.community_team_post(p_product_id uuid, p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_ws uuid;
  v_parent_id uuid := NULL;
  v_space text := p ->> 'space_key';
  v_item uuid := NULLIF(p ->> 'program_item_id', '')::uuid;
  v_check jsonb;
  v_media jsonb;
  v_id uuid;
BEGIN
  SELECT workspace_id INTO v_ws FROM public.products WHERE id = p_product_id;
  IF v_ws IS NULL THEN RAISE EXCEPTION 'No existe el programa' USING ERRCODE = 'CO002'; END IF;
  PERFORM app_servicio.require_permission(v_ws, 'community.reply');
  IF NULLIF(btrim(p ->> 'body'), '') IS NULL THEN RAISE EXCEPTION 'Escribí el mensaje' USING ERRCODE = 'CO002'; END IF;
  v_media := app_servicio.community_team_media(v_ws, p_product_id, p -> 'media');
  IF NULLIF(p ->> 'parent_id', '') IS NOT NULL THEN
    SELECT id, space_key, program_item_id INTO v_parent_id, v_space, v_item FROM app_servicio_portal.community_posts
     WHERE id = (p ->> 'parent_id')::uuid AND product_id = p_product_id AND deleted_at IS NULL;
    IF v_parent_id IS NULL THEN RAISE EXCEPTION 'No existe ese post' USING ERRCODE = 'CO002'; END IF;
  ELSE
    IF v_item IS NOT NULL THEN v_space := 'clases'; END IF;
    v_check := app_servicio.community_can_post_check(NULL, p_product_id, v_space, v_item);
    IF NOT COALESCE((v_check ->> 'ok')::boolean, false) THEN RAISE EXCEPTION '%', v_check ->> 'reason' USING ERRCODE = 'CO002'; END IF;
  END IF;
  INSERT INTO app_servicio_portal.community_posts (workspace_id, product_id, space_key, parent_id, program_item_id, author_user_id, as_business, body, media)
  VALUES (v_ws, p_product_id, v_space, v_parent_id, v_item, auth.uid(), COALESCE((p ->> 'as_business')::boolean, false), btrim(p ->> 'body'), v_media)
  RETURNING id INTO v_id;
  PERFORM app_servicio.audit(v_ws, 'product', p_product_id, CASE WHEN v_parent_id IS NULL THEN 'community.posted' ELSE 'community.replied' END,
    jsonb_build_object('post_id', v_id, 'parent_id', v_parent_id, 'space_key', v_space, 'media', jsonb_array_length(v_media)));
  RETURN v_id;
END;
$$;

-- Editar un post (o una respuesta) del equipo: el texto y las fotos. p: {body, media}.
CREATE OR REPLACE FUNCTION app_servicio.community_team_edit(p_post_id uuid, p jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  t app_servicio_portal.community_posts;
  v_media jsonb;
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
  UPDATE app_servicio_portal.community_posts SET body = btrim(p ->> 'body'), media = v_media, edited_at = now() WHERE id = t.id;
  PERFORM app_servicio.audit(t.workspace_id, 'product', t.product_id, 'community.edited', jsonb_build_object('post_id', t.id, 'media', jsonb_array_length(v_media)));
END;
$$;

REVOKE ALL ON FUNCTION app_servicio.community_team_media(uuid, uuid, jsonb), app_servicio.community_team_edit(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_servicio.community_team_media(uuid, uuid, jsonb), app_servicio.community_team_edit(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION app_servicio.community_team_edit(uuid, jsonb) TO authenticated;
