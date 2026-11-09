-- @plantilla-quitar(servicios)
-- ============================================================================
-- 00330_app_servicio_core  (Servicios v12, Corrida A1 · S01 · bloque SV1)
-- ============================================================================
-- 1. Esquema `app_servicio` (lo del equipo). Se expone a la API con RLS de SOLO LECTURA:
--    USAGE para authenticated, sin politicas de escritura en ninguna tabla. Las tablas se
--    escriben solo con funciones del modulo (SECURITY DEFINER, validan permiso y negocio).
-- 2. `public.workspaces.services_enabled` (interruptor del modulo, F97): nace en false y NO tiene
--    pantalla (decision 447). Solo lo cambia la plataforma con `app_servicio.set_module_enabled`
--    (EXECUTE solo para service_role). `app_servicio.module_on(ws)` lo lee: todo trigger del modulo
--    sale al principio si da false.
-- 3. Guardia `trg_app_servicio_config_guard` (SV003): una sesion authenticated o anon no puede
--    cambiar `services_enabled` con un UPDATE directo; en un INSERT de esos roles queda en su default.
--    S03 extiende la misma guardia a las columnas de configuracion de workspaces, products y
--    product_variants.
-- 4. Tabla `app_servicio.services` (§8.2): las claves a contactos, productos y variantes son NO ACTION
--    (no RESTRICT): protegen igual (no se borra un contacto con servicios) pero se comprueban al final
--    de la sentencia, asi borrar un negocio entero no choca en el medio de la cascada (la misma regla
--    que la 00246). Tambien `app_servicio.can_see_service` (siempre true/false):
--    Owner y Admin; rol con `services.view` alcance `all`; o alcance `own` siendo responsable del
--    servicio o setter o vendedor de su contacto. RLS: SELECT con eso; sin INSERT/UPDATE/DELETE.
--    `app_servicio.can_view_as_student(contact)` (portal.view_as, mismo alcance) la usa "Ver como
--    estudiante" (bloque AC).
-- 5. Permisos: el Member de sistema suma `services.view` y `services.items` (alcance `own`) y
--    `portal.view_as` (alcance `own`) — cambio aprobado M11. Se redefine
--    `private.member_permission_keys()` COPIANDO la vigente en la base (00319) letra por letra y
--    sumando las tres claves al final. `affiliates.use` la suma la 00342 (S13).
--
-- Aditiva + modifica estructura existente (columna en workspaces) + modifica la lista del Member.
-- Va ANTES de desplegar el codigo. Con el modulo apagado (asi nace) no cambia nada de lo que existe.
--
-- Cómo volver atrás:
--   DROP TRIGGER IF EXISTS trg_app_servicio_config_guard ON public.workspaces;
--   DROP TRIGGER IF EXISTS trg_app_servicio_keep_contacts ON public.contacts;
--   DROP SCHEMA IF EXISTS app_servicio CASCADE;   -- (services vacia: el modulo nace apagado)
--   ALTER TABLE public.workspaces DROP COLUMN IF EXISTS services_enabled;
--   y `private.member_permission_keys()` vuelve a la definicion vigente antes de esta migracion,
--   copiada aca abajo tal cual la devolvio pg_get_functiondef el 8/11/2026:
--
--   CREATE OR REPLACE FUNCTION private.member_permission_keys()
--    RETURNS text[]
--    LANGUAGE sql
--    IMMUTABLE
--    SET search_path TO ''
--   AS $function$
--     SELECT ARRAY[
--       'dashboards.chat.view',
--       'contacts.view',
--       'contacts.edit',
--       'contacts.assign',
--       'flows.view',
--       'flows.edit',
--       'flows.publish',
--       'sequences.view',
--       'agents.view',
--       'content.view',
--       'content.create',
--       'scheduling.use',
--       'bookings.view',
--       'bookings.manage',
--       'calls.view',
--       'forms.view',
--       'sales.view',
--       'sales.manage',
--       'payments.manage',
--       'tasks.view',
--       'tasks.edit',
--       'commissions.view',
--       'designer.view',
--       'designer.edit'
--     ]::text[]
--   $function$;
--
-- Riesgo: medio (columna nueva en workspaces; el Member suma tres claves que solo se ven con el
-- modulo prendido).
-- ============================================================================

