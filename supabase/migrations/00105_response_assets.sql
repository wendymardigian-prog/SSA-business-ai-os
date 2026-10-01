-- ============================================================
-- MIGRACION 00105 — LA BANCA DE RECURSOS (rediseño, F20/F21/F22 unificados)
-- ============================================================
-- Una sola tabla para los dos tipos de respuesta guardada de un workspace:
-- textos (las viejas response_templates, 00023/00026) y audios (la vieja
-- 00105_audio_assets, que nunca se aplico). `kind` las distingue.
--
-- Por que una sola tabla y no dos: eran dos tablas casi identicas (mismo
-- formato de atajo, mismo indice unico parcial, misma RLS letra por letra,
-- mismo soft delete) con un solo campo realmente distinto -- `content` vs
-- `storage_path`. Dos tablas significaban dos pantallas, dos pickers, dos
-- herramientas del agente y dos atajos ("/" y "/a") que la persona tenia que
-- recordar. Y, sobre todo: el atajo tiene que ser unico ENTRE LOS DOS TIPOS,
-- y con dos tablas eso no lo puede garantizar ningun indice.
--
-- Lo que es de cada tipo:
--   text   -> `content` (con variables {{...}}), nada de archivo.
--   audio  -> `storage_path` + `mime_type` en chat-media/<ws>/library/<id>.<ext>,
--             `description` OBLIGATORIA (es lo que lee la IA para decidir
--             cuando usarlo; NUNCA se manda) y la transcripcion.
--
-- Lo nuevo respecto de las dos tablas viejas: `tags text[]` con indice GIN.
--
-- `purge_soft_deleted` NO se toca aca: se redefine en la 00106, que es la que
-- dropea response_templates. Si se sacara esa tabla de la funcion aca,
-- response_templates dejaria de purgarse en la ventana entre las dos
-- migraciones; si se sumara response_assets aca sin sacar la otra, el DROP de
-- la 00106 dejaria la funcion apuntando a una tabla inexistente y el cron
-- empezaria a fallar. Las dos cosas van juntas, en la misma transaccion.
-- ============================================================

-- ------------------------------------------------------------
-- 1. La tabla
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.response_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,

  -- 'text' | 'audio'. Decide que columnas tienen que estar y cuales no (ver
  -- los CHECK de forma mas abajo). Se elige al crear y NO se cambia despues:
  -- convertir un texto en audio no es editar, es crear otra cosa.
  kind text NOT NULL,

  name text NOT NULL,
  -- Atajo para encontrarlo rapido con "/" en la bandeja, ej "/precio". Unico
  -- por workspace ENTRE LOS DOS TIPOS (idx_response_assets_shortcut).
  shortcut text,
  -- Para la IA: cuando corresponde usar este recurso. Obligatoria para un
  -- audio (es lo unico que el agente puede leer sin escucharlo); opcional
  -- para un texto (ahi el contenido se explica solo). Nunca se manda.
  description text,
  -- Etiquetas libres para agrupar ("precios", "objeciones"). Se buscan desde
  -- el picker igual que el nombre. Array y no tabla aparte: no tienen datos
  -- propios, no se renombran en masa y el workspace es single-tenant.
  tags text[] NOT NULL DEFAULT '{}',

  -- Solo kind='text'.
  content text,

  -- Solo kind='audio'.
  storage_path text,
  -- Nullable, a diferencia de la 00105 vieja: un texto no tiene mime. El
  -- CHECK de forma lo exige para un audio y lo prohibe para un texto.
  mime_type text,
  duration_seconds integer,
  size_bytes bigint,

  -- Que dice el audio. La llena el job transcribe_audio (el mismo de F7).
  transcript text,
  transcript_status text NOT NULL DEFAULT 'none',
  transcript_error text,
  -- 'manual' si alguien la corrigio a mano: un reintento automatico no la pisa.
  transcript_source text NOT NULL DEFAULT 'auto',
  -- La necesita el reaper de transcripciones colgadas (10 min). Sin esta
  -- columna, un 'pending' que se muere a mitad de camino queda pending para
  -- siempre y el recurso no se puede volver a habilitar para el agente.
  transcript_started_at timestamptz,

  -- 'recorded' | 'uploaded' | 'synthesized'. NULL para un texto. synthesized
  -- no se usa todavia (texto-a-voz es Etapa 3), va ahora para no migrar.
  source text,

  -- El interruptor del agente, para los dos tipos. Default FALSE: el agente
  -- arranca sin poder usar nada y se habilita recurso por recurso.
  agent_enabled boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,

  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

