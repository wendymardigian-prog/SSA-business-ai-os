-- ============================================================
-- 00360_table_views.sql
--
-- Vistas guardadas de las tablas (Ventas, Pagos y las que se migren al componente de tabla unico).
--
-- Una VISTA guarda como se mira una tabla: columnas (cuales, en que orden, fijas, anchos) y filtros.
--   * Cada persona crea las suyas (privadas) y marca UNA como predeterminada por tabla.
--   * Owner y Admin pueden compartirlas: con todo el equipo ('workspace') o con personas elegidas ('selected'),
--     y dejarlas como predeterminada de otras personas ("favorita" de ellas).
--
-- Tablas:
--   table_views          la vista (dueno, visibilidad, configuracion jsonb).
--   table_view_members   a quien se le muestra una vista 'selected'.
--   table_view_defaults  la vista predeterminada de cada persona por tabla (una por persona y tabla).
--
-- Quien lee: la RLS. Quien escribe: SOLO las funciones de abajo (SECURITY DEFINER, miran auth.uid() y el
-- rol dentro de la funcion). Las tablas no tienen politicas de INSERT/UPDATE/DELETE para `authenticated`.
--
-- Sin permiso nuevo en el catalogo de roles: crear y usar vistas propias es una preferencia personal; compartir y
-- asignar es de Owner y Admin por su ROL (`is_workspace_admin`).
--
-- Aditiva: se aplica ANTES de desplegar el codigo (las pantallas leen estas tablas).
--
-- Como volver atras:
--   DROP FUNCTION IF EXISTS public.set_table_view_default(uuid, text, uuid, uuid[]);
--   DROP FUNCTION IF EXISTS public.delete_table_view(uuid);
--   DROP FUNCTION IF EXISTS public.save_table_view(uuid, uuid, text, text, jsonb, text, uuid[]);
--   DROP TABLE IF EXISTS public.table_view_defaults, public.table_view_members, public.table_views;
--   DROP FUNCTION IF EXISTS public.table_view_visible_to(uuid, uuid);
--   DROP FUNCTION IF EXISTS public.table_view_workspace(uuid);
-- Riesgo: bajo. Tablas y funciones nuevas; no cambia nada existente.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.table_views (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- Que tabla es ('sales', 'payments'...). Texto libre acotado: sumar una tabla no pide migracion.
  table_key    text NOT NULL,
  name         text NOT NULL,
  -- { v: 1, columns: { order, hidden, shown, pinned, widths }, filters: "estado=paid&..." }
  config       jsonb NOT NULL DEFAULT '{}'::jsonb,
  owner_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- private = solo el dueno; workspace = todo el equipo; selected = las personas de table_view_members.
  visibility   text NOT NULL DEFAULT 'private',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'table_views_table_key_check') THEN
    ALTER TABLE public.table_views ADD CONSTRAINT table_views_table_key_check CHECK (table_key ~ '^[a-z][a-z0-9_]{1,40}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'table_views_name_check') THEN
    ALTER TABLE public.table_views ADD CONSTRAINT table_views_name_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 60);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'table_views_config_check') THEN
    ALTER TABLE public.table_views ADD CONSTRAINT table_views_config_check
      CHECK (jsonb_typeof(config) = 'object' AND pg_column_size(config) < 20000);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'table_views_visibility_check') THEN
    ALTER TABLE public.table_views ADD CONSTRAINT table_views_visibility_check CHECK (visibility IN ('private', 'workspace', 'selected'));
  END IF;
END $$;

-- Una persona no repite el nombre de una vista en la misma tabla.
CREATE UNIQUE INDEX IF NOT EXISTS uq_table_views_owner_name
  ON public.table_views (workspace_id, owner_id, table_key, lower(btrim(name)));
CREATE INDEX IF NOT EXISTS idx_table_views_lookup
  ON public.table_views (workspace_id, table_key, visibility);

