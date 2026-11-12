-- ============================================================
-- 00371_service_capacity.sql
-- ============================================================
-- Servicios A4 (plano: A4-M8), F151: tope de cartera por persona.
--
--   * `workspaces.service_team_settings` = {"capacity": {"<user_id>": 1..1000}} y `service_team_settings_rev` (para
--     no pisar un cambio de otra persona). Vacio = sin topes. Lo escribe el servidor (Ajustes › Productos › «Reparto de
--     clientes», con `services.configure`).
--   * Reescribe `svc_owner_pick_rr` y `svc_owner_pick_plan` (gemela de `pickOwner`, lib/services/engine-rules.ts, con
--     `owner-pick.cases.json`): el reparto equitativo y las condiciones saltean a quien llego a su tope. Si todos
--     estan llenos, va al respaldo de la variante (F96) y devuelve `capacityFull: true`. **Sin topes cargados elige
--     exactamente igual que antes** (los casos de siempre siguen iguales). La persona fija y «la anterior» no se frenan.
--   * Reescribe `svc_pick_owner` para pasarle los topes y cuantos servicios tiene hoy cada persona (activos, pausados o
--     por confirmar, de todos los productos).
--   * `app_servicio.capacity_notice_hook()`: AFTER INSERT en app_servicio.services. Si el servicio nacio a nombre del
--     respaldo por los topes, avisa `svc_capacity_full` a Owner y Admin. Nunca hace fallar el alta.
--
-- Las definiciones viejas estan en docs/servicios/definiciones-viejas-a4.sql. Como volver atras: correr las de
-- svc_owner_pick_rr, svc_owner_pick_plan y svc_pick_owner, y
--   DROP TRIGGER IF EXISTS trg_app_servicio_capacity_notice ON app_servicio.services;
--   DROP FUNCTION IF EXISTS app_servicio.capacity_notice_hook(), app_servicio.svc_at_capacity(jsonb, text), app_servicio.svc_owner_loads(uuid);
--   ALTER TABLE public.workspaces DROP COLUMN IF EXISTS service_team_settings, DROP COLUMN IF EXISTS service_team_settings_rev;

ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS service_team_settings jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS service_team_settings_rev integer NOT NULL DEFAULT 0;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspaces_service_team_settings_check') THEN
    ALTER TABLE public.workspaces ADD CONSTRAINT workspaces_service_team_settings_check CHECK (jsonb_typeof(service_team_settings) = 'object');
  END IF;
END $$;
COMMENT ON COLUMN public.workspaces.service_team_settings IS
  'Servicios A4 (F151): {"capacity": {"<user_id>": n}} el tope de servicios a cargo de cada persona. Vacio = sin topes.';

