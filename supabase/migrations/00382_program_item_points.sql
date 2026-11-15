-- @plantilla-quitar(servicios)
-- 00382 · Corrida A3 · F129: «Puntos al entregar / al aprobar» de una actividad o evaluación (Wendy dijo que sí, 15/11).
--
-- `program_update_item` suma la clave `points` ({submit, pass}, cada uno entero de 0 a 10.000; null o {} = los del
-- programa). Sin la clave en el cambio, el ítem queda como estaba: nada cambia para lo que ya existe. El CHECK
-- `program_items_points_check` (00378) ya impide otras claves.
--
-- Volver atrás: correr la definición vieja de `docs/servicios/definiciones-viejas-a3.sql` (── 00382 ──).

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
    points = CASE WHEN p ? 'points' THEN v_points ELSE points END
  WHERE id = it.id;
  PERFORM app_servicio.audit(it.workspace_id, 'product', it.product_id, 'program.item_updated',
    jsonb_build_object('item_id', it.id, 'keys', (SELECT jsonb_agg(k2) FROM jsonb_object_keys(p) k2)));
END;
$$;