CREATE TABLE IF NOT EXISTS public.table_view_members (
  view_id    uuid NOT NULL REFERENCES public.table_views(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (view_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_table_view_members_user ON public.table_view_members (user_id);

CREATE TABLE IF NOT EXISTS public.table_view_defaults (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  table_key    text NOT NULL,
  view_id      uuid NOT NULL REFERENCES public.table_views(id) ON DELETE CASCADE,
  -- Quien la dejo como predeterminada si no fue la propia persona (un Owner o Admin).
  assigned_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id, table_key)
);
CREATE INDEX IF NOT EXISTS idx_table_view_defaults_view ON public.table_view_defaults (view_id);

DROP TRIGGER IF EXISTS set_updated_at ON public.table_views;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.table_views
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

COMMENT ON TABLE public.table_views IS
  'Vistas guardadas de una tabla (columnas y filtros). Privadas, para todo el equipo o para personas elegidas. Escribe solo save_table_view / delete_table_view.';
COMMENT ON TABLE public.table_view_defaults IS
  'La vista predeterminada de cada persona por tabla. La puede dejar la propia persona o un Owner/Admin (assigned_by).';

-- ------------------------------------------------------------
-- Helpers (para las policies y las funciones). SECURITY DEFINER para no caer en la recursion de RLS entre
-- table_views y table_view_members.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.table_view_workspace(p_view uuid)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT v.workspace_id FROM public.table_views v WHERE v.id = p_view;
$$;

-- ¿La persona `p_user` puede ver la vista? (la dueña, o miembro del negocio con la vista compartida con ella o con todos)
CREATE OR REPLACE FUNCTION public.table_view_visible_to(p_view uuid, p_user uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT COALESCE((
    SELECT EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = v.workspace_id AND wm.user_id = p_user
    ) AND (
      v.owner_id = p_user
      OR v.visibility = 'workspace'
      OR (v.visibility = 'selected' AND EXISTS (SELECT 1 FROM public.table_view_members m WHERE m.view_id = v.id AND m.user_id = p_user))
    )
    FROM public.table_views v WHERE v.id = p_view
  ), false);
$$;

REVOKE ALL ON FUNCTION public.table_view_workspace(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.table_view_workspace(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.table_view_visible_to(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.table_view_visible_to(uuid, uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- RLS: solo lectura para la app.
-- ------------------------------------------------------------

ALTER TABLE public.table_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.table_view_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.table_view_defaults ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS table_views_select ON public.table_views;
CREATE POLICY table_views_select ON public.table_views
  FOR SELECT USING (
    public.is_workspace_member(workspace_id)
    AND (
      owner_id = (SELECT auth.uid())
      OR visibility = 'workspace'
      OR (visibility = 'selected' AND EXISTS (SELECT 1 FROM public.table_view_members m WHERE m.view_id = table_views.id AND m.user_id = (SELECT auth.uid())))
      -- Owner y Admin ven (y administran) lo compartido aunque no sea suyo; lo privado de otra persona, nunca.
      OR (visibility <> 'private' AND public.is_workspace_admin(workspace_id))
    )
  );

DROP POLICY IF EXISTS table_view_members_select ON public.table_view_members;
CREATE POLICY table_view_members_select ON public.table_view_members
  FOR SELECT USING (
    user_id = (SELECT auth.uid())
    OR public.is_workspace_admin(public.table_view_workspace(view_id))
  );

DROP POLICY IF EXISTS table_view_defaults_select ON public.table_view_defaults;
CREATE POLICY table_view_defaults_select ON public.table_view_defaults
  FOR SELECT USING (
    user_id = (SELECT auth.uid())
    OR public.is_workspace_admin(workspace_id)
  );

REVOKE ALL ON public.table_views FROM anon, authenticated;
GRANT SELECT ON public.table_views TO authenticated;
GRANT ALL ON public.table_views TO service_role;

REVOKE ALL ON public.table_view_members FROM anon, authenticated;
GRANT SELECT ON public.table_view_members TO authenticated;
GRANT ALL ON public.table_view_members TO service_role;

REVOKE ALL ON public.table_view_defaults FROM anon, authenticated;
GRANT SELECT ON public.table_view_defaults TO authenticated;
GRANT ALL ON public.table_view_defaults TO service_role;

-- ------------------------------------------------------------
-- Escritura: save_table_view
--
-- p_id NULL = crear. Con p_id = editar (la dueña, o Owner/Admin si la vista no es privada).
-- Compartir (visibility distinta de 'private') es solo de Owner y Admin.
-- p_member_ids: con 'selected' reemplaza la lista de personas; NULL deja la lista como esta; con otra visibilidad se vacia.
-- Devuelve el id de la vista. Un nombre repetido de la misma persona en la misma tabla falla con 23505.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.save_table_view(
  p_id          uuid,
  p_workspace   uuid,
  p_table_key   text,
  p_name        text,
  p_config      jsonb,
  p_visibility  text DEFAULT 'private',
  p_member_ids  uuid[] DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_row   public.table_views%ROWTYPE;
  v_ws    uuid;
  v_admin boolean;
  v_vis   text := COALESCE(p_visibility, 'private');
  v_id    uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No hay sesion' USING ERRCODE = '42501';
  END IF;
  IF v_vis NOT IN ('private', 'workspace', 'selected') THEN
    RAISE EXCEPTION 'Visibilidad invalida' USING ERRCODE = '22023';
  END IF;

  IF p_id IS NOT NULL THEN
    SELECT * INTO v_row FROM public.table_views WHERE id = p_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'La vista no existe' USING ERRCODE = 'P0002';
    END IF;
    v_ws := v_row.workspace_id;
  ELSE
    v_ws := p_workspace;
  END IF;

  IF NOT public.is_workspace_member(v_ws) THEN
    RAISE EXCEPTION 'No sos parte de este negocio' USING ERRCODE = '42501';
  END IF;
  v_admin := public.is_workspace_admin(v_ws);

  IF p_id IS NOT NULL AND NOT (v_row.owner_id = v_uid OR (v_admin AND v_row.visibility <> 'private')) THEN
    RAISE EXCEPTION 'No podes editar esta vista' USING ERRCODE = '42501';
  END IF;
  IF v_vis <> 'private' AND NOT v_admin THEN
    RAISE EXCEPTION 'Solo Owner y Admin pueden compartir vistas' USING ERRCODE = '42501';
  END IF;
  IF v_vis = 'selected' AND p_member_ids IS NOT NULL AND EXISTS (
    SELECT 1 FROM unnest(p_member_ids) AS u(user_id)
    WHERE NOT EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = v_ws AND wm.user_id = u.user_id)
  ) THEN
    RAISE EXCEPTION 'Hay personas que no son parte de este negocio' USING ERRCODE = '22023';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.table_views (workspace_id, table_key, name, config, owner_id, visibility)
    VALUES (v_ws, p_table_key, btrim(p_name), COALESCE(p_config, '{}'::jsonb), v_uid, v_vis)
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.table_views
       SET name = btrim(p_name), config = COALESCE(p_config, config), visibility = v_vis
     WHERE id = p_id
    RETURNING id INTO v_id;
  END IF;

  IF v_vis = 'selected' THEN
    IF p_member_ids IS NOT NULL THEN
      DELETE FROM public.table_view_members WHERE view_id = v_id AND NOT (user_id = ANY (p_member_ids));
      INSERT INTO public.table_view_members (view_id, user_id)
      SELECT v_id, u.user_id FROM unnest(p_member_ids) AS u(user_id)
      ON CONFLICT DO NOTHING;
    END IF;
  ELSE
    DELETE FROM public.table_view_members WHERE view_id = v_id;
  END IF;

  -- Quien ya no puede ver la vista deja de tenerla como predeterminada.
  DELETE FROM public.table_view_defaults d
   WHERE d.view_id = v_id AND NOT public.table_view_visible_to(v_id, d.user_id);

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_table_view(uuid, uuid, text, text, jsonb, text, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_table_view(uuid, uuid, text, text, jsonb, text, uuid[]) TO authenticated, service_role;

-- ------------------------------------------------------------
-- Escritura: delete_table_view (la dueña, o Owner/Admin si no es privada). Se lleva sus personas y predeterminadas.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.delete_table_view(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.table_views%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No hay sesion' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_row FROM public.table_views WHERE id = p_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF NOT public.is_workspace_member(v_row.workspace_id)
     OR NOT (v_row.owner_id = v_uid OR (public.is_workspace_admin(v_row.workspace_id) AND v_row.visibility <> 'private')) THEN
    RAISE EXCEPTION 'No podes borrar esta vista' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.table_views WHERE id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_table_view(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_table_view(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- Escritura: set_table_view_default
--
-- Deja `p_view` como la predeterminada de `p_user_ids` en esa tabla (NULL = la propia persona). p_view NULL la saca.
-- Para otras personas hay que ser Owner o Admin. La vista tiene que verla cada una: con 'selected' se la suma a
-- su lista; una vista privada solo puede ser predeterminada de su dueña (hay que compartirla primero).
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_table_view_default(
  p_workspace uuid,
  p_table_key text,
  p_view      uuid,
  p_user_ids  uuid[] DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_targets uuid[];
  v_view    public.table_views%ROWTYPE;
  v_target  uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No hay sesion' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_workspace_member(p_workspace) THEN
    RAISE EXCEPTION 'No sos parte de este negocio' USING ERRCODE = '42501';
  END IF;
  v_targets := COALESCE(p_user_ids, ARRAY[v_uid]);
  IF EXISTS (SELECT 1 FROM unnest(v_targets) AS t(user_id) WHERE t.user_id <> v_uid) AND NOT public.is_workspace_admin(p_workspace) THEN
    RAISE EXCEPTION 'Solo Owner y Admin pueden elegir la vista de otras personas' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(v_targets) AS t(user_id)
    WHERE NOT EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = p_workspace AND wm.user_id = t.user_id)
  ) THEN
    RAISE EXCEPTION 'Hay personas que no son parte de este negocio' USING ERRCODE = '22023';
  END IF;

  IF p_view IS NULL THEN
    DELETE FROM public.table_view_defaults
     WHERE workspace_id = p_workspace AND table_key = p_table_key AND user_id = ANY (v_targets);
    RETURN;
  END IF;

  SELECT * INTO v_view FROM public.table_views WHERE id = p_view AND workspace_id = p_workspace AND table_key = p_table_key;
  IF NOT FOUND OR NOT (
    public.table_view_visible_to(p_view, v_uid)
    OR (public.is_workspace_admin(p_workspace) AND v_view.visibility <> 'private')
  ) THEN
    RAISE EXCEPTION 'La vista no existe' USING ERRCODE = 'P0002';
  END IF;

  FOREACH v_target IN ARRAY v_targets LOOP
    IF NOT public.table_view_visible_to(p_view, v_target) THEN
      IF v_view.visibility = 'selected' THEN
        INSERT INTO public.table_view_members (view_id, user_id) VALUES (p_view, v_target) ON CONFLICT DO NOTHING;
      ELSE
        RAISE EXCEPTION 'La vista es privada: compartila antes de dejarla como predeterminada de otra persona' USING ERRCODE = '22023';
      END IF;
    END IF;
    INSERT INTO public.table_view_defaults (workspace_id, user_id, table_key, view_id, assigned_by)
    VALUES (p_workspace, v_target, p_table_key, p_view, CASE WHEN v_target = v_uid THEN NULL ELSE v_uid END)
    ON CONFLICT (workspace_id, user_id, table_key)
    DO UPDATE SET view_id = EXCLUDED.view_id, assigned_by = EXCLUDED.assigned_by, updated_at = now();
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.set_table_view_default(uuid, text, uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_table_view_default(uuid, text, uuid, uuid[]) TO authenticated, service_role;
