-- ============================================================
-- 00364_comments.sql
-- ============================================================
-- Servicios A4, F132 (decision 478): comentarios con @menciones en una tabla generica `public.comments`
-- (tareas y reuniones ahora; fichas y tickets despues sumando un valor al CHECK y una rama a
-- `public.can_see_comment_entity`). Es de BAIOS, no del modulo de Servicios.
--
-- * Se LEE con RLS: un miembro ve un comentario si ve la entidad (`can_see_task_id` / `can_see_call_id`).
-- * NO hay politicas de escritura: se escribe solo con `post_comment`, `edit_comment` y `delete_comment`
--   (SECURITY DEFINER, vuelven a mirar la visibilidad con la sesion). CM001 = no ves la entidad; CM002 = no es tuyo.
-- * Las menciones se filtran: solo quedan las personas del negocio que VEN la entidad, y a cada una le llega el
--   aviso `mentioned` una vez por comentario, nunca a uno mismo. Para saber si OTRA persona ve la entidad se
--   evalua la misma funcion de visibilidad con su id (`private.comment_entity_visible_to`), asi no hay una
--   segunda copia de la regla.
-- * `private.comment_system(...)` deja un comentario de sistema (sin autor). Lo usa el cierre de tareas al
--   terminar un servicio (00370).
--
-- Aditiva. Como volver atras:
--   DROP FUNCTION IF EXISTS public.post_comment(text, uuid, text, uuid[]);
--   DROP FUNCTION IF EXISTS public.edit_comment(uuid, text, uuid[]);
--   DROP FUNCTION IF EXISTS public.delete_comment(uuid);
--   DROP FUNCTION IF EXISTS public.comment_mention_candidates(text, uuid);
--   DROP FUNCTION IF EXISTS private.comment_system(uuid, text, uuid, text);
--   DROP FUNCTION IF EXISTS private.comment_notify_mentions(public.comments, uuid[]);
--   DROP FUNCTION IF EXISTS private.comment_entity_visible_to(uuid, text, uuid);
--   DROP FUNCTION IF EXISTS public.can_see_comment_entity(text, uuid);
--   DROP FUNCTION IF EXISTS private.comment_entity_workspace(text, uuid);
--   DROP TABLE IF EXISTS public.comments;

CREATE TABLE IF NOT EXISTS public.comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  kind text NOT NULL DEFAULT 'comment',
  author_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  body text NOT NULL,
  mentions uuid[] NOT NULL DEFAULT '{}',
  visibility text NOT NULL DEFAULT 'internal',
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'comments_entity_type_check') THEN
    ALTER TABLE public.comments ADD CONSTRAINT comments_entity_type_check CHECK (entity_type IN ('task', 'call'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'comments_kind_check') THEN
    ALTER TABLE public.comments ADD CONSTRAINT comments_kind_check CHECK (kind IN ('comment', 'system'));
  END IF;
  -- El autor solo puede faltar en un comentario de sistema (o si la persona ya no existe: ON DELETE SET NULL).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'comments_body_check') THEN
    ALTER TABLE public.comments ADD CONSTRAINT comments_body_check CHECK (char_length(body) BETWEEN 1 AND 5000);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'comments_system_author_check') THEN
    ALTER TABLE public.comments ADD CONSTRAINT comments_system_author_check CHECK (kind = 'comment' OR author_id IS NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'comments_mentions_check') THEN
    ALTER TABLE public.comments ADD CONSTRAINT comments_mentions_check CHECK (cardinality(mentions) <= 20);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'comments_visibility_check') THEN
    ALTER TABLE public.comments ADD CONSTRAINT comments_visibility_check CHECK (visibility IN ('internal'));
  END IF;
END $$;

COMMENT ON TABLE public.comments IS
  'Comentarios con @menciones (Servicios A4, F132). Se leen con RLS por visibilidad de la entidad; se escriben solo con post_comment/edit_comment/delete_comment. Borrado logico.';
COMMENT ON COLUMN public.comments.author_id IS 'NULL en un comentario de sistema (kind = system) o si la persona ya no existe.';

CREATE INDEX IF NOT EXISTS idx_comments_entity
  ON public.comments (workspace_id, entity_type, entity_id, created_at);

ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.comments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.comments TO authenticated;
GRANT ALL ON public.comments TO service_role;

