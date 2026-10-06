-- 00116: pilares, ofertas y clasificacion de ideas y piezas (Contenido v3, B12:
-- F89, F91).
--
-- Aditiva e idempotente: no borra ni modifica datos existentes. Las columnas
-- nuevas nacen vacias (salvo el pilar de las ideas que ya tenian texto, abajo).
--
-- 1. content_pillars y content_offers: listas del negocio, configurables. No se
--    borran, se ARCHIVAN: una pieza ya publicada sigue mostrando su pilar
--    aunque ya no se ofrezca en el selector. Por eso no hay policy de DELETE.
--    Leer es de todo miembro (is_workspace_member y no has_permission: la
--    funcion no conoce los permisos del Member de sistema, ver 00088);
--    escribir pide `settings.manage`.
-- 2. Clasificacion de ideas y piezas: plataformas, oferta, pilar, etapa del
--    embudo (tofu | mofu | bofu) y referencia. El formato ya existia.
-- 3. Los pilares que hoy son texto libre en content_ideas.pillar pasan a ser
--    filas de content_pillars y la idea queda apuntando a la suya.
-- 4. approve_content_idea_v2: aprobar hereda la clasificacion y las
--    plataformas. La v1 (00084) no se toca: la borra la 00118, que no se aplica.

-- ------------------------------------------------------------
-- 1. Pilares y ofertas
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.content_pillars (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name         text NOT NULL,
  color        text,
  archived_at  timestamptz,
  created_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.content_offers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name         text NOT NULL,
  archived_at  timestamptz,
  created_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.content_pillars IS
  'Pilares de contenido del negocio. Se archivan, nunca se borran: lo publicado sigue mostrando el suyo.';
COMMENT ON TABLE public.content_offers IS
  'Ofertas (lo que se vende) a las que apunta una idea o una pieza. Se archivan, nunca se borran.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_pillars_name_check') THEN
    ALTER TABLE public.content_pillars ADD CONSTRAINT content_pillars_name_check
      CHECK (char_length(btrim(name)) BETWEEN 1 AND 60);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_pillars_color_check') THEN
    ALTER TABLE public.content_pillars ADD CONSTRAINT content_pillars_color_check
      CHECK (color IS NULL OR color ~ '^#[0-9a-fA-F]{6}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_offers_name_check') THEN
    ALTER TABLE public.content_offers ADD CONSTRAINT content_offers_name_check
      CHECK (char_length(btrim(name)) BETWEEN 1 AND 60);
  END IF;
END $$;

-- El nombre es unico entre los NO archivados: uno archivado libera el nombre,
-- asi se puede volver a crear "Educativo" sin pelearse con el viejo.
CREATE UNIQUE INDEX IF NOT EXISTS uq_content_pillars_name
  ON public.content_pillars (workspace_id, lower(btrim(name)))
  WHERE archived_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_content_offers_name
  ON public.content_offers (workspace_id, lower(btrim(name)))
  WHERE archived_at IS NULL;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['content_pillars', 'content_offers'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_updated_at ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.update_updated_at()',
      t
    );

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS "%1$s_select" ON public.%1$I', t);
    EXECUTE format(
      'CREATE POLICY "%1$s_select" ON public.%1$I FOR SELECT USING (public.is_workspace_member(workspace_id))',
      t
    );

    EXECUTE format('DROP POLICY IF EXISTS "%1$s_insert" ON public.%1$I', t);
    EXECUTE format(
      'CREATE POLICY "%1$s_insert" ON public.%1$I FOR INSERT WITH CHECK (public.has_permission(workspace_id, ''settings.manage''))',
      t
    );

    EXECUTE format('DROP POLICY IF EXISTS "%1$s_update" ON public.%1$I', t);
    EXECUTE format(
      'CREATE POLICY "%1$s_update" ON public.%1$I FOR UPDATE USING (public.has_permission(workspace_id, ''settings.manage'')) WITH CHECK (public.has_permission(workspace_id, ''settings.manage''))',
      t
    );

    -- Sin policy de DELETE, a proposito: archivar es la unica forma de sacar
    -- una fila de circulacion.
    EXECUTE format('DROP POLICY IF EXISTS "%1$s_delete" ON public.%1$I', t);
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 2. Clasificacion de ideas y piezas
-- ------------------------------------------------------------

