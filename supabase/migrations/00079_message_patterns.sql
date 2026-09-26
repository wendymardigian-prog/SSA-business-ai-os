-- ============================================================================
-- 00079 — Patrones de mensajes (Bloque 4, F19-F22)
-- ============================================================================
-- Agrupa los mensajes por lo que significan. Capa 1 gratis (normalización);
-- capa 2 con un LLM chico en lote (Bloque 4/5). Dos tablas nuevas
-- (message_categories, message_texts), la columna generada messages.text_norm
-- y un trigger que crea la fila del texto al entrar cada mensaje.
--
-- Idempotente y aditiva. El backfill solo inserta.
-- ============================================================================

-- 1. Tablas -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.message_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  name text NOT NULL,
  description text,
  examples text[] NOT NULL DEFAULT '{}',
  is_fallback boolean NOT NULL DEFAULT false,
  created_by text NOT NULL CHECK (created_by IN ('model', 'user', 'system')),
  created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  merged_into_id uuid REFERENCES public.message_categories(id) ON DELETE SET NULL,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_message_categories_name
  ON public.message_categories (workspace_id, direction, lower(name)) WHERE archived_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_message_categories_fallback
  ON public.message_categories (workspace_id, direction) WHERE is_fallback;

CREATE TABLE IF NOT EXISTS public.message_texts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  normalized_text text NOT NULL,
  sample_text text NOT NULL,
  category_id uuid REFERENCES public.message_categories(id) ON DELETE SET NULL,
  confidence numeric(3, 2),
  source text CHECK (source IN ('rule', 'model', 'human')),
  prompt_version integer,
  run_id uuid REFERENCES public.agent_runs(id) ON DELETE SET NULL,
  is_button boolean NOT NULL DEFAULT false,
  classified_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  review_result text CHECK (review_result IN ('ok', 'corrected')),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_message_texts_norm
  ON public.message_texts (workspace_id, direction, normalized_text);
CREATE INDEX IF NOT EXISTS idx_message_texts_category ON public.message_texts (workspace_id, category_id);
CREATE INDEX IF NOT EXISTS idx_message_texts_unclassified
  ON public.message_texts (workspace_id, direction) WHERE category_id IS NULL;

-- 2. Columna generada messages.text_norm -----------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'messages' AND column_name = 'text_norm') THEN
    ALTER TABLE public.messages ADD COLUMN text_norm text GENERATED ALWAYS AS (public.normalize_for_grouping(text)) STORED;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_messages_workspace_textnorm ON public.messages (workspace_id, direction, text_norm);