-- ─── 1. Esquema ─────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS app_servicio;
REVOKE ALL ON SCHEMA app_servicio FROM public, anon;
GRANT USAGE ON SCHEMA app_servicio TO authenticated, service_role;
-- Las funciones nuevas del esquema nacen sin EXECUTE para public (cada una lo declara igual).
ALTER DEFAULT PRIVILEGES IN SCHEMA app_servicio REVOKE EXECUTE ON FUNCTIONS FROM public;

-- ─── 2. El interruptor del modulo ───────────────────────────────────────────
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS services_enabled boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.workspaces.services_enabled IS
  'Modulo de Servicios prendido en este negocio (F97). Sin pantalla: lo cambia la plataforma con app_servicio.set_module_enabled (service_role). Apagado, ningun trigger del modulo hace nada (00330).';

CREATE OR REPLACE FUNCTION app_servicio.module_on(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE((SELECT w.services_enabled FROM public.workspaces w WHERE w.id = p_workspace_id), false);
$$;
REVOKE ALL ON FUNCTION app_servicio.module_on(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION app_servicio.module_on(uuid) TO authenticated, service_role;

-- ─── 3. La guardia de configuracion (SV003) ─────────────────────────────────
-- SECURITY INVOKER a proposito: mira el rol de quien escribe. Las funciones del modulo son
-- SECURITY DEFINER (corren como el dueño) y el servidor usa service_role: los dos pasan.
CREATE OR REPLACE FUNCTION app_servicio.config_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'workspaces' THEN
    IF TG_OP = 'INSERT' THEN
      -- Un alta hecha por una sesion nace sin el modulo (su default).
      NEW.services_enabled := false;
    ELSIF NEW.services_enabled IS DISTINCT FROM OLD.services_enabled THEN
      RAISE EXCEPTION 'La configuración del módulo se cambia desde sus pantallas' USING ERRCODE = 'SV003';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION app_servicio.config_guard() FROM public, anon;

DROP TRIGGER IF EXISTS trg_app_servicio_config_guard ON public.workspaces;
CREATE TRIGGER trg_app_servicio_config_guard
  BEFORE INSERT OR UPDATE ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION app_servicio.config_guard();

-- ─── 4. Servicios ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_servicio.services (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  contact_id           uuid NOT NULL REFERENCES public.contacts(id),
  product_id           uuid NOT NULL REFERENCES public.products(id),
  product_variant_id   uuid NULL REFERENCES public.product_variants(id),
  sale_id              uuid NULL REFERENCES public.sales(id) ON DELETE SET NULL,
  origin               text NOT NULL,
  origin_reason        text NULL,
  previous_service_id  uuid NULL REFERENCES app_servicio.services(id) ON DELETE SET NULL,
  status               text NOT NULL,
  starts_on            date NULL,
  ends_on              date NULL,
  owner_user_id        uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  product_snapshot     jsonb NOT NULL,
  price_cents          bigint NULL,
  currency             text NULL,
  progress_pct         numeric(5,2) NULL,
  light                text NOT NULL DEFAULT 'grey',
  light_reason         text NULL,
  light_at             timestamptz NULL,
  paused_at            timestamptz NULL,
  paused_days          integer NOT NULL DEFAULT 0,
  pause_cut_access     boolean NULL,
  pause_resume_on      date NULL,
  extension_sale_ids   uuid[] NOT NULL DEFAULT '{}',
  cancel_reason        text NULL,
  completed_at         timestamptz NULL,
  cancelled_at         timestamptz NULL,
  is_test              boolean NOT NULL DEFAULT false,
  flags                jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by           uuid NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT services_origin_check CHECK (origin IN ('sale', 'courtesy', 'test', 'manual', 'recovery')),
  CONSTRAINT services_status_check CHECK (status IN ('pending_confirmation', 'active', 'paused', 'completed', 'cancelled', 'renewed')),
  CONSTRAINT services_light_check CHECK (light IN ('green', 'yellow', 'red', 'grey')),
  CONSTRAINT services_dates_check CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on),
  CONSTRAINT services_owner_check CHECK (owner_user_id IS NOT NULL OR status IN ('pending_confirmation', 'cancelled')),
  CONSTRAINT services_reason_check CHECK (sale_id IS NOT NULL OR origin = 'sale' OR nullif(btrim(origin_reason), '') IS NOT NULL),
  CONSTRAINT services_is_test_check CHECK (is_test = (origin = 'test')),
  CONSTRAINT services_paused_days_check CHECK (paused_days >= 0),
  CONSTRAINT services_flags_check CHECK (jsonb_typeof(flags) = 'object'),
  CONSTRAINT services_snapshot_check CHECK (jsonb_typeof(product_snapshot) = 'object')
);
COMMENT ON TABLE app_servicio.services IS
  'El servicio de un cliente (Servicios v12, F4). Se escribe SOLO con app_servicio.svc_create_service y las funciones svc_* (00330/00333). Una venta, un servicio.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_services_sale ON app_servicio.services (sale_id) WHERE sale_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_services_ws_status ON app_servicio.services (workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_services_contact_product ON app_servicio.services (contact_id, product_id);
CREATE INDEX IF NOT EXISTS idx_services_owner_open ON app_servicio.services (owner_user_id) WHERE status IN ('active', 'paused');
CREATE INDEX IF NOT EXISTS idx_services_variant ON app_servicio.services (product_variant_id);
CREATE INDEX IF NOT EXISTS idx_services_previous ON app_servicio.services (previous_service_id) WHERE previous_service_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_services_extension_sales ON app_servicio.services USING gin (extension_sale_ids);

DROP TRIGGER IF EXISTS set_updated_at ON app_servicio.services;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON app_servicio.services
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE app_servicio.services ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_servicio.services FROM public, anon, authenticated;
GRANT SELECT ON app_servicio.services TO authenticated;
GRANT ALL ON app_servicio.services TO service_role;

-- Quien ve un servicio. Siempre true o false, nunca NULL.
CREATE OR REPLACE FUNCTION app_servicio.can_see_service_row(s app_servicio.services)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    public.is_workspace_member(s.workspace_id)
    AND public.has_permission(s.workspace_id, 'services.view')
    AND (
      public.permission_scope(s.workspace_id, 'services') = 'all'
      OR s.owner_user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.contacts c
        WHERE c.id = s.contact_id AND (c.setter_id = auth.uid() OR c.vendedor_id = auth.uid())
      )
    ),
    false);
