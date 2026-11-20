-- @plantilla-quitar(servicios)
-- ============================================================================
-- 00503_journey_items_closed_phase_and_portal_link  (Pasos del camino: tildado en fases cerradas y botón del portal)
-- ============================================================================
-- Dos cambios:
--
-- 1. `svc_complete_by_form` (búsqueda sin paso firmado) también mira los pasos pendientes de una fase CERRADA. Antes
--    una persona que firmaba el contrato o mandaba el formulario cuando su fase ya se había cerrado a mano no tildaba
--    nada. Se busca primero en las fases abiertas (en curso o futuras) y, si no hay, en las cerradas; dentro de cada
--    grupo, el mismo orden de siempre. La rama del paso firmado no cambia (ya no miraba la fase). Misma firma.
--    Completar un paso de una fase cerrada no reabre ni mueve la fase: `svc_mark_item` solo avanza fases en curso.
--
-- 2. `app_servicio.portal_item_form_link(p_session, p_item_id)` (nueva, solo `service_role`): lo que necesita SSA para
--    armar el link firmado del botón «Firmar el contrato» / «Completar el formulario» del portal
--    (`/api/portal/form-link`). Comprueba que el paso sea de la persona de la sesión (nunca una vista previa), que el
--    portal le muestre el botón, que siga pendiente y sin candado, y que el formulario esté publicado y sea del tipo
--    del paso. Las actividades y las evaluaciones no entran: se entregan dentro del portal.
--
-- Aditiva. Va ANTES de desplegar el código (la ruta llama a la función nueva). Sin datos que cambiar: el 19/11/2026
-- no había ningún paso pendiente cuyo formulario ya se hubiera enviado.
--
-- Volver atrás: correr la definición vieja de `svc_complete_by_form` (la de la 00335, igual a la de producción el
-- 19/11/2026, md5 de pg_get_functiondef 02a91de724f5bd7f660a5cec5671464d) y
-- `DROP FUNCTION IF EXISTS app_servicio.portal_item_form_link(text, uuid);`
--
--   CREATE OR REPLACE FUNCTION app_servicio.svc_complete_by_form(p_workspace_id uuid, p_contact_id uuid, p_form_id uuid, p_signed_item uuid, p_kinds text, p_source text)
--   RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
--   DECLARE
--     it app_servicio.service_items;
--     v_count integer;
--     v_kinds text[] := string_to_array(p_kinds, ',');
--   BEGIN
--     IF p_signed_item IS NOT NULL THEN
--       SELECT i.* INTO it FROM app_servicio.service_items i JOIN app_servicio.services s ON s.id = i.service_id
--        WHERE i.id = p_signed_item AND s.contact_id = p_contact_id AND i.status = 'pending' AND i.kind = ANY (v_kinds)
--          AND i.ref ->> 'form_id' = p_form_id::text AND COALESCE(i.ref ->> 'complete_on', 'submitted') = 'submitted';
--       IF it.id IS NOT NULL THEN
--         PERFORM app_servicio.svc_mark_item(it.id, p_source, 'client', NULL);
--         RETURN it.id;
--       END IF;
--       RETURN NULL;
--     END IF;
--     SELECT count(DISTINCT i.service_id) INTO v_count
--       FROM app_servicio.service_items i JOIN app_servicio.services s ON s.id = i.service_id JOIN app_servicio.service_phases ph ON ph.id = i.phase_id
--      WHERE s.workspace_id = p_workspace_id AND s.contact_id = p_contact_id AND s.status = 'active' AND i.status = 'pending' AND NOT i.is_recurring_template
--        AND i.kind = ANY (v_kinds) AND i.ref ->> 'form_id' = p_form_id::text AND COALESCE(i.ref ->> 'complete_on', 'submitted') = 'submitted'
--        AND ph.status <> 'completed';
--     IF v_count = 0 THEN RETURN NULL; END IF;
--     SELECT i.* INTO it
--       FROM app_servicio.service_items i JOIN app_servicio.services s ON s.id = i.service_id JOIN app_servicio.service_phases ph ON ph.id = i.phase_id
--      WHERE s.workspace_id = p_workspace_id AND s.contact_id = p_contact_id AND s.status = 'active' AND i.status = 'pending' AND NOT i.is_recurring_template
--        AND i.kind = ANY (v_kinds) AND i.ref ->> 'form_id' = p_form_id::text AND COALESCE(i.ref ->> 'complete_on', 'submitted') = 'submitted'
--        AND ph.status <> 'completed'
--      ORDER BY s.created_at, (ph.status = 'in_progress') DESC, ph.position, i.position, i.occurrence_index NULLS FIRST
--      LIMIT 1;
--     IF v_count > 1 THEN
--       PERFORM app_servicio.audit(p_workspace_id, 'service_item', it.id, 'svc.item_ambiguous',
--         jsonb_build_object('service_id', it.service_id, 'form_id', p_form_id, 'services', v_count), 'system');
--     END IF;
--     PERFORM app_servicio.svc_mark_item(it.id, p_source, 'client', NULL);
--     RETURN it.id;
--   END;
--   $$;

