-- ============================================================================
-- 00501_security_affiliates_services  (Auditoría de seguridad del 19/11/2026, parte 2)
-- ============================================================================
-- 1. `public.affiliate_set_sale` (00343) escribía el afiliado de una venta sin mirar que fuera de ESE negocio.
--    Con el cliente de servicio (`setNewSaleAffiliate`, el asistente de venta) se saltean los chequeos de sesión,
--    así que un vendedor podía poner como afiliado a un usuario de otro negocio, o a un contacto que nunca fue
--    afiliado, y la comisión se le generaba a ese id. Ahora la misma regla que `affiliate_set_contact`: un usuario
--    tiene que ser miembro del negocio de la venta, y un contacto, de ese negocio y con código de afiliado. Vale con
--    o sin sesión. El resto de la función es idéntico a `pg_get_functiondef` de producción del 19/11/2026.
--
-- 2. `public.affiliate_by_code` (00343) quedó habilitada para `authenticated` (la 00343 revocó solo PUBLIC y anon y
--    la 00000 se la da a authenticated por defecto): cualquier usuario logueado traducía el código de afiliado de
--    OTRO negocio en su user_id o contact_id. La usan solo funciones de la base (`affiliate_assign`, que es
--    SECURITY DEFINER): queda para `service_role`.
--
-- 3. (Servicios) `previous_service_id` tiene que ser un servicio del MISMO negocio. `svc_create_service` lo
--    guardaba tal cual venía en el payload. Se cuida con un trigger en la tabla del módulo (no se reescribe la
--    función de 300 líneas). Lanza a propósito: es una tabla de Servicios, no de BAIOS.
--
-- Aditiva en datos. Puede ir antes o después del deploy.
-- Volver atrás: la definición vieja de affiliate_set_sale es la de la 00343 (líneas 656-690);
--   GRANT EXECUTE ON FUNCTION public.affiliate_by_code(uuid, text) TO authenticated;
--   DROP TRIGGER IF EXISTS trg_services_previous_same_workspace ON app_servicio.services;
-- ============================================================================

-- ─── 1. El afiliado de una venta es de ese negocio ──────────────────────────
CREATE OR REPLACE FUNCTION public.affiliate_set_sale(p_sale_id uuid, p_affiliate jsonb, p_kind text, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s public.sales;
BEGIN
  SELECT * INTO s FROM public.sales WHERE id = p_sale_id FOR UPDATE;
  IF s.id IS NULL THEN RAISE EXCEPTION 'No existe la venta' USING ERRCODE = 'AF002'; END IF;
  IF auth.uid() IS NOT NULL THEN
    IF NOT (public.has_permission(s.workspace_id, 'affiliates.assign') AND public.can_see_sale(s)) THEN
      RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'AF010';
    END IF;
    IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN RAISE EXCEPTION 'Escribí el motivo' USING ERRCODE = 'AF011'; END IF;
  END IF;
  IF p_affiliate IS NOT NULL AND (p_affiliate ->> 'type') = 'contact' AND (p_affiliate ->> 'id')::uuid = s.contact_id THEN
    RAISE EXCEPTION 'El afiliado no puede ser el que compra' USING ERRCODE = 'AF012';
  END IF;
  -- 00501: el afiliado tiene que ser de este negocio (como en affiliate_set_contact), con o sin sesión.
  IF p_affiliate IS NOT NULL AND (p_affiliate ->> 'type') = 'user'
     AND NOT EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.workspace_id = s.workspace_id AND m.user_id = (p_affiliate ->> 'id')::uuid) THEN
    RAISE EXCEPTION 'Esa persona no es del equipo' USING ERRCODE = 'AF002';
  END IF;
  IF p_affiliate IS NOT NULL AND (p_affiliate ->> 'type') = 'contact'
     AND NOT EXISTS (SELECT 1 FROM public.contacts x WHERE x.workspace_id = s.workspace_id AND x.id = (p_affiliate ->> 'id')::uuid AND x.affiliate_code IS NOT NULL) THEN
    RAISE EXCEPTION 'Ese contacto no es afiliado' USING ERRCODE = 'AF002';
  END IF;
  IF p_affiliate IS NOT NULL AND COALESCE(p_affiliate ->> 'type', '') NOT IN ('user', 'contact') THEN
    RAISE EXCEPTION 'Afiliado no válido' USING ERRCODE = 'AF002';
  END IF;
  PERFORM set_config('app.affiliates_internal', 'on', true);
  UPDATE public.sales SET
    affiliate_user_id = CASE WHEN p_affiliate ->> 'type' = 'user' THEN (p_affiliate ->> 'id')::uuid END,
    affiliate_contact_id = CASE WHEN p_affiliate ->> 'type' = 'contact' THEN (p_affiliate ->> 'id')::uuid END,
    affiliate_kind = CASE WHEN p_affiliate IS NULL THEN NULL ELSE COALESCE(p_kind, 'influenced') END
  WHERE id = s.id;
  PERFORM set_config('app.affiliates_internal', 'off', true);
  INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, metadata, performed_by)
  VALUES (s.workspace_id, 'sale', s.id, 'affiliate.sale_set',
          jsonb_build_object('affiliate', jsonb_build_object('old', COALESCE(s.affiliate_user_id::text, s.affiliate_contact_id::text), 'new', p_affiliate ->> 'id')),
          jsonb_build_object('reason', NULLIF(btrim(COALESCE(p_reason, '')), ''), 'kind', p_kind), auth.uid());
  IF p_affiliate IS NOT NULL AND s.affiliate_user_id IS NULL AND s.affiliate_contact_id IS NULL THEN
    PERFORM public.emit_automation_event(s.workspace_id, 'affiliate_sale_created', s.contact_id,
      jsonb_build_object('sale_id', s.id, 'affiliate_type', p_affiliate ->> 'type', 'affiliate_id', p_affiliate ->> 'id', 'affiliate_kind', COALESCE(p_kind, 'influenced')));
  END IF;
END;
$$;
-- Los permisos no cambian (CREATE OR REPLACE los conserva).

-- ─── 2. Traducir un código de afiliado es cosa del servidor ─────────────────
REVOKE ALL ON FUNCTION public.affiliate_by_code(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.affiliate_by_code(uuid, text) TO service_role;

-- ─── 3. Servicios: el servicio anterior es del mismo negocio ────────────────
-- @plantilla-desde(servicios)
CREATE OR REPLACE FUNCTION app_servicio.services_previous_same_workspace()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.previous_service_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM app_servicio.services p WHERE p.id = NEW.previous_service_id AND p.workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'El servicio anterior no es de este negocio' USING ERRCODE = 'SV002';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION app_servicio.services_previous_same_workspace() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_services_previous_same_workspace ON app_servicio.services;
CREATE TRIGGER trg_services_previous_same_workspace
  BEFORE INSERT OR UPDATE OF previous_service_id ON app_servicio.services
  FOR EACH ROW EXECUTE FUNCTION app_servicio.services_previous_same_workspace();
-- @plantilla-hasta(servicios)