ALTER TABLE public.content_ideas
  ADD COLUMN IF NOT EXISTS content      text,
  ADD COLUMN IF NOT EXISTS platforms    text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS offer_id     uuid REFERENCES public.content_offers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pillar_id    uuid REFERENCES public.content_pillars(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS funnel_stage text;

ALTER TABLE public.content_posts
  ADD COLUMN IF NOT EXISTS script          text,
  ADD COLUMN IF NOT EXISTS recording_notes text,
  ADD COLUMN IF NOT EXISTS offer_id        uuid REFERENCES public.content_offers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pillar_id       uuid REFERENCES public.content_pillars(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS funnel_stage    text,
  ADD COLUMN IF NOT EXISTS reference       text;

COMMENT ON COLUMN public.content_ideas.content IS
  'El texto unico de la idea (reemplaza a hook + angle + notes, que quedan sin uso hasta la 00118).';
COMMENT ON COLUMN public.content_ideas.platforms IS
  'Redes a las que apunta la idea. Es una intencion: al aprobar se heredan a la pieza.';
COMMENT ON COLUMN public.content_posts.script IS
  'El guion completo para grabar (reemplaza a copy.hook + copy.body + copy.cta).';
COMMENT ON COLUMN public.content_posts.recording_notes IS
  'Instrucciones de produccion (reemplaza a copy.recording_notes).';
COMMENT ON COLUMN public.content_posts.media IS
  'La biblioteca de la pieza: todos sus archivos, subidos una vez. Cada red elige los suyos por id en networks[].files.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_ideas_funnel_check') THEN
    ALTER TABLE public.content_ideas ADD CONSTRAINT content_ideas_funnel_check
      CHECK (funnel_stage IS NULL OR funnel_stage IN ('tofu', 'mofu', 'bofu'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_posts_funnel_check') THEN
    ALTER TABLE public.content_posts ADD CONSTRAINT content_posts_funnel_check
      CHECK (funnel_stage IS NULL OR funnel_stage IN ('tofu', 'mofu', 'bofu'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_ideas_platforms_check') THEN
    ALTER TABLE public.content_ideas ADD CONSTRAINT content_ideas_platforms_check
      CHECK (platforms <@ ARRAY['instagram', 'tiktok', 'youtube', 'linkedin', 'threads']::text[]);
  END IF;
END $$;

-- Para "cuantas piezas lo usan" (Ajustes) y para agrupar en el dashboard.
CREATE INDEX IF NOT EXISTS idx_content_posts_pillar
  ON public.content_posts (workspace_id, pillar_id) WHERE pillar_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_content_posts_offer
  ON public.content_posts (workspace_id, offer_id) WHERE offer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_content_ideas_pillar
  ON public.content_ideas (workspace_id, pillar_id) WHERE pillar_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_content_ideas_offer
  ON public.content_ideas (workspace_id, offer_id) WHERE offer_id IS NOT NULL;

-- ------------------------------------------------------------
-- 3. Los pilares que eran texto pasan a ser filas
-- ------------------------------------------------------------
-- Solo toca las columnas NUEVAS (pillar_id) y solo donde esta vacia: el texto
-- viejo de content_ideas.pillar queda como estaba hasta la 00118.

INSERT INTO public.content_pillars (workspace_id, name)
SELECT DISTINCT i.workspace_id, btrim(i.pillar)
FROM public.content_ideas i
WHERE i.pillar IS NOT NULL
  AND btrim(i.pillar) <> ''
  AND char_length(btrim(i.pillar)) <= 60
  AND NOT EXISTS (
    SELECT 1 FROM public.content_pillars p
    WHERE p.workspace_id = i.workspace_id
      AND p.archived_at IS NULL
      AND lower(btrim(p.name)) = lower(btrim(i.pillar))
  );

UPDATE public.content_ideas i
SET pillar_id = p.id
FROM public.content_pillars p
WHERE i.pillar_id IS NULL
  AND i.pillar IS NOT NULL
  AND btrim(i.pillar) <> ''
  AND p.workspace_id = i.workspace_id
  AND p.archived_at IS NULL
  AND lower(btrim(p.name)) = lower(btrim(i.pillar));

-- ------------------------------------------------------------
-- 4. Aprobar una idea hereda la clasificacion
-- ------------------------------------------------------------
-- SECURITY INVOKER, igual que la v1: las dos escrituras pasan por la RLS de
-- quien llama. Las redes de la idea entran a la pieza sin fecha ni caption:
-- elegir la red es decir "va a ir aca", no "sale tal dia" (mismo criterio que
-- createPost). El guion y las notas de grabacion arrancan vacios: el texto de
-- la idea es contexto, no el guion.

CREATE OR REPLACE FUNCTION public.approve_content_idea_v2(
  p_idea_id uuid,
  p_title   text,
  p_format  text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_idea    public.content_ideas%ROWTYPE;
  v_post_id uuid;
  v_networks jsonb;
BEGIN
  SELECT * INTO v_idea FROM public.content_ideas WHERE id = p_idea_id AND deleted_at IS NULL;

  IF v_idea.id IS NULL THEN
    RAISE EXCEPTION 'idea_no_encontrada';
  END IF;

  IF v_idea.status <> 'nueva' THEN
    RAISE EXCEPTION 'idea_ya_decidida';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'platform', p,
    'planned_at', NULL,
    'caption', NULL,
    'media', NULL,
    'cta', jsonb_build_object('type', 'none', 'keyword', NULL),
    'options', '{}'::jsonb
  ) ORDER BY ord), '[]'::jsonb)
  INTO v_networks
  FROM unnest(v_idea.platforms) WITH ORDINALITY AS u(p, ord);

  INSERT INTO public.content_posts (
    workspace_id, idea_id, title, format, reference,
    offer_id, pillar_id, funnel_stage, networks,
    status, created_by, position
  )
  VALUES (
    v_idea.workspace_id, v_idea.id, p_title, COALESCE(p_format, v_idea.format), v_idea.reference,
    v_idea.offer_id, v_idea.pillar_id, v_idea.funnel_stage, v_networks,
    'draft', auth.uid(),
    coalesce((
      SELECT max(position) + 10 FROM public.content_posts
      WHERE workspace_id = v_idea.workspace_id AND status = 'draft' AND deleted_at IS NULL
    ), 10)
  )
  RETURNING id INTO v_post_id;

  UPDATE public.content_ideas
  SET status = 'aprobada', approved_by = auth.uid(), approved_at = now()
  WHERE id = v_idea.id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'sin_permiso_para_aprobar';
  END IF;

  RETURN v_post_id;
END;
$$;

COMMENT ON FUNCTION public.approve_content_idea_v2(uuid, text, text) IS
  'Crea la pieza y marca la idea aprobada en una sola transaccion, heredando clasificacion y plataformas (F91). SECURITY INVOKER: la RLS decide si puede.';

REVOKE ALL ON FUNCTION public.approve_content_idea_v2(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_content_idea_v2(uuid, text, text) TO authenticated, service_role;
