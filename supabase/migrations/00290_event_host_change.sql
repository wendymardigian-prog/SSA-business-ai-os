-- ============================================================================
-- 00290 — Cambiar el anfitrion de un evento, sin romper el link que ya se compartio
-- ============================================================================
-- El link publico de un evento lleva el usuario de su anfitrion
-- (/calendario/<usuario>/<slug>), asi que cambiar de anfitrion cambia el link. Ese
-- link ya puede estar en anuncios, bios, webs y embeds:
--
--   1. `event_type_moved_links` recuerda los links anteriores de un evento. El link
--      viejo sigue abriendo el evento (`findPublicEvent`), con el anfitrion de hoy y
--      con el slug de hoy: guarda el evento, no un destino, asi no hay cadenas.
--      Un evento real en ese mismo link siempre le gana.
--   2. `change_event_type_host` hace el cambio en una sola transaccion: el duenio, la
--      limpieza de lo que era de la persona anterior (horario y calendarios, que
--      apuntan a filas suyas) y el link anterior. Solo service_role: el permiso lo
--      chequea la accion (`changeEventHost`) antes de llamarla.
--
-- Las reuniones ya agendadas NO se tocan: conservan su `host_user_id`.
--
-- Aditiva. Orden: ANTES de desplegar el codigo (el editor llama a la funcion y la
-- pagina publica lee la tabla).
--
-- Como volver atras:
--   DROP FUNCTION IF EXISTS public.change_event_type_host(uuid, uuid, uuid, uuid);
--   DROP TABLE IF EXISTS public.event_type_moved_links;

CREATE TABLE IF NOT EXISTS public.event_type_moved_links (
  -- En minusculas: el usuario es unico en toda la instalacion (00266).
  username      text NOT NULL,
  slug          text NOT NULL,
  workspace_id  uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  event_type_id uuid NOT NULL REFERENCES public.event_types(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (username, slug)
);

COMMENT ON TABLE public.event_type_moved_links IS
  'Links anteriores de un evento que cambio de anfitrion. Los lee y los escribe solo el servidor.';

CREATE INDEX IF NOT EXISTS idx_event_type_moved_links_event
  ON public.event_type_moved_links (event_type_id);
CREATE INDEX IF NOT EXISTS idx_event_type_moved_links_workspace
  ON public.event_type_moved_links (workspace_id);

-- Sin politicas a proposito: nadie la lee ni la escribe con su sesion.
ALTER TABLE public.event_type_moved_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_type_moved_links FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.event_type_moved_links TO service_role;

CREATE OR REPLACE FUNCTION public.change_event_type_host(
  p_workspace_id uuid,
  p_event_type_id uuid,
  p_expected_host_id uuid,
  p_new_host_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_owner uuid;
  v_slug text;
  v_old_username text;
  v_new_username text;
BEGIN
  -- El candado evita que dos cambios a la vez dejen un link anterior equivocado.
  SELECT owner_user_id, slug INTO v_owner, v_slug
  FROM public.event_types
  WHERE id = p_event_type_id
    AND workspace_id = p_workspace_id
    AND deleted_at IS NULL
    AND is_internal = false
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  -- Otra persona lo cambio mientras esta pantalla estaba abierta.
  IF v_owner <> p_expected_host_id THEN
    RETURN jsonb_build_object('status', 'stale');
  END IF;
  IF p_new_host_id = v_owner THEN
    RETURN jsonb_build_object('status', 'same_host');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = p_workspace_id AND user_id = p_new_host_id
  ) THEN
    RETURN jsonb_build_object('status', 'not_member');
  END IF;

  SELECT username INTO v_new_username
  FROM public.scheduling_profiles
  WHERE workspace_id = p_workspace_id AND user_id = p_new_host_id;
  IF v_new_username IS NULL THEN
    RETURN jsonb_build_object('status', 'no_profile');
  END IF;

  SELECT username INTO v_old_username
  FROM public.scheduling_profiles
  WHERE workspace_id = p_workspace_id AND user_id = v_owner;

  BEGIN
    UPDATE public.event_types
    SET owner_user_id = p_new_host_id,
        -- Apuntaban a filas de la persona anterior. Sin elegir, el evento usa el
        -- horario y los calendarios por defecto de quien atiende.
        schedule_id = NULL,
        destination_calendar_id = NULL,
        conflict_calendar_ids = '{}'
    WHERE id = p_event_type_id;
  EXCEPTION WHEN unique_violation THEN
    -- `uq_event_types_owner_slug`: la persona nueva ya tiene un evento con ese link.
    RETURN jsonb_build_object('status', 'slug_taken');
  END;

  IF v_old_username IS NOT NULL THEN
    INSERT INTO public.event_type_moved_links (username, slug, workspace_id, event_type_id)
    VALUES (lower(v_old_username), v_slug, p_workspace_id, p_event_type_id)
    ON CONFLICT (username, slug) DO UPDATE
      SET workspace_id = EXCLUDED.workspace_id,
          event_type_id = EXCLUDED.event_type_id,
          created_at = now();
  END IF;

  -- Si el evento vuelve a un link que ya fue suyo, ese link es otra vez el real.
  DELETE FROM public.event_type_moved_links
  WHERE username = lower(v_new_username) AND slug = v_slug;

  RETURN jsonb_build_object('status', 'ok', 'old_username', v_old_username, 'new_username', v_new_username, 'slug', v_slug);
END;
$$;

REVOKE ALL ON FUNCTION public.change_event_type_host(uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.change_event_type_host(uuid, uuid, uuid, uuid) TO service_role;
