-- @plantilla-quitar(servicios)
-- ============================================================================
-- 00400_portal_lesson_fathom_link  (Portal: una clase con link de Fathom pegado a mano)
-- ============================================================================
-- `portal_lesson` mandaba `fathom` (el botón «Ver la grabación» del portal) solo si la clase venía de una grabación
-- sincronizada (`source_call_id`). Una clase con el link compartido de Fathom pegado en el editor (lo que el editor
-- acepta y avisa que «el portal muestra el botón Ver la grabación») no mostraba nada. Ahora también va con un
-- `video_url` de fathom.video (/share/ o /calls/) sin link para incrustar; la URL es la de la grabación sincronizada
-- si la hay, y si no, el link pegado. El resto de la función es igual a la 00399.
--
-- Aditiva (reemplaza una función). Volver atrás: correr de nuevo la definición de portal_lesson de la 00399.
-- ============================================================================

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
    'fathom', CASE WHEN i.video_embed_url IS NULL AND (i.source_call_id IS NOT NULL OR i.video_url ~ '^https://fathom\.video/(share|calls)/')
                   THEN jsonb_build_object('url', COALESCE((SELECT c.share_url FROM public.calls c WHERE c.id = i.source_call_id), i.video_url)) END,
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