$$;
REVOKE ALL ON FUNCTION app_servicio.can_see_service_row(app_servicio.services) FROM public, anon;
GRANT EXECUTE ON FUNCTION app_servicio.can_see_service_row(app_servicio.services) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.can_see_service(p_service_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE((SELECT app_servicio.can_see_service_row(s) FROM app_servicio.services s WHERE s.id = p_service_id), false);
$$;
REVOKE ALL ON FUNCTION app_servicio.can_see_service(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION app_servicio.can_see_service(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS services_select ON app_servicio.services;
CREATE POLICY services_select ON app_servicio.services
  FOR SELECT TO authenticated
  USING (app_servicio.can_see_service_row(services));

-- "Ver como estudiante" (F42): portal.view_as con el alcance de services (own = un servicio del
-- contacto donde es responsable, o setter o vendedor del contacto). Siempre true o false.
CREATE OR REPLACE FUNCTION app_servicio.can_view_as_student(p_workspace_id uuid, p_contact_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    public.is_workspace_member(p_workspace_id)
    AND public.has_permission(p_workspace_id, 'portal.view_as')
    AND (
      public.permission_scope(p_workspace_id, 'services') = 'all'
      OR EXISTS (
        SELECT 1 FROM public.contacts c
        WHERE c.id = p_contact_id AND c.workspace_id = p_workspace_id
          AND (c.setter_id = auth.uid() OR c.vendedor_id = auth.uid())
      )
      OR EXISTS (
        SELECT 1 FROM app_servicio.services s
        WHERE s.workspace_id = p_workspace_id AND s.contact_id = p_contact_id AND s.owner_user_id = auth.uid()
      )
    ),
    false);
$$;
REVOKE ALL ON FUNCTION app_servicio.can_view_as_student(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION app_servicio.can_view_as_student(uuid, uuid) TO authenticated, service_role;

-- La purga diaria de BAIOS (`purge_soft_deleted`) borra de verdad los contactos borrados hace mas de
-- 30 dias que no tienen ventas. Un contacto con un servicio (cortesia, prueba, a mano) no se puede
-- borrar (FK RESTRICT): en vez de hacer fallar la purga de toda la instalacion, este trigger saltea
-- ese contacto (BEFORE DELETE que devuelve NULL = esa fila no se borra, sin error). Vale aunque el
-- modulo este apagado: protege datos que ya existen. Si algo falla, deja seguir (y la FK decide).
CREATE OR REPLACE FUNCTION app_servicio.keep_contacts_with_services()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Dentro de una cascada (se borra el negocio entero) no se saltea nada.
  IF pg_trigger_depth() > 1 THEN RETURN OLD; END IF;
  BEGIN
    IF EXISTS (SELECT 1 FROM app_servicio.services s WHERE s.contact_id = OLD.id) THEN
      RETURN NULL;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'app_servicio.keep_contacts_with_services: %', SQLERRM;
  END;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION app_servicio.keep_contacts_with_services() FROM public, anon;

DROP TRIGGER IF EXISTS trg_app_servicio_keep_contacts ON public.contacts;
CREATE TRIGGER trg_app_servicio_keep_contacts
  BEFORE DELETE ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION app_servicio.keep_contacts_with_services();

-- ─── 5. Prender y apagar el modulo (solo la plataforma) ─────────────────────
CREATE OR REPLACE FUNCTION app_servicio.set_module_enabled(p_workspace_id uuid, p_enabled boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_before boolean;
  v_active integer;
BEGIN
  SELECT services_enabled INTO v_before FROM public.workspaces WHERE id = p_workspace_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No existe el negocio' USING ERRCODE = 'SV002';
  END IF;
  SELECT count(*) INTO v_active FROM app_servicio.services
   WHERE workspace_id = p_workspace_id AND status IN ('active', 'paused', 'pending_confirmation');
  IF v_before IS DISTINCT FROM p_enabled THEN
    UPDATE public.workspaces SET services_enabled = p_enabled WHERE id = p_workspace_id;
    INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, actor_type, actor_label)
    VALUES (p_workspace_id, 'workspace', p_workspace_id, 'svc.module_toggled',
            jsonb_build_object('services_enabled', jsonb_build_object('old', v_before, 'new', p_enabled), 'active_services', v_active),
            'system', 'plataforma');
  END IF;
  RETURN jsonb_build_object(
    'enabled', p_enabled,
    'changed', v_before IS DISTINCT FROM p_enabled,
    'active_services', v_active,
    'message', CASE WHEN NOT p_enabled AND v_active > 0
      THEN format('Hay %s servicios activos: quedan como están, pero no avanzan solos mientras el módulo esté apagado', v_active)
      ELSE NULL END
  );
END;
$$;
REVOKE ALL ON FUNCTION app_servicio.set_module_enabled(uuid, boolean) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_servicio.set_module_enabled(uuid, boolean) TO service_role;

-- ─── 6. El Member de sistema (cambio aprobado M11) ──────────────────────────
-- Copia de la vigente (00319) letra por letra + services.view, services.items y portal.view_as.
CREATE OR REPLACE FUNCTION private.member_permission_keys()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT ARRAY[
    'dashboards.chat.view',
    'contacts.view',
    'contacts.edit',
    'contacts.assign',
    'flows.view',
    'flows.edit',
    'flows.publish',
    'sequences.view',
    'agents.view',
    'content.view',
    'content.create',
    'scheduling.use',
    'bookings.view',
    'bookings.manage',
    'calls.view',
    'forms.view',
    'sales.view',
    'sales.manage',
    'payments.manage',
    'tasks.view',
    'tasks.edit',
    'commissions.view',
    'designer.view',
    'designer.edit',
    'services.view',
    'services.items',
    'portal.view_as'
  ]::text[]
$function$;