-- Si la persona llego a su tope (gemela de atCapacity).
CREATE OR REPLACE FUNCTION app_servicio.svc_at_capacity(p jsonb, p_user text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE WHEN jsonb_typeof(p -> 'capacity' -> p_user) = 'number'
              THEN COALESCE((p -> 'loadCounts' ->> p_user)::numeric, 0) >= (p -> 'capacity' ->> p_user)::numeric
              ELSE false END;
$$;
REVOKE ALL ON FUNCTION app_servicio.svc_at_capacity(jsonb, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION app_servicio.svc_owner_pick_rr(p jsonb, p_members jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT m FROM jsonb_array_elements_text(COALESCE(p_members, '[]'::jsonb)) m
  WHERE (p -> 'activeMembers') ? m
    -- A4 (F151): quien llego a su tope no recibe.
    AND NOT app_servicio.svc_at_capacity(p, m)
  ORDER BY COALESCE((p -> 'activeCounts' ->> m)::integer, 0), COALESCE(p -> 'lastAssignedAt' ->> m, ''), m
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION app_servicio.svc_owner_pick_plan(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE
  v text;
  live jsonb := COALESCE(p -> 'activeMembers', '[]'::jsonb);
  v_without jsonb;
BEGIN
  CASE p ->> 'mode'
    WHEN 'fixed' THEN v := CASE WHEN live ? (p ->> 'userId') THEN p ->> 'userId' END;
    WHEN 'round_robin' THEN v := app_servicio.svc_owner_pick_rr(p, p -> 'members');
    WHEN 'previous' THEN v := CASE WHEN live ? (p ->> 'previousOwner') THEN p ->> 'previousOwner' END;
    WHEN 'conditions' THEN
      v := CASE WHEN live ? (p ->> 'conditionUserId') AND NOT app_servicio.svc_at_capacity(p, p ->> 'conditionUserId') THEN p ->> 'conditionUserId' END;
      IF v IS NULL AND jsonb_typeof(p -> 'conditionMembers') = 'array' THEN v := app_servicio.svc_owner_pick_rr(p, p -> 'conditionMembers'); END IF;
      IF v IS NULL AND jsonb_array_length(COALESCE(p -> 'members', '[]'::jsonb)) > 0 THEN v := app_servicio.svc_owner_pick_rr(p, p -> 'members'); END IF;
    ELSE v := NULL;
  END CASE;
  IF v IS NOT NULL THEN RETURN jsonb_build_object('userId', v, 'usedFallback', false); END IF;
  -- A4 (F151): si sin los topes hubiera habido alguien, el respaldo fue por los topes: se avisa.
  IF jsonb_typeof(p -> 'capacity') = 'object' AND p -> 'capacity' <> '{}'::jsonb AND p ->> 'mode' IN ('round_robin', 'conditions') THEN
    v_without := app_servicio.svc_owner_pick_plan(p || jsonb_build_object('capacity', '{}'::jsonb));
    IF (v_without ->> 'usedFallback')::boolean IS FALSE THEN
      RETURN jsonb_build_object('userId', CASE WHEN live ? (p ->> 'fallback') THEN p ->> 'fallback' END, 'usedFallback', true, 'capacityFull', true);
    END IF;
  END IF;
  RETURN jsonb_build_object('userId', CASE WHEN live ? (p ->> 'fallback') THEN p ->> 'fallback' END, 'usedFallback', true);
END;
$function$;

CREATE OR REPLACE FUNCTION app_servicio.svc_pick_owner(p_variant_id uuid, p_contact_id uuid, p_previous_owner uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_var public.product_variants;
  o jsonb;
  v_live jsonb; v_counts jsonb; v_last jsonb;
  v_ctx jsonb; r jsonb; v_cond_user text := NULL; v_cond_members jsonb := NULL;
BEGIN
  SELECT * INTO v_var FROM public.product_variants WHERE id = p_variant_id;
  o := COALESCE(v_var.service_settings -> 'owner', '{}'::jsonb);
  SELECT COALESCE(jsonb_agg(m.user_id::text), '[]'::jsonb) INTO v_live FROM public.workspace_members m WHERE m.workspace_id = v_var.workspace_id;
  SELECT COALESCE(jsonb_object_agg(owner_user_id::text, n), '{}'::jsonb) INTO v_counts
    FROM (SELECT s.owner_user_id, count(*) n FROM app_servicio.services s
          WHERE s.product_id = v_var.product_id AND s.status IN ('active','paused') AND s.owner_user_id IS NOT NULL GROUP BY 1) t;
  SELECT COALESCE(jsonb_object_agg(owner_user_id::text, last_at), '{}'::jsonb) INTO v_last
    FROM (SELECT s.owner_user_id, to_char(max(s.created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') last_at FROM app_servicio.services s
          WHERE s.product_id = v_var.product_id AND s.owner_user_id IS NOT NULL GROUP BY 1) t;
  IF o ->> 'mode' = 'conditions' THEN
    v_ctx := app_servicio.svc_contact_context(p_contact_id);
    FOR r IN SELECT x FROM jsonb_array_elements(COALESCE(o -> 'conditions', '[]'::jsonb)) x LOOP
      CONTINUE WHEN COALESCE((r ->> 'is_active')::boolean, true) = false;
      IF app_servicio.svc_conditions_match(r -> 'conditions', v_ctx) THEN
        IF r #>> '{destination,type}' = 'user' THEN v_cond_user := r #>> '{destination,user_id}';
        ELSIF r #>> '{destination,type}' = 'round_robin' THEN v_cond_members := r #> '{destination,members}';
        END IF;
        EXIT;
      END IF;
    END LOOP;
  END IF;
  RETURN app_servicio.svc_owner_pick_plan(jsonb_build_object(
    'mode', o ->> 'mode', 'userId', o ->> 'user_id', 'members', COALESCE(o -> 'members', '[]'::jsonb),
    'activeCounts', v_counts, 'lastAssignedAt', v_last, 'conditionUserId', v_cond_user, 'conditionMembers', v_cond_members,
    'previousOwner', p_previous_owner::text, 'fallback', o ->> 'fallback_user_id', 'activeMembers', v_live,
    -- A4 (F151): los topes de cartera y cuántos servicios tiene hoy cada persona (de TODOS los productos).
    'capacity', COALESCE((SELECT w.service_team_settings -> 'capacity' FROM public.workspaces w WHERE w.id = v_var.workspace_id), '{}'::jsonb),
    'loadCounts', (SELECT COALESCE(jsonb_object_agg(owner_user_id::text, n), '{}'::jsonb)
                     FROM (SELECT s.owner_user_id, count(*) n FROM app_servicio.services s
                            WHERE s.workspace_id = v_var.workspace_id AND s.status IN ('active','paused','pending_confirmation')
                              AND s.owner_user_id IS NOT NULL GROUP BY 1) t)));
END;
$function$;

-- El aviso de «nadie del reparto tenia lugar». Nunca hace fallar el alta.
CREATE OR REPLACE FUNCTION app_servicio.capacity_notice_hook()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_pick jsonb;
BEGIN
  IF NOT app_servicio.module_on(NEW.workspace_id) THEN RETURN NULL; END IF;
  IF COALESCE(NEW.flags ->> 'owner_fallback', 'false') <> 'true' OR NEW.product_variant_id IS NULL THEN RETURN NULL; END IF;
  BEGIN
    v_pick := app_servicio.svc_pick_owner(NEW.product_variant_id, NEW.contact_id);
    IF (v_pick ->> 'capacityFull')::boolean IS TRUE THEN
      PERFORM app_servicio.notify_admins(NEW.workspace_id, 'svc_capacity_full', 'Nadie del reparto tenía lugar',
        'Todas las personas del reparto llegaron a su tope y el servicio quedó a nombre de la persona de respaldo.',
        'service', NEW.id, '{}'::jsonb);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    PERFORM app_servicio.hook_failed(NEW.workspace_id, 'capacity_notice', SQLSTATE || ' ' || SQLERRM, NEW.id);
  END;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION app_servicio.capacity_notice_hook() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_app_servicio_capacity_notice ON app_servicio.services;
CREATE TRIGGER trg_app_servicio_capacity_notice
  AFTER INSERT ON app_servicio.services
  FOR EACH ROW EXECUTE FUNCTION app_servicio.capacity_notice_hook();

-- Cuántos servicios tiene hoy cada persona (activos, pausados o por confirmar, de todos los productos), para la
-- pantalla «Reparto de clientes» y el aviso «Supera su tope» al asignar a mano. Solo el servidor (lo llama después de
-- chequear el permiso, con el negocio de la sesión).
CREATE OR REPLACE FUNCTION app_servicio.svc_owner_loads(p_workspace_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(jsonb_object_agg(owner_user_id::text, n), '{}'::jsonb)
    FROM (SELECT s.owner_user_id, count(*) n FROM app_servicio.services s
           WHERE s.workspace_id = p_workspace_id AND s.status IN ('active','paused','pending_confirmation')
             AND s.owner_user_id IS NOT NULL GROUP BY 1) t;
$$;
REVOKE ALL ON FUNCTION app_servicio.svc_owner_loads(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_servicio.svc_owner_loads(uuid) TO service_role;
