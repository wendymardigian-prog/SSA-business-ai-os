-- @plantilla-quitar(servicios)
-- 00381 · Corrida A3 · F129: la configuración de puntos del programa pide el permiso de puntos (Wendy dijo que sí, 15/11).
--
-- Hasta acá, `portal_admin_save_program_settings` pedía `portal.sections` para la clave `points` (caía en el ELSE).
-- Ahora la clave `points` pide `portal.points` («Puntos del programa»), igual que el ajuste a mano y «Calcular lo ya
-- hecho». Las demás claves piden lo mismo que antes. No toca datos ni permisos de ejecución.
--
-- Volver atrás: correr la definición vieja de `docs/servicios/definiciones-viejas-a3.sql` (── 00381 ──).

CREATE OR REPLACE FUNCTION app_servicio.portal_admin_save_program_settings(p_product_id uuid, p_patch jsonb, p_rev integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_row public.products;
  v_new jsonb;
  v_problems text[];
  k text;
BEGIN
  SELECT * INTO v_row FROM public.products WHERE id = p_product_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'No existe el producto' USING ERRCODE = 'SV002'; END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN RAISE EXCEPTION 'El cambio no es válido' USING ERRCODE = 'SV001'; END IF;
  FOR k IN SELECT jsonb_object_keys(p_patch) LOOP
    PERFORM app_servicio.require_permission(v_row.workspace_id, CASE k
      WHEN 'sections' THEN 'portal.sections'
      WHEN 'terms' THEN 'portal.sections'
      WHEN 'affiliates' THEN 'portal.sections'
      WHEN 'community' THEN 'community.spaces'
      WHEN 'assistant' THEN 'tutor.manage'
      WHEN 'points' THEN 'portal.points'
      ELSE 'portal.sections' END);
  END LOOP;
  v_new := COALESCE(v_row.portal_settings, '{}'::jsonb) || p_patch;
  v_problems := app_servicio.validate_program_portal_settings(v_new, p_product_id);
  IF array_length(v_problems, 1) > 0 THEN
    RETURN jsonb_build_object('status', 'invalid', 'problems', to_jsonb(v_problems));
  END IF;
  UPDATE public.products
     SET portal_settings = v_new, portal_settings_rev = portal_settings_rev + 1
   WHERE id = p_product_id AND portal_settings_rev = p_rev;
  IF NOT FOUND THEN
    SELECT * INTO v_row FROM public.products WHERE id = p_product_id;
    RETURN jsonb_build_object('status', 'conflict', 'current', v_row.portal_settings, 'rev', v_row.portal_settings_rev);
  END IF;
  INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, performed_by, actor_type)
  VALUES (v_row.workspace_id, 'product', p_product_id, 'svc.config_saved',
          jsonb_build_object('part', 'program', 'keys', (SELECT jsonb_agg(x) FROM jsonb_object_keys(p_patch) x)), auth.uid(), 'user');
  RETURN jsonb_build_object('status', 'ok', 'rev', p_rev + 1, 'current', v_new);
END;
$$;