-- ─── 1. svc_complete_by_form: también fases cerradas, las abiertas primero ───
CREATE OR REPLACE FUNCTION app_servicio.svc_complete_by_form(p_workspace_id uuid, p_contact_id uuid, p_form_id uuid, p_signed_item uuid, p_kinds text, p_source text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  it app_servicio.service_items;
  v_count integer;
  v_kinds text[] := string_to_array(p_kinds, ',');
BEGIN
  IF p_signed_item IS NOT NULL THEN
    SELECT i.* INTO it FROM app_servicio.service_items i JOIN app_servicio.services s ON s.id = i.service_id
     WHERE i.id = p_signed_item AND s.contact_id = p_contact_id AND i.status = 'pending' AND i.kind = ANY (v_kinds)
       AND i.ref ->> 'form_id' = p_form_id::text AND COALESCE(i.ref ->> 'complete_on', 'submitted') = 'submitted';
    IF it.id IS NOT NULL THEN
      PERFORM app_servicio.svc_mark_item(it.id, p_source, 'client', NULL);
      RETURN it.id;
    END IF;
    RETURN NULL;
  END IF;
  -- Sin paso firmado: los pasos pendientes con ese formulario en servicios activos del contacto. 00503: también los
  -- de una fase cerrada, pero después de los de una fase abierta (en curso primero); si hay varios servicios, el mas
  -- antiguo dentro de cada grupo.
  SELECT count(DISTINCT i.service_id) INTO v_count
    FROM app_servicio.service_items i JOIN app_servicio.services s ON s.id = i.service_id JOIN app_servicio.service_phases ph ON ph.id = i.phase_id
   WHERE s.workspace_id = p_workspace_id AND s.contact_id = p_contact_id AND s.status = 'active' AND i.status = 'pending' AND NOT i.is_recurring_template
     AND i.kind = ANY (v_kinds) AND i.ref ->> 'form_id' = p_form_id::text AND COALESCE(i.ref ->> 'complete_on', 'submitted') = 'submitted';
  IF v_count = 0 THEN RETURN NULL; END IF;
  SELECT i.* INTO it
    FROM app_servicio.service_items i JOIN app_servicio.services s ON s.id = i.service_id JOIN app_servicio.service_phases ph ON ph.id = i.phase_id
   WHERE s.workspace_id = p_workspace_id AND s.contact_id = p_contact_id AND s.status = 'active' AND i.status = 'pending' AND NOT i.is_recurring_template
     AND i.kind = ANY (v_kinds) AND i.ref ->> 'form_id' = p_form_id::text AND COALESCE(i.ref ->> 'complete_on', 'submitted') = 'submitted'
   ORDER BY (ph.status = 'completed'), s.created_at, (ph.status = 'in_progress') DESC, ph.position, i.position, i.occurrence_index NULLS FIRST
   LIMIT 1;
  IF v_count > 1 THEN
    PERFORM app_servicio.audit(p_workspace_id, 'service_item', it.id, 'svc.item_ambiguous',
      jsonb_build_object('service_id', it.service_id, 'form_id', p_form_id, 'services', v_count), 'system');
  END IF;
  PERFORM app_servicio.svc_mark_item(it.id, p_source, 'client', NULL);
  RETURN it.id;
END;
$$;

-- ─── 2. portal_item_form_link: lo que necesita el botón del portal ──────────
CREATE OR REPLACE FUNCTION app_servicio.portal_item_form_link(p_session text, p_item_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  it app_servicio.service_items;
  s app_servicio.services;
  pf jsonb;
  f record;
  v_form_text text;
  v_type text;
BEGIN
  -- Una vista previa del equipo nunca firma ni responde en nombre de la persona.
  IF sess ->> 'kind' IS DISTINCT FROM 'student' THEN
    PERFORM app_servicio_portal.err('PO403', 'En la vista previa no se abre el formulario');
  END IF;
  IF p_item_id IS NULL THEN PERFORM app_servicio_portal.err('PO404', 'Este paso ya no está'); END IF;
  SELECT * INTO it FROM app_servicio.service_items WHERE id = p_item_id;
  IF it.id IS NULL THEN PERFORM app_servicio_portal.err('PO404', 'Este paso ya no está'); END IF;
  SELECT * INTO s FROM app_servicio.services WHERE id = it.service_id;
  IF s.id IS NULL OR s.workspace_id IS DISTINCT FROM (sess ->> 'workspace_id')::uuid
     OR s.contact_id IS DISTINCT FROM (sess ->> 'contact_id')::uuid THEN
    PERFORM app_servicio_portal.err('PO404', 'Este paso ya no está');
  END IF;
  -- Términos pendientes y pausa con corte los decide el programa, igual que «Mi camino».
  pf := app_servicio_portal.program_for(sess, s.product_id);
  IF (pf ->> 'service_id')::uuid IS DISTINCT FROM s.id OR s.status NOT IN ('active', 'paused') THEN
    PERFORM app_servicio_portal.err('PO404', 'Este paso ya no está');
  END IF;
  IF NOT it.visible_to_client OR NOT it.portal_button OR it.is_recurring_template OR it.parent_item_id IS NOT NULL
     OR it.kind NOT IN ('form', 'survey', 'contract') THEN
    PERFORM app_servicio_portal.err('PO404', 'Este paso no tiene formulario');
  END IF;
  IF it.status <> 'pending' THEN PERFORM app_servicio_portal.err('PO409', 'Este paso ya está completo'); END IF;
  IF jsonb_typeof(it.ref -> 'lock') = 'object'
     AND COALESCE((app_servicio.svc_item_lock_state(it.id) ->> 'locked')::boolean, false) THEN
    PERFORM app_servicio_portal.err('PO409', 'Este paso todavía está bloqueado');
  END IF;
  v_form_text := it.ref ->> 'form_id';
  IF v_form_text IS NULL OR v_form_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    PERFORM app_servicio_portal.err('PO404', 'Este paso no tiene formulario');
  END IF;
  v_type := CASE it.kind WHEN 'contract' THEN 'contract' WHEN 'survey' THEN 'survey' ELSE 'custom' END;
  SELECT fo.id, fo.slug INTO f FROM public.forms fo
   WHERE fo.id = v_form_text::uuid AND fo.workspace_id = s.workspace_id AND fo.status = 'published'
     AND fo.archived_at IS NULL AND fo.type = v_type AND fo.slug IS NOT NULL;
  IF f.id IS NULL THEN PERFORM app_servicio_portal.err('PO404', 'Este formulario no está disponible ahora'); END IF;
  RETURN jsonb_build_object('workspace_id', s.workspace_id, 'form_id', f.id, 'slug', f.slug, 'contact_id', s.contact_id,
                            'service_id', s.id, 'sale_id', s.sale_id, 'item_id', it.id, 'kind', it.kind);
END;
$$;

REVOKE ALL ON FUNCTION app_servicio.portal_item_form_link(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_servicio.portal_item_form_link(text, uuid) TO service_role;