-- 3. RLS --------------------------------------------------------------------
ALTER TABLE public.message_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_texts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS message_categories_select ON public.message_categories;
CREATE POLICY message_categories_select ON public.message_categories FOR SELECT USING (public.is_workspace_member(workspace_id));
DROP POLICY IF EXISTS message_categories_write ON public.message_categories;
CREATE POLICY message_categories_write ON public.message_categories FOR ALL
  USING (public.is_workspace_admin(workspace_id)) WITH CHECK (public.is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS message_texts_select ON public.message_texts;
CREATE POLICY message_texts_select ON public.message_texts FOR SELECT USING (public.is_workspace_member(workspace_id));
DROP POLICY IF EXISTS message_texts_write ON public.message_texts;
CREATE POLICY message_texts_write ON public.message_texts FOR ALL
  USING (public.is_workspace_admin(workspace_id)) WITH CHECK (public.is_workspace_admin(workspace_id));

-- 4. Categorías fallback por dirección --------------------------------------
INSERT INTO public.message_categories (workspace_id, direction, name, is_fallback, created_by)
SELECT w.id, d.dir, 'Otro', true, 'system'
FROM public.workspaces w CROSS JOIN (VALUES ('inbound'), ('outbound')) AS d(dir)
ON CONFLICT DO NOTHING;

INSERT INTO public.message_categories (workspace_id, direction, name, is_fallback, created_by)
SELECT w.id, d.dir, 'Solo emoji o adjunto', false, 'system'
FROM public.workspaces w CROSS JOIN (VALUES ('inbound'), ('outbound')) AS d(dir)
ON CONFLICT DO NOTHING;

-- 5. Trigger: cada mensaje con texto crea (o reusa) su fila ------------------
CREATE OR REPLACE FUNCTION public.messages_upsert_text()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_norm text;
  v_emoji_cat uuid;
BEGIN
  IF NEW.text IS NULL OR btrim(NEW.text) = '' THEN
    RETURN NEW;
  END IF;
  v_norm := public.normalize_for_grouping(NEW.text);

  IF v_norm = '' THEN
    -- Solo emoji/adjunto: va directo a su categoría con source rule.
    SELECT id INTO v_emoji_cat FROM public.message_categories
      WHERE workspace_id = NEW.workspace_id AND direction = NEW.direction AND name = 'Solo emoji o adjunto' LIMIT 1;
    INSERT INTO public.message_texts (workspace_id, direction, normalized_text, sample_text, category_id, source, first_seen_at)
    VALUES (NEW.workspace_id, NEW.direction, '', NEW.text, v_emoji_cat, 'rule', NEW.created_at)
    ON CONFLICT (workspace_id, direction, normalized_text) DO NOTHING;
  ELSE
    INSERT INTO public.message_texts (workspace_id, direction, normalized_text, sample_text, first_seen_at)
    VALUES (NEW.workspace_id, NEW.direction, v_norm, NEW.text, NEW.created_at)
    ON CONFLICT (workspace_id, direction, normalized_text) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS messages_upsert_text ON public.messages;
CREATE TRIGGER messages_upsert_text
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.messages_upsert_text();

-- 6. Backfill de message_texts con lo ya guardado --------------------------
-- Un texto distinto por (workspace, dirección, normalizado). sample_text = el
-- más viejo. first_seen_at = su primera aparición.
INSERT INTO public.message_texts (workspace_id, direction, normalized_text, sample_text, first_seen_at)
SELECT m.workspace_id, m.direction, public.normalize_for_grouping(m.text),
       (ARRAY_AGG(m.text ORDER BY m.created_at))[1],
       MIN(m.created_at)
FROM public.messages m
WHERE m.text IS NOT NULL AND btrim(m.text) <> ''
GROUP BY m.workspace_id, m.direction, public.normalize_for_grouping(m.text)
ON CONFLICT (workspace_id, direction, normalized_text) DO NOTHING;

-- Los textos vacíos (solo emoji/adjunto) van a su categoría con source rule.
UPDATE public.message_texts t
SET category_id = c.id, source = 'rule'
FROM public.message_categories c
WHERE t.normalized_text = '' AND t.category_id IS NULL
  AND c.workspace_id = t.workspace_id AND c.direction = t.direction AND c.name = 'Solo emoji o adjunto';

-- 7. Textos de botón conocidos (§10.6). Categoría inbound "Respuesta a botón",
-- los 12 textos con is_button = true y source = 'rule' (no los toca el modelo).
INSERT INTO public.message_categories (workspace_id, direction, name, description, is_fallback, created_by)
SELECT w.id, 'inbound', 'Respuesta a botón', 'Clic en un botón de ManyChat u otra automatización', false, 'system'
FROM public.workspaces w
ON CONFLICT DO NOTHING;

WITH buttons(t) AS (VALUES
  ('si enviamelo'), ('quiero aprender'), ('tengo un negocio'), ('tengo una base'),
  ('si quiero a clase'), ('si quiero la clase'), ('generar contenido'), ('empiezo de 0'),
  ('automatizar todo'), ('equipo ventas ia'), ('agentes'), ('responder mensajes')
)
UPDATE public.message_texts t
SET is_button = true, source = 'rule',
    category_id = c.id
FROM buttons b, public.message_categories c
WHERE t.direction = 'inbound' AND t.normalized_text = b.t
  AND c.direction = 'inbound' AND c.name = 'Respuesta a botón' AND c.workspace_id = t.workspace_id;

-- 8. Categorías de sistema al crear un workspace ----------------------------
-- Sin esto, un workspace nuevo (o el de prueba de verify-dashboards) no tiene
-- "Otro" ni "Solo emoji o adjunto", y el trigger de textos no puede clasificar
-- los emojis. Con esto cada workspace nace con sus categorías fallback.
CREATE OR REPLACE FUNCTION public.seed_message_categories()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.message_categories (workspace_id, direction, name, is_fallback, created_by)
  VALUES (NEW.id, 'inbound', 'Otro', true, 'system'), (NEW.id, 'outbound', 'Otro', true, 'system'),
         (NEW.id, 'inbound', 'Solo emoji o adjunto', false, 'system'), (NEW.id, 'outbound', 'Solo emoji o adjunto', false, 'system')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS seed_message_categories ON public.workspaces;
CREATE TRIGGER seed_message_categories AFTER INSERT ON public.workspaces FOR EACH ROW EXECUTE FUNCTION public.seed_message_categories();

-- 9. Patrones para el dashboard (F22): categorías con su volumen de mensajes y
-- las variantes principales. El volumen cuenta MENSAJES (no textos distintos).
CREATE OR REPLACE FUNCTION public.chat_dashboard_patterns(
  p_workspace_id uuid, p_direction text, p_from timestamptz, p_to timestamptz
)
RETURNS TABLE (category_id uuid, category_name text, is_fallback boolean, message_count bigint, text_count bigint, top_variants jsonb)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH msg_counts AS (
    SELECT m.text_norm, COUNT(*) AS n
    FROM public.messages m
    WHERE m.workspace_id = p_workspace_id AND m.direction = p_direction
      AND m.text_norm IS NOT NULL AND m.text_norm <> ''
      AND (p_from IS NULL OR m.created_at >= p_from) AND (p_to IS NULL OR m.created_at <= p_to)
    GROUP BY m.text_norm
  ),
  texts AS (
    SELECT t.id, t.category_id, t.normalized_text, t.sample_text, t.confidence, t.is_button,
           COALESCE(mc.n, 0) AS msg_n
    FROM public.message_texts t
    LEFT JOIN msg_counts mc ON mc.text_norm = t.normalized_text
    WHERE t.workspace_id = p_workspace_id AND t.direction = p_direction
  )
  SELECT c.id, c.name, c.is_fallback,
    COALESCE(SUM(t.msg_n), 0)::bigint AS message_count,
    COUNT(t.id)::bigint AS text_count,
    COALESCE((
      SELECT jsonb_agg(v) FROM (
        SELECT jsonb_build_object('text', t2.sample_text, 'count', t2.msg_n, 'confidence', t2.confidence, 'is_button', t2.is_button) AS v
        FROM texts t2 WHERE t2.category_id IS NOT DISTINCT FROM c.id ORDER BY t2.msg_n DESC LIMIT 5
      ) top
    ), '[]'::jsonb) AS top_variants
  FROM public.message_categories c
  LEFT JOIN texts t ON t.category_id = c.id
  WHERE c.workspace_id = p_workspace_id AND c.direction = p_direction AND c.archived_at IS NULL
  GROUP BY c.id, c.name, c.is_fallback
  ORDER BY COALESCE(SUM(t.msg_n), 0) DESC;
$$;
REVOKE ALL ON FUNCTION public.chat_dashboard_patterns(uuid, text, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_dashboard_patterns(uuid, text, timestamptz, timestamptz) TO authenticated, service_role;