-- El negocio de la entidad (sin mirar permisos).
CREATE OR REPLACE FUNCTION private.comment_entity_workspace(p_entity_type text, p_entity_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE p_entity_type
    WHEN 'task' THEN (SELECT t.workspace_id FROM public.tasks t WHERE t.id = p_entity_id AND t.deleted_at IS NULL)
    WHEN 'call' THEN (SELECT c.workspace_id FROM public.calls c WHERE c.id = p_entity_id)
    ELSE NULL
  END;
$$;
REVOKE ALL ON FUNCTION private.comment_entity_workspace(text, uuid) FROM PUBLIC, anon, authenticated;

-- Si la sesion ve la entidad. Siempre true o false.
CREATE OR REPLACE FUNCTION public.can_see_comment_entity(p_entity_type text, p_entity_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(CASE p_entity_type
    WHEN 'task' THEN public.can_see_task_id(p_entity_id)
    WHEN 'call' THEN public.can_see_call_id(p_entity_id)
    ELSE false
  END, false);
$$;
REVOKE ALL ON FUNCTION public.can_see_comment_entity(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_see_comment_entity(text, uuid) TO authenticated, service_role;

-- Si OTRA persona ve la entidad: evalua la misma regla con su id como sesion, y deja la sesion como estaba.
CREATE OR REPLACE FUNCTION private.comment_entity_visible_to(p_user_id uuid, p_entity_type text, p_entity_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_sub text := current_setting('request.jwt.claim.sub', true);
  v_claims text := current_setting('request.jwt.claims', true);
  v boolean := false;
BEGIN
  IF p_user_id IS NULL THEN RETURN false; END IF;
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
  BEGIN
    v := public.can_see_comment_entity(p_entity_type, p_entity_id);
  EXCEPTION WHEN OTHERS THEN
    v := false;
  END;
  PERFORM set_config('request.jwt.claim.sub', COALESCE(v_sub, ''), true);
  PERFORM set_config('request.jwt.claims', COALESCE(v_claims, ''), true);
  RETURN COALESCE(v, false);
END;
$$;
REVOKE ALL ON FUNCTION private.comment_entity_visible_to(uuid, text, uuid) FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS comments_select ON public.comments;
CREATE POLICY comments_select ON public.comments
  FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id) AND public.can_see_comment_entity(entity_type, entity_id));

-- Deja solo las menciones de personas del negocio que ven la entidad, sin repetir y sin el autor.
CREATE OR REPLACE FUNCTION private.comment_filter_mentions(p_ws uuid, p_entity_type text, p_entity_id uuid, p_author uuid, p_mentions uuid[])
RETURNS uuid[]
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v uuid[] := ARRAY[]::uuid[];
  u uuid;
BEGIN
  FOREACH u IN ARRAY COALESCE(p_mentions, ARRAY[]::uuid[]) LOOP
    CONTINUE WHEN u IS NULL OR u = p_author OR u = ANY (v);
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.workspace_id = p_ws AND m.user_id = u);
    CONTINUE WHEN NOT private.comment_entity_visible_to(u, p_entity_type, p_entity_id);
    v := v || u;
    EXIT WHEN cardinality(v) >= 20;
  END LOOP;
  RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION private.comment_filter_mentions(uuid, text, uuid, uuid, uuid[]) FROM PUBLIC, anon, authenticated;

-- El aviso `mentioned` a cada mencionada (una vez por comentario). Nunca hace fallar el comentario.
CREATE OR REPLACE FUNCTION private.comment_notify_mentions(p_comment public.comments, p_users uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  u uuid;
  v_title text := CASE p_comment.entity_type WHEN 'task' THEN 'Te mencionaron en una tarea' ELSE 'Te mencionaron en una reunión' END;
  v_body text := left(regexp_replace(p_comment.body, '\s+', ' ', 'g'), 160);
BEGIN
  FOREACH u IN ARRAY COALESCE(p_users, ARRAY[]::uuid[]) LOOP
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.recipient_id = u AND n.type = 'mentioned' AND n.metadata ->> 'comment_id' = p_comment.id::text
    );
    INSERT INTO public.notifications (workspace_id, type, title, body, entity_type, entity_id, metadata, recipient_id)
    VALUES (p_comment.workspace_id, 'mentioned', v_title, v_body, p_comment.entity_type, p_comment.entity_id,
            jsonb_build_object('comment_id', p_comment.id, 'author_id', p_comment.author_id), u);
  END LOOP;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'comment_notify_mentions: %', SQLERRM;
END;
$$;
REVOKE ALL ON FUNCTION private.comment_notify_mentions(public.comments, uuid[]) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.post_comment(p_entity_type text, p_entity_id uuid, p_body text, p_mentions uuid[] DEFAULT '{}')
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ws uuid;
  v_body text := btrim(COALESCE(p_body, ''));
  v_row public.comments;
BEGIN
  v_ws := private.comment_entity_workspace(p_entity_type, p_entity_id);
  IF v_uid IS NULL OR v_ws IS NULL OR NOT public.is_workspace_member(v_ws)
     OR NOT public.can_see_comment_entity(p_entity_type, p_entity_id) THEN
    RAISE EXCEPTION 'No podés comentar acá.' USING ERRCODE = 'P0001', HINT = 'CM001';
  END IF;
  IF char_length(v_body) < 1 OR char_length(v_body) > 5000 THEN
    RAISE EXCEPTION 'El comentario tiene que tener entre 1 y 5000 caracteres.' USING ERRCODE = 'P0001', HINT = 'CM003';
  END IF;
  INSERT INTO public.comments (workspace_id, entity_type, entity_id, kind, author_id, body, mentions)
  VALUES (v_ws, p_entity_type, p_entity_id, 'comment', v_uid, v_body,
          private.comment_filter_mentions(v_ws, p_entity_type, p_entity_id, v_uid, p_mentions))
  RETURNING * INTO v_row;
  PERFORM private.comment_notify_mentions(v_row, v_row.mentions);
  RETURN v_row.id;
END;
$$;
REVOKE ALL ON FUNCTION public.post_comment(text, uuid, text, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_comment(text, uuid, text, uuid[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.edit_comment(p_id uuid, p_body text, p_mentions uuid[] DEFAULT '{}')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.comments;
  v_body text := btrim(COALESCE(p_body, ''));
  v_new uuid[];
BEGIN
  SELECT * INTO v_row FROM public.comments c WHERE c.id = p_id AND c.deleted_at IS NULL FOR UPDATE;
  IF v_row.id IS NULL OR NOT public.can_see_comment_entity(v_row.entity_type, v_row.entity_id) THEN
    RAISE EXCEPTION 'No podés comentar acá.' USING ERRCODE = 'P0001', HINT = 'CM001';
  END IF;
  IF v_row.kind <> 'comment' OR v_row.author_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'Solo podés editar tus comentarios.' USING ERRCODE = 'P0001', HINT = 'CM002';
  END IF;
  IF char_length(v_body) < 1 OR char_length(v_body) > 5000 THEN
    RAISE EXCEPTION 'El comentario tiene que tener entre 1 y 5000 caracteres.' USING ERRCODE = 'P0001', HINT = 'CM003';
  END IF;
  v_new := private.comment_filter_mentions(v_row.workspace_id, v_row.entity_type, v_row.entity_id, v_uid, p_mentions);
  UPDATE public.comments SET body = v_body, mentions = v_new, edited_at = now() WHERE id = p_id RETURNING * INTO v_row;
  -- Solo a quien se suma con la edicion (el aviso es uno por comentario: lo controla comment_notify_mentions).
  PERFORM private.comment_notify_mentions(v_row, v_new);
END;
$$;
REVOKE ALL ON FUNCTION public.edit_comment(uuid, text, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.edit_comment(uuid, text, uuid[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.delete_comment(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.comments;
BEGIN
  SELECT * INTO v_row FROM public.comments c WHERE c.id = p_id AND c.deleted_at IS NULL FOR UPDATE;
  IF v_row.id IS NULL OR NOT public.can_see_comment_entity(v_row.entity_type, v_row.entity_id) THEN
    RAISE EXCEPTION 'No podés comentar acá.' USING ERRCODE = 'P0001', HINT = 'CM001';
  END IF;
  IF v_row.kind <> 'comment' OR v_row.author_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'Solo podés borrar tus comentarios.' USING ERRCODE = 'P0001', HINT = 'CM002';
  END IF;
  UPDATE public.comments SET deleted_at = now() WHERE id = p_id;
END;
$$;
REVOKE ALL ON FUNCTION public.delete_comment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_comment(uuid) TO authenticated, service_role;

-- Para el `@`: las personas del negocio que ven la entidad. Solo si la sesion la ve.
CREATE OR REPLACE FUNCTION public.comment_mention_candidates(p_entity_type text, p_entity_id uuid)
RETURNS TABLE (user_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ws uuid := private.comment_entity_workspace(p_entity_type, p_entity_id);
  r record;
BEGIN
  IF auth.uid() IS NULL OR v_ws IS NULL OR NOT public.can_see_comment_entity(p_entity_type, p_entity_id) THEN
    RETURN;
  END IF;
  FOR r IN SELECT m.user_id AS uid FROM public.workspace_members m WHERE m.workspace_id = v_ws LOOP
    IF r.uid = auth.uid() OR private.comment_entity_visible_to(r.uid, p_entity_type, p_entity_id) THEN
      user_id := r.uid;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.comment_mention_candidates(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.comment_mention_candidates(text, uuid) TO authenticated, service_role;

-- Un comentario de sistema (sin autor). Solo el servidor y los triggers.
CREATE OR REPLACE FUNCTION private.comment_system(p_workspace_id uuid, p_entity_type text, p_entity_id uuid, p_body text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.comments (workspace_id, entity_type, entity_id, kind, author_id, body)
  VALUES (p_workspace_id, p_entity_type, p_entity_id, 'system', NULL, left(btrim(p_body), 5000))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION private.comment_system(uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.comment_system(uuid, text, uuid, text) TO service_role;