-- ------------------------------------------------------------
-- 2. CHECKs
-- ------------------------------------------------------------
-- Uno por regla y con nombre propio, no un CHECK gigante: el nombre del
-- constraint es el unico mensaje que llega cuando algo entra mal, asi que
-- tiene que decir QUE regla se rompio.
--
-- Los de forma se escriben `kind <> 'x' OR (...)` en vez de un OR de dos
-- bloques, para que el error nombre el tipo que fallo.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'response_assets_kind_check') THEN
    ALTER TABLE public.response_assets ADD CONSTRAINT response_assets_kind_check
      CHECK (kind IN ('text', 'audio'));
  END IF;

  -- Mismo formato que la 00026, letra por letra.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'response_assets_shortcut_format') THEN
    ALTER TABLE public.response_assets ADD CONSTRAINT response_assets_shortcut_format
      CHECK (shortcut IS NULL OR shortcut ~ '^/[a-z0-9][a-z0-9_-]{0,29}$');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'response_assets_name_not_blank') THEN
    ALTER TABLE public.response_assets ADD CONSTRAINT response_assets_name_not_blank
      CHECK (length(btrim(name)) > 0);
  END IF;

  -- Opcional, pero si esta no puede estar en blanco.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'response_assets_description_not_blank') THEN
    ALTER TABLE public.response_assets ADD CONSTRAINT response_assets_description_not_blank
      CHECK (description IS NULL OR length(btrim(description)) > 0);
  END IF;

  -- Un texto: contenido si, archivo no. Incluye mime_type y source, que en la
  -- tabla vieja de audios eran NOT NULL y aca no pueden serlo para un texto.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'response_assets_text_shape') THEN
    ALTER TABLE public.response_assets ADD CONSTRAINT response_assets_text_shape
      CHECK (kind <> 'text' OR (
        content IS NOT NULL AND length(btrim(content)) > 0
        AND storage_path IS NULL
        AND mime_type IS NULL
        AND duration_seconds IS NULL
        AND size_bytes IS NULL
        AND source IS NULL
      ));
  END IF;

  -- Un texto nunca puede parecer un audio a medio transcribir: si no, la
  -- pantalla y el agente tendrian que preguntar el kind antes de leer el
  -- estado de transcripcion en vez de confiar en la base.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'response_assets_text_no_transcript') THEN
    ALTER TABLE public.response_assets ADD CONSTRAINT response_assets_text_no_transcript
      CHECK (kind <> 'text' OR (
        transcript IS NULL
        AND transcript_status = 'none'
        AND transcript_error IS NULL
        AND transcript_started_at IS NULL
      ));
  END IF;

  -- Un audio: archivo y mime si, contenido no, y descripcion obligatoria.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'response_assets_audio_shape') THEN
    ALTER TABLE public.response_assets ADD CONSTRAINT response_assets_audio_shape
      CHECK (kind <> 'audio' OR (
        storage_path IS NOT NULL AND length(btrim(storage_path)) > 0
        AND mime_type IS NOT NULL
        AND content IS NULL
        AND description IS NOT NULL
        AND source IS NOT NULL
      ));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'response_assets_transcript_status_check') THEN
    ALTER TABLE public.response_assets ADD CONSTRAINT response_assets_transcript_status_check
      CHECK (transcript_status IN ('none', 'pending', 'ready', 'failed'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'response_assets_transcript_source_check') THEN
    ALTER TABLE public.response_assets ADD CONSTRAINT response_assets_transcript_source_check
      CHECK (transcript_source IN ('auto', 'manual'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'response_assets_source_check') THEN
    ALTER TABLE public.response_assets ADD CONSTRAINT response_assets_source_check
      CHECK (source IS NULL OR source IN ('recorded', 'uploaded', 'synthesized'));
  END IF;

  -- Un CHECK no puede llevar subconsulta, asi que "ninguna etiqueta vacia" se
  -- valida en TypeScript. Aca va lo que si se puede: ningun NULL adentro del
  -- array y un tope sano, para que nadie pegue mil etiquetas.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'response_assets_tags_sane') THEN
    ALTER TABLE public.response_assets ADD CONSTRAINT response_assets_tags_sane
      CHECK (array_position(tags, NULL) IS NULL AND cardinality(tags) <= 20);
  END IF;
END;
$$;

-- ------------------------------------------------------------
-- 3. Indices
-- ------------------------------------------------------------

-- El listado de la pantalla y el del picker, ordenados por nombre.
CREATE INDEX IF NOT EXISTS idx_response_assets_workspace
  ON public.response_assets(workspace_id, name) WHERE deleted_at IS NULL;

-- Las pestañas Textos / Audios de la pantalla.
CREATE INDEX IF NOT EXISTS idx_response_assets_kind
  ON public.response_assets(workspace_id, kind, name) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_response_assets_deleted_at
  ON public.response_assets(deleted_at) WHERE deleted_at IS NOT NULL;

-- Para listar_recursos: solo los habilitados y activos.
CREATE INDEX IF NOT EXISTS idx_response_assets_agent_enabled
  ON public.response_assets(workspace_id)
  WHERE deleted_at IS NULL AND agent_enabled = true AND is_active = true;

-- Unico por workspace y ENTRE LOS DOS TIPOS: al no llevar `kind`, el indice
-- ya impide que un texto y un audio compartan atajo. Eso es exactamente lo
-- que con dos tablas no se podia garantizar.
CREATE UNIQUE INDEX IF NOT EXISTS idx_response_assets_shortcut
  ON public.response_assets(workspace_id, shortcut)
  WHERE deleted_at IS NULL AND shortcut IS NOT NULL;

-- Las etiquetas se buscan por contenido (@>, &&), no por prefijo: GIN.
-- Sin workspace_id adelante a proposito: un indice GIN compuesto con una
-- columna btree necesita la extension btree_gin, que no esta instalada. El
-- filtro por workspace lo resuelve el planner con el btree de arriba, y a la
-- escala de este sistema la diferencia no existe.
CREATE INDEX IF NOT EXISTS idx_response_assets_tags
  ON public.response_assets USING gin (tags);

-- ------------------------------------------------------------
-- 4. Trigger
-- ------------------------------------------------------------

DROP TRIGGER IF EXISTS set_updated_at ON public.response_assets;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.response_assets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ------------------------------------------------------------
-- 5. Comentarios
-- ------------------------------------------------------------

COMMENT ON TABLE public.response_assets IS
  'La banca de recursos: textos (ex response_templates) y audios en una sola tabla, distinguidos por `kind`. El atajo es unico entre los dos tipos.';
COMMENT ON COLUMN public.response_assets.kind IS
  'text | audio. Decide que columnas aplican (ver response_assets_text_shape y _audio_shape). No se cambia despues de crear.';
COMMENT ON COLUMN public.response_assets.description IS
  'Obligatoria para un audio, opcional para un texto. Es lo que lee el agente para decidir CUANDO usar este recurso -- nunca se manda.';
COMMENT ON COLUMN public.response_assets.tags IS
  'Etiquetas libres. Se buscan desde el picker "/" igual que el nombre (indice GIN).';
COMMENT ON COLUMN public.response_assets.transcript_source IS
  'auto: la escribio el job de transcripcion. manual: alguien la corrigio a mano, y un reintento automatico no la pisa.';
COMMENT ON COLUMN public.response_assets.transcript_started_at IS
  'Cuando se reclamo la transcripcion. La usa el reaper de pendientes colgados (10 min).';
COMMENT ON COLUMN public.response_assets.agent_enabled IS
  'El interruptor del agente, para los dos tipos. Un audio ademas necesita transcripcion lista; un texto no necesita nada mas.';

-- ------------------------------------------------------------
-- 6. RLS — igual que response_templates (00023:220-239), letra por letra
-- ------------------------------------------------------------

ALTER TABLE public.response_assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "response_assets_select" ON public.response_assets;
CREATE POLICY "response_assets_select" ON public.response_assets
  FOR SELECT USING (deleted_at IS NULL AND public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "response_assets_insert" ON public.response_assets;
CREATE POLICY "response_assets_insert" ON public.response_assets
  FOR INSERT WITH CHECK (public.is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "response_assets_update" ON public.response_assets;
CREATE POLICY "response_assets_update" ON public.response_assets
  FOR UPDATE USING (public.is_workspace_admin(workspace_id))
  WITH CHECK (public.is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "response_assets_delete" ON public.response_assets;
CREATE POLICY "response_assets_delete" ON public.response_assets
  FOR DELETE USING (public.is_workspace_admin(workspace_id));
