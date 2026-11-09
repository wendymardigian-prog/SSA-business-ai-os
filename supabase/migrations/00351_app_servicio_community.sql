-- @plantilla-quitar(servicios)
-- ============================================================================
-- 00351_app_servicio_community  (Servicios v12, Corrida A1 · S14 · bloque CO)
-- ============================================================================
-- (El plano la numeraba 00347; la 00347 a la 00350 las ocuparon otras sesiones el 8/11.)
--
-- 1. `app_servicio_portal.community_posts` (§8.2 #13, F76, F111): posts Y comentarios (`parent_id`, UN nivel: CO001),
--    del muro de un programa o de una clase (espacio reservado «clases» con `program_item_id`). Autor: un contacto O una
--    persona del equipo (CHECK). Lo borrado se oculta (`deleted_at`) y se purga a los 30 dias (cron de la S16).
-- 2. `app_servicio_portal.community_reactions` (§8.2 #14): reacciones Y reportes (`kind`).
-- 3. Bucket privado `community-media` (10 MB; se valida por bytes en el servidor).
-- 4. Gemela `community_can_post_plan(jsonb)` (lib/program/community.ts, community.cases.json) y
--    `community_can_post(contacto, producto, espacio, clase)`.
-- 5. `community_unanswered(producto, dias)`: posts de estudiantes sin respuesta del equipo y sin «visto».
-- 6. Lo que hace el equipo desde SSA (cada una pide su clave): leer (`community_feed`, `community.view`), publicar y
--    responder (`community_team_post`, `community.reply`), «Marcar como visto», fijar / ocultar / borrar, silenciar y
--    resolver reportes (`community.moderate`). Los espacios se guardan con `portal_admin_save_program_settings`
--    (`community.spaces`, desde la 00332).
--
-- Aditiva. El esquema del portal sigue cerrado (sin USAGE para anon ni authenticated): SSA lee por estas funciones.
--
-- Cómo volver atrás:
--   DROP TABLE IF EXISTS app_servicio_portal.community_reactions, app_servicio_portal.community_posts;
--   DELETE FROM storage.buckets WHERE id = 'community-media';   -- (vaciarlo antes)
--   DROP FUNCTION de cada funcion nueva (community_spaces, community_can_post_plan, community_can_post, community_unanswered,
--     community_feed, community_item_counts, community_team_post, community_mark_seen, community_moderate,
--     community_set_muted, community_resolve_report, community_post_structure).
--
-- Riesgo: bajo (todo nuevo).
-- ============================================================================

CREATE TABLE IF NOT EXISTS app_servicio_portal.community_posts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  product_id         uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  space_key          text NOT NULL,
  parent_id          uuid NULL REFERENCES app_servicio_portal.community_posts(id) ON DELETE CASCADE,
  program_item_id    uuid NULL REFERENCES app_servicio.program_items(id) ON DELETE CASCADE,
  author_contact_id  uuid NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  author_user_id     uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  as_business        boolean NOT NULL DEFAULT false,
  body               text NOT NULL,
  media              jsonb NOT NULL DEFAULT '[]'::jsonb,
  pinned_at          timestamptz NULL,
  hidden_at          timestamptz NULL,
  hidden_by          uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  hidden_reason      text NULL,
  team_seen_at       timestamptz NULL,
  deleted_at         timestamptz NULL,
  edited_at          timestamptz NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT community_posts_space_check CHECK (space_key ~ '^[a-z0-9_]{1,40}$'),
  CONSTRAINT community_posts_body_check CHECK (char_length(body) BETWEEN 1 AND 10000),
  -- Un contacto O una persona del equipo. Una persona del equipo que se va (ON DELETE SET NULL) deja el post del negocio.
  CONSTRAINT community_posts_author_check CHECK (
    (author_contact_id IS NOT NULL AND author_user_id IS NULL AND NOT as_business)
    OR (author_contact_id IS NULL AND (author_user_id IS NOT NULL OR as_business))),
  CONSTRAINT community_posts_media_check CHECK (jsonb_typeof(media) = 'array' AND jsonb_array_length(media) <= 10),
  CONSTRAINT community_posts_hidden_check CHECK (hidden_at IS NULL OR NULLIF(btrim(hidden_reason), '') IS NOT NULL),
  CONSTRAINT community_posts_lesson_check CHECK ((space_key = 'clases') = (program_item_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_community_posts_feed ON app_servicio_portal.community_posts (product_id, space_key, created_at DESC) WHERE parent_id IS NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_community_posts_parent ON app_servicio_portal.community_posts (parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_community_posts_item ON app_servicio_portal.community_posts (program_item_id) WHERE program_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_community_posts_contact ON app_servicio_portal.community_posts (author_contact_id);
CREATE INDEX IF NOT EXISTS idx_community_posts_deleted ON app_servicio_portal.community_posts (deleted_at) WHERE deleted_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS app_servicio_portal.community_reactions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  post_id        uuid NOT NULL REFERENCES app_servicio_portal.community_posts(id) ON DELETE CASCADE,
  contact_id     uuid NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  user_id        uuid NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind           text NOT NULL,
  report_reason  text NULL,
  resolved_at    timestamptz NULL,
  resolved_by    uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT community_reactions_kind_check CHECK (kind IN ('like', 'fire', 'clap', 'report')),
  CONSTRAINT community_reactions_who_check CHECK ((contact_id IS NULL) <> (user_id IS NULL)),
  CONSTRAINT community_reactions_reason_check CHECK (report_reason IS NULL OR char_length(report_reason) <= 500)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_community_reactions ON app_servicio_portal.community_reactions (post_id, COALESCE(contact_id, user_id), kind);
CREATE INDEX IF NOT EXISTS idx_community_reports_open ON app_servicio_portal.community_reactions (post_id) WHERE kind = 'report' AND resolved_at IS NULL;

ALTER TABLE app_servicio_portal.community_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_servicio_portal.community_reactions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_servicio_portal.community_posts, app_servicio_portal.community_reactions FROM public, anon, authenticated;
GRANT ALL ON app_servicio_portal.community_posts, app_servicio_portal.community_reactions TO service_role;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('community-media', 'community-media', false, 10485760, ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ─── Estructura (CO001) ─────────────────────────────────────────────────────
-- Un comentario cuelga de un post (nunca de otro comentario), del mismo programa; hereda su espacio y su clase. La
-- clase de un comentario de clase es del mismo programa.
CREATE OR REPLACE FUNCTION app_servicio.community_post_structure()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  par record;
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    SELECT id, parent_id, product_id, space_key, program_item_id, workspace_id INTO par FROM app_servicio_portal.community_posts WHERE id = NEW.parent_id;
    IF par.id IS NULL OR par.parent_id IS NOT NULL OR par.product_id <> NEW.product_id THEN
      RAISE EXCEPTION 'Un comentario va debajo de un post, no de otro comentario' USING ERRCODE = 'CO001';
    END IF;
    NEW.space_key := par.space_key;
    NEW.program_item_id := par.program_item_id;
    NEW.workspace_id := par.workspace_id;
  END IF;
  IF NEW.program_item_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM app_servicio.program_items i WHERE i.id = NEW.program_item_id AND i.product_id = NEW.product_id AND i.kind = 'lesson') THEN
    RAISE EXCEPTION 'La clase no es de este programa' USING ERRCODE = 'CO001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id = NEW.product_id AND p.workspace_id = NEW.workspace_id) THEN
    RAISE EXCEPTION 'El programa no es de este negocio' USING ERRCODE = 'CO001';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_community_post_structure ON app_servicio_portal.community_posts;
CREATE TRIGGER trg_community_post_structure BEFORE INSERT OR UPDATE OF parent_id, program_item_id, product_id ON app_servicio_portal.community_posts
  FOR EACH ROW EXECUTE FUNCTION app_servicio.community_post_structure();

-- ─── Reglas ─────────────────────────────────────────────────────────────────
-- Los espacios del programa (los de fabrica si nunca se configuraron), sin el reservado «clases».
CREATE OR REPLACE FUNCTION app_servicio.community_spaces(p_product_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE((SELECT jsonb_agg(x) FROM jsonb_array_elements(
           CASE WHEN jsonb_typeof(p.portal_settings #> '{community,spaces}') = 'array' THEN p.portal_settings #> '{community,spaces}'
                ELSE '[{"key":"anuncios","name":"Anuncios","team_only":true},{"key":"general","name":"General"},{"key":"victorias","name":"Victorias"}]'::jsonb END) x
         WHERE x ->> 'key' IS DISTINCT FROM 'clases'), '[]'::jsonb)
    FROM public.products p WHERE p.id = p_product_id;
$$;

-- Gemela de canPost. Entrada: {author, sectionOn, hasAccess, muted, space, lessonComment, lessonCommentsOn, item}.
CREATE OR REPLACE FUNCTION app_servicio.community_can_post_plan(p jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  v_team boolean := p ->> 'author' = 'team';
  v_item jsonb := CASE WHEN jsonb_typeof(p -> 'item') = 'object' THEN p -> 'item' END;
  v_space jsonb := CASE WHEN jsonb_typeof(p -> 'space') = 'object' THEN p -> 'space' END;
BEGIN
  IF COALESCE((p ->> 'lessonComment')::boolean, false) THEN
    IF v_item IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'No existe la clase'); END IF;
    IF NOT COALESCE((p ->> 'lessonCommentsOn')::boolean, false) OR NOT COALESCE((v_item ->> 'commentsEnabled')::boolean, false) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'Los comentarios de esta clase están apagados');
    END IF;
    IF v_team THEN RETURN jsonb_build_object('ok', true); END IF;
    IF COALESCE((p ->> 'muted')::boolean, false) THEN RETURN jsonb_build_object('ok', false, 'reason', 'Estás silenciado en la comunidad'); END IF;
    IF NOT COALESCE((v_item ->> 'active')::boolean, false) OR NOT COALESCE((v_item ->> 'unlocked')::boolean, false) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'Esta clase todavía no está abierta');
    END IF;
    RETURN jsonb_build_object('ok', true);
  END IF;
  IF v_space IS NULL OR COALESCE((v_space ->> 'archived')::boolean, false) THEN RETURN jsonb_build_object('ok', false, 'reason', 'No existe ese espacio'); END IF;
  IF v_team THEN RETURN jsonb_build_object('ok', true); END IF;
  IF NOT COALESCE((p ->> 'sectionOn')::boolean, false) THEN RETURN jsonb_build_object('ok', false, 'reason', 'La comunidad está apagada'); END IF;
  IF NOT COALESCE((p ->> 'hasAccess')::boolean, false) THEN RETURN jsonb_build_object('ok', false, 'reason', 'No tenés acceso a la comunidad'); END IF;
  IF COALESCE((p ->> 'muted')::boolean, false) THEN RETURN jsonb_build_object('ok', false, 'reason', 'Estás silenciado en la comunidad'); END IF;
  IF COALESCE((v_space ->> 'team_only')::boolean, false) THEN RETURN jsonb_build_object('ok', false, 'reason', 'En este espacio publica solo el equipo'); END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- El plan con los datos reales. `p_contact_id` NULL = alguien del equipo.
CREATE OR REPLACE FUNCTION app_servicio.community_can_post_check(p_contact_id uuid, p_product_id uuid, p_space text, p_program_item_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_settings jsonb;
  v_item jsonb := NULL;
  it record;
  v_access boolean := false;
  v_muted boolean := false;
BEGIN
  SELECT portal_settings INTO v_settings FROM public.products WHERE id = p_product_id;
  IF p_contact_id IS NOT NULL THEN
    SELECT bool_or(a.starts_at <= now() AND (a.ends_at IS NULL OR a.ends_at > now()) AND a.revoked_at IS NULL
                   AND a.suspended_overdue_at IS NULL AND a.suspended_pause_at IS NULL),
           bool_or(a.muted_at IS NOT NULL)
      INTO v_access, v_muted
      FROM app_servicio_portal.portal_access a
     WHERE a.contact_id = p_contact_id AND a.product_id = p_product_id AND a.section = 'community';
  END IF;
  IF p_program_item_id IS NOT NULL THEN
    SELECT id, status, comments_enabled INTO it FROM app_servicio.program_items WHERE id = p_program_item_id AND product_id = p_product_id AND kind = 'lesson';
    IF it.id IS NOT NULL THEN
      v_item := jsonb_build_object('active', it.status = 'active', 'commentsEnabled', it.comments_enabled,
        'unlocked', CASE WHEN p_contact_id IS NULL THEN true ELSE COALESCE((app_servicio.program_item_unlocked(p_contact_id, it.id) ->> 'unlocked')::boolean, false) END);
    END IF;
  END IF;
  RETURN app_servicio.community_can_post_plan(jsonb_build_object(
    'author', CASE WHEN p_contact_id IS NULL THEN 'team' ELSE 'student' END,
    'sectionOn', app_servicio.portal_section_enabled(p_product_id, 'community'),
    'hasAccess', COALESCE(v_access, false),
    'muted', COALESCE(v_muted, false),
    'space', (SELECT x FROM jsonb_array_elements(app_servicio.community_spaces(p_product_id)) x WHERE x ->> 'key' = p_space LIMIT 1),
    'lessonComment', p_program_item_id IS NOT NULL,
    'lessonCommentsOn', COALESCE(v_settings #>> '{community,lesson_comments}', 'true') <> 'false',
    'item', v_item));
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio.community_can_post(p_contact_id uuid, p_product_id uuid, p_space text, p_program_item_id uuid DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE((app_servicio.community_can_post_check(p_contact_id, p_product_id, p_space, p_program_item_id) ->> 'ok')::boolean, false);
$$;

-- Sin contestar: posts (y comentarios de clase) de estudiantes de los ultimos N dias, sin respuesta del equipo y sin
-- «visto». Lo que publica el equipo no cuenta.
CREATE OR REPLACE FUNCTION app_servicio.community_is_unanswered(p_post_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM app_servicio_portal.community_posts p
     WHERE p.id = p_post_id AND p.parent_id IS NULL AND p.author_contact_id IS NOT NULL AND p.deleted_at IS NULL AND p.hidden_at IS NULL
       AND p.team_seen_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM app_servicio_portal.community_posts r
                        WHERE r.parent_id = p.id AND r.author_contact_id IS NULL AND r.deleted_at IS NULL));
$$;

CREATE OR REPLACE FUNCTION app_servicio.community_unanswered(p_product_id uuid, p_days integer DEFAULT 30)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT count(*)::int FROM app_servicio_portal.community_posts p
   WHERE p.product_id = p_product_id AND p.created_at >= now() - make_interval(days => GREATEST(1, LEAST(COALESCE(p_days, 30), 365)))
     AND app_servicio.community_is_unanswered(p.id);
$$;

-- ─── Lo que lee el equipo (community.view) ──────────────────────────────────
-- p: {filter: all|unanswered|reported, space?, program_item_id?, before?, limit?}. Cada post con sus comentarios, las
-- reacciones contadas y los reportes abiertos. Los nombres del equipo los pone la pantalla (author_user_id).
CREATE OR REPLACE FUNCTION app_servicio.community_feed(p_product_id uuid, p jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_ws uuid;
  v_filter text := COALESCE(p ->> 'filter', 'all');
  v_limit integer := LEAST(100, GREATEST(1, COALESCE((p ->> 'limit')::integer, 30)));
BEGIN
  SELECT workspace_id INTO v_ws FROM public.products WHERE id = p_product_id;
  IF v_ws IS NULL THEN RETURN '[]'::jsonb; END IF;
  IF NOT app_servicio.is_system() THEN PERFORM app_servicio.require_permission(v_ws, 'community.view'); END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(row ORDER BY (row ->> 'pinned') DESC, (row ->> 'created_at') DESC)
      FROM (
        SELECT jsonb_build_object(
          'id', t.id, 'space_key', t.space_key, 'program_item_id', t.program_item_id, 'body', t.body, 'media', t.media,
          'author_contact_id', t.author_contact_id, 'author_name', c.display_name, 'author_user_id', t.author_user_id, 'as_business', t.as_business,
          'pinned', t.pinned_at IS NOT NULL, 'hidden', t.hidden_at IS NOT NULL, 'hidden_reason', t.hidden_reason, 'seen', t.team_seen_at IS NOT NULL,
          'deleted', t.deleted_at IS NOT NULL, 'created_at', t.created_at, 'edited_at', t.edited_at,
          'unanswered', app_servicio.community_is_unanswered(t.id),
          'reactions', COALESCE((SELECT jsonb_object_agg(k.kind, k.n) FROM (SELECT kind, count(*)::int n FROM app_servicio_portal.community_reactions WHERE post_id = t.id AND kind <> 'report' GROUP BY kind) k), '{}'::jsonb),
          'reports', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'reason', r.report_reason, 'created_at', r.created_at)) FROM app_servicio_portal.community_reactions r WHERE r.post_id = t.id AND r.kind = 'report' AND r.resolved_at IS NULL), '[]'::jsonb),
          'replies', COALESCE((SELECT jsonb_agg(jsonb_build_object(
              'id', x.id, 'body', x.body, 'author_contact_id', x.author_contact_id, 'author_name', xc.display_name, 'author_user_id', x.author_user_id,
              'as_business', x.as_business, 'hidden', x.hidden_at IS NOT NULL, 'created_at', x.created_at) ORDER BY x.created_at)
            FROM app_servicio_portal.community_posts x LEFT JOIN public.contacts xc ON xc.id = x.author_contact_id
           WHERE x.parent_id = t.id AND x.deleted_at IS NULL), '[]'::jsonb)) AS row
          FROM app_servicio_portal.community_posts t
          LEFT JOIN public.contacts c ON c.id = t.author_contact_id
         WHERE t.product_id = p_product_id AND t.parent_id IS NULL AND t.deleted_at IS NULL
           AND (NULLIF(p ->> 'space', '') IS NULL OR t.space_key = p ->> 'space')
           AND (NULLIF(p ->> 'program_item_id', '') IS NULL OR t.program_item_id = (p ->> 'program_item_id')::uuid)
           AND (NULLIF(p ->> 'before', '') IS NULL OR t.created_at < (p ->> 'before')::timestamptz)
           AND (v_filter <> 'unanswered' OR (t.created_at >= now() - interval '30 days' AND app_servicio.community_is_unanswered(t.id)))
           AND (v_filter <> 'reported' OR EXISTS (SELECT 1 FROM app_servicio_portal.community_reactions r WHERE r.post_id = t.id AND r.kind = 'report' AND r.resolved_at IS NULL))
         ORDER BY t.pinned_at DESC NULLS LAST, t.created_at DESC
         LIMIT v_limit) q), '[]'::jsonb);
END;
$$;

-- Comentarios sin contestar por clase (el aviso «N comentarios nuevos» del árbol de Contenido) y los contadores.
CREATE OR REPLACE FUNCTION app_servicio.community_item_counts(p_product_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_ws uuid;
BEGIN
  SELECT workspace_id INTO v_ws FROM public.products WHERE id = p_product_id;
  IF v_ws IS NULL THEN RETURN '{}'::jsonb; END IF;
  IF NOT app_servicio.is_system() AND NOT (public.is_workspace_member(v_ws) AND (public.has_permission(v_ws, 'community.view') OR public.has_permission(v_ws, 'program.manage'))) THEN
    RETURN '{}'::jsonb;
  END IF;
  RETURN jsonb_build_object(
    'unanswered', app_servicio.community_unanswered(p_product_id, 30),
    'reported', (SELECT count(DISTINCT r.post_id)::int FROM app_servicio_portal.community_reactions r JOIN app_servicio_portal.community_posts t ON t.id = r.post_id
                  WHERE t.product_id = p_product_id AND r.kind = 'report' AND r.resolved_at IS NULL AND t.deleted_at IS NULL),
    'by_item', COALESCE((SELECT jsonb_object_agg(item, n) FROM (
        SELECT t.program_item_id AS item, count(*)::int n FROM app_servicio_portal.community_posts t
         WHERE t.product_id = p_product_id AND t.program_item_id IS NOT NULL AND t.created_at >= now() - interval '30 days'
           AND app_servicio.community_is_unanswered(t.id) GROUP BY 1) z), '{}'::jsonb));
END;
$$;

-- ─── Lo que hace el equipo ──────────────────────────────────────────────────
-- Publicar o responder (community.reply): como el negocio (`as_business`) o con su nombre y la etiqueta «Equipo».
-- Responder un post de un estudiante lo saca de «sin contestar».
CREATE OR REPLACE FUNCTION app_servicio.community_team_post(p_product_id uuid, p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_ws uuid;
  v_parent_id uuid := NULL;
  v_space text := p ->> 'space_key';
  v_item uuid := NULLIF(p ->> 'program_item_id', '')::uuid;
  v_check jsonb;
  v_id uuid;
BEGIN
  SELECT workspace_id INTO v_ws FROM public.products WHERE id = p_product_id;
  IF v_ws IS NULL THEN RAISE EXCEPTION 'No existe el programa' USING ERRCODE = 'CO002'; END IF;
  PERFORM app_servicio.require_permission(v_ws, 'community.reply');
  IF NULLIF(btrim(p ->> 'body'), '') IS NULL THEN RAISE EXCEPTION 'Escribí el mensaje' USING ERRCODE = 'CO002'; END IF;
  IF NULLIF(p ->> 'parent_id', '') IS NOT NULL THEN
    SELECT id, space_key, program_item_id INTO v_parent_id, v_space, v_item FROM app_servicio_portal.community_posts
     WHERE id = (p ->> 'parent_id')::uuid AND product_id = p_product_id AND deleted_at IS NULL;
    IF v_parent_id IS NULL THEN RAISE EXCEPTION 'No existe ese post' USING ERRCODE = 'CO002'; END IF;
  ELSE
    IF v_item IS NOT NULL THEN v_space := 'clases'; END IF;
    v_check := app_servicio.community_can_post_check(NULL, p_product_id, v_space, v_item);
    IF NOT COALESCE((v_check ->> 'ok')::boolean, false) THEN RAISE EXCEPTION '%', v_check ->> 'reason' USING ERRCODE = 'CO002'; END IF;
  END IF;
  INSERT INTO app_servicio_portal.community_posts (workspace_id, product_id, space_key, parent_id, program_item_id, author_user_id, as_business, body)
  VALUES (v_ws, p_product_id, v_space, v_parent_id, v_item, auth.uid(), COALESCE((p ->> 'as_business')::boolean, false), btrim(p ->> 'body'))
  RETURNING id INTO v_id;
  PERFORM app_servicio.audit(v_ws, 'product', p_product_id, CASE WHEN v_parent_id IS NULL THEN 'community.posted' ELSE 'community.replied' END,
    jsonb_build_object('post_id', v_id, 'parent_id', v_parent_id, 'space_key', v_space));
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio.community_mark_seen(p_post_id uuid, p_seen boolean DEFAULT true)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_ws uuid;
BEGIN
  SELECT workspace_id INTO v_ws FROM app_servicio_portal.community_posts WHERE id = p_post_id;
  IF v_ws IS NULL THEN RAISE EXCEPTION 'No existe ese post' USING ERRCODE = 'CO002'; END IF;
  PERFORM app_servicio.require_permission(v_ws, 'community.reply');
  UPDATE app_servicio_portal.community_posts SET team_seen_at = CASE WHEN p_seen THEN COALESCE(team_seen_at, now()) END WHERE id = p_post_id;
END;
$$;

-- Fijar, ocultar (con motivo), mostrar y borrar (se oculta y se purga a los 30 dias). community.moderate.
CREATE OR REPLACE FUNCTION app_servicio.community_moderate(p_post_id uuid, p_action text, p_reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  t record;
BEGIN
  SELECT id, workspace_id, product_id, parent_id INTO t FROM app_servicio_portal.community_posts WHERE id = p_post_id;
  IF t.id IS NULL THEN RAISE EXCEPTION 'No existe ese post' USING ERRCODE = 'CO002'; END IF;
  PERFORM app_servicio.require_permission(t.workspace_id, 'community.moderate');
  IF p_action = 'pin' THEN
    IF t.parent_id IS NOT NULL THEN RAISE EXCEPTION 'Solo se fija un post' USING ERRCODE = 'CO002'; END IF;
    UPDATE app_servicio_portal.community_posts SET pinned_at = now() WHERE id = t.id;
  ELSIF p_action = 'unpin' THEN
    UPDATE app_servicio_portal.community_posts SET pinned_at = NULL WHERE id = t.id;
  ELSIF p_action = 'hide' THEN
    IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN RAISE EXCEPTION 'Escribí el motivo' USING ERRCODE = 'CO002'; END IF;
    UPDATE app_servicio_portal.community_posts SET hidden_at = now(), hidden_by = auth.uid(), hidden_reason = btrim(p_reason) WHERE id = t.id;
  ELSIF p_action = 'unhide' THEN
    UPDATE app_servicio_portal.community_posts SET hidden_at = NULL, hidden_by = NULL, hidden_reason = NULL WHERE id = t.id;
  ELSIF p_action = 'delete' THEN
    UPDATE app_servicio_portal.community_posts SET deleted_at = COALESCE(deleted_at, now()) WHERE id = t.id;
  ELSE
    RAISE EXCEPTION 'Acción desconocida' USING ERRCODE = 'CO002';
  END IF;
  PERFORM app_servicio.audit(t.workspace_id, 'product', t.product_id, 'community.' || p_action, jsonb_build_object('post_id', t.id, 'reason', NULLIF(btrim(COALESCE(p_reason, '')), '')));
END;
$$;

-- Silenciar a un estudiante en la comunidad de un programa: no publica ni comenta (lee igual). community.moderate.
CREATE OR REPLACE FUNCTION app_servicio.community_set_muted(p_product_id uuid, p_contact_id uuid, p_muted boolean, p_reason text DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_ws uuid;
  n integer;
BEGIN
  SELECT workspace_id INTO v_ws FROM public.products WHERE id = p_product_id;
  IF v_ws IS NULL THEN RAISE EXCEPTION 'No existe el programa' USING ERRCODE = 'CO002'; END IF;
  PERFORM app_servicio.require_permission(v_ws, 'community.moderate');
  IF p_muted AND NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN RAISE EXCEPTION 'Escribí el motivo' USING ERRCODE = 'CO002'; END IF;
  UPDATE app_servicio_portal.portal_access SET muted_at = CASE WHEN p_muted THEN COALESCE(muted_at, now()) END
   WHERE contact_id = p_contact_id AND product_id = p_product_id AND section = 'community';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN RAISE EXCEPTION 'Ese estudiante no tiene acceso a la comunidad' USING ERRCODE = 'CO002'; END IF;
  PERFORM app_servicio.audit(v_ws, 'contact', p_contact_id, CASE WHEN p_muted THEN 'community.muted' ELSE 'community.unmuted' END,
    jsonb_build_object('product_id', p_product_id, 'reason', NULLIF(btrim(COALESCE(p_reason, '')), '')));
  RETURN n;
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio.community_resolve_report(p_reaction_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r record;
BEGIN
  SELECT id, workspace_id, post_id, kind INTO r FROM app_servicio_portal.community_reactions WHERE id = p_reaction_id;
  IF r.id IS NULL OR r.kind <> 'report' THEN RAISE EXCEPTION 'No existe ese reporte' USING ERRCODE = 'CO002'; END IF;
  PERFORM app_servicio.require_permission(r.workspace_id, 'community.moderate');
  UPDATE app_servicio_portal.community_reactions SET resolved_at = COALESCE(resolved_at, now()), resolved_by = auth.uid() WHERE id = r.id;
END;
$$;

-- ─── Permisos de ejecucion ──────────────────────────────────────────────────
REVOKE ALL ON FUNCTION
  app_servicio.community_post_structure(), app_servicio.community_spaces(uuid), app_servicio.community_can_post_plan(jsonb),
  app_servicio.community_can_post_check(uuid, uuid, text, uuid), app_servicio.community_can_post(uuid, uuid, text, uuid),
  app_servicio.community_is_unanswered(uuid), app_servicio.community_unanswered(uuid, integer), app_servicio.community_feed(uuid, jsonb),
  app_servicio.community_item_counts(uuid), app_servicio.community_team_post(uuid, jsonb), app_servicio.community_mark_seen(uuid, boolean),
  app_servicio.community_moderate(uuid, text, text), app_servicio.community_set_muted(uuid, uuid, boolean, text), app_servicio.community_resolve_report(uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  app_servicio.community_spaces(uuid), app_servicio.community_can_post_plan(jsonb), app_servicio.community_can_post_check(uuid, uuid, text, uuid),
  app_servicio.community_can_post(uuid, uuid, text, uuid), app_servicio.community_is_unanswered(uuid), app_servicio.community_unanswered(uuid, integer),
  app_servicio.community_feed(uuid, jsonb), app_servicio.community_item_counts(uuid), app_servicio.community_team_post(uuid, jsonb),
  app_servicio.community_mark_seen(uuid, boolean), app_servicio.community_moderate(uuid, text, text), app_servicio.community_set_muted(uuid, uuid, boolean, text),
  app_servicio.community_resolve_report(uuid)
TO service_role;
-- Lo que llama SSA con la sesion (cada una pide su clave adentro).
GRANT EXECUTE ON FUNCTION
  app_servicio.community_feed(uuid, jsonb), app_servicio.community_item_counts(uuid), app_servicio.community_team_post(uuid, jsonb),
  app_servicio.community_mark_seen(uuid, boolean), app_servicio.community_moderate(uuid, text, text), app_servicio.community_set_muted(uuid, uuid, boolean, text),
  app_servicio.community_resolve_report(uuid)
TO authenticated;
