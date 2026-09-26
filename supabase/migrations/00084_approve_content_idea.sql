-- ============================================================================
-- 00084 — Aprobar una idea, en una sola transaccion (Etapa 2, F19)
-- ============================================================================
-- Aprobar hace DOS cosas: crea el post y marca la idea aprobada. Hacerlas con
-- dos llamadas desde la app deja una ventana donde puede quedar la idea
-- aprobada sin post (o al reves, un post huerfano). Una funcion plpgsql corre
-- entera en una transaccion: o pasan las dos o no pasa ninguna.
--
-- SECURITY INVOKER a proposito, que es el default: asi las dos escrituras
-- pasan por la RLS de quien llama. Un Member que intente aprobar rebota en el
-- UPDATE de content_ideas, igual que si lo hiciera por la API directa. Con
-- SECURITY DEFINER habria que reimplementar el permiso adentro, y esa copia es
-- justo lo que se desincroniza.
--
-- Idempotente.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.approve_content_idea(
  p_idea_id    uuid,
  p_title      text,
  p_format     text,
  p_copy       jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_idea   public.content_ideas%ROWTYPE;
  v_post_id uuid;
BEGIN
  -- La lectura ya pasa por la RLS: si no la puede ver, no existe para el.
  SELECT * INTO v_idea FROM public.content_ideas WHERE id = p_idea_id AND deleted_at IS NULL;

  IF v_idea.id IS NULL THEN
    RAISE EXCEPTION 'idea_no_encontrada';
  END IF;

  -- Aprobar dos veces crearia dos posts de la misma idea sin que nadie lo
  -- pidiera (un doble clic alcanza).
  IF v_idea.status <> 'nueva' THEN
    RAISE EXCEPTION 'idea_ya_decidida';
  END IF;

  INSERT INTO public.content_posts (
    workspace_id, idea_id, title, format, copy, status, created_by, position
  )
  VALUES (
    v_idea.workspace_id, v_idea.id, p_title, p_format, p_copy, 'draft', auth.uid(),
    -- Al final de la columna Borrador.
    coalesce((
      SELECT max(position) + 10 FROM public.content_posts
      WHERE workspace_id = v_idea.workspace_id AND status = 'draft' AND deleted_at IS NULL
    ), 10)
  )
  RETURNING id INTO v_post_id;

  UPDATE public.content_ideas
  SET status = 'aprobada', approved_by = auth.uid(), approved_at = now()
  WHERE id = v_idea.id;

  -- Si la RLS no dejo actualizar la idea, la insercion del post se deshace con
  -- la transaccion: no queda un post de una idea que sigue sin aprobar.
  IF NOT FOUND THEN
    RAISE EXCEPTION 'sin_permiso_para_aprobar';
  END IF;

  RETURN v_post_id;
END;
$$;

COMMENT ON FUNCTION public.approve_content_idea(uuid, text, text, jsonb) IS
  'Crea el post y marca la idea aprobada en una sola transaccion (F19). SECURITY INVOKER: la RLS decide si puede.';

REVOKE ALL ON FUNCTION public.approve_content_idea(uuid, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_content_idea(uuid, text, text, jsonb) TO authenticated, service_role;
