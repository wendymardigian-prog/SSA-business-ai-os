-- ============================================================
-- MIGRACION 00105 — LA BANCA DE AUDIOS (F20)
-- ============================================================
-- Una biblioteca de audios pregrabados por workspace, con nombre, atajo,
-- descripcion y transcripcion, que los setters pueden mandar desde el chat
-- con un clic y que el agente puede usar como herramienta.
--
-- El patron es `response_templates` (00023_crm_tables.sql), letra por letra
-- en lo que se puede: mismo esquema de CHECK para el atajo, mismo indice
-- unico parcial, mismo RLS (cualquier miembro lee, solo Owner/Admin
-- administra), y se suma a `purge_soft_deleted` igual que las plantillas.
--
-- Lo que NO es igual a un template:
--   - `description` es obligatoria y NO es lo que se manda: es lo que LEE LA
--     IA para decidir cuando corresponde usar este audio (F20, F22).
--   - `storage_path` + `mime_type` en vez de `content`: el archivo vive en
--     `chat-media/<workspace_id>/library/<id>.<ext>`.
--   - `transcript` + `transcript_status` + `transcript_source`: todo audio se
--     transcribe al crearlo (mismo job `transcribe_audio` del Bloque 2,
--     apuntando aca en vez de a `messages`). `transcript_source` distingue
--     una correccion manual de la automatica, para que un reintento no pise
--     lo que alguien corrigio a mano.
--   - `source` (recorded|uploaded|synthesized): synthesized no se usa todavia
--     (texto-a-voz es Etapa 3), pero se agrega ahora para no migrar despues.
--   - `agent_enabled`: default FALSE. El agente arranca sin poder usar
--     ninguno; se habilita audio por audio desde la pantalla.
-- ============================================================

-- ------------------------------------------------------------
-- 1. La tabla
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.audio_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,

  name text NOT NULL,
  -- Atajo para buscarlo rapido en el picker del chat ("/a"), ej "/precio".
  shortcut text,
  -- Para la IA: cuando corresponde usar este audio. Lo dice la UI con esas
  -- palabras. Nunca se manda: es contexto para decidir, no contenido.
  description text NOT NULL,

  storage_path text NOT NULL,
  mime_type text NOT NULL,
  duration_seconds integer,
  size_bytes bigint,

  -- Que dice el audio. Se llena solo al crearlo (mismo job que F7).
  transcript text,
  transcript_status text NOT NULL DEFAULT 'none',
  transcript_error text,
  -- 'manual' si alguien corrigio el texto a mano: un reintento automatico no
  -- la pisa.
  transcript_source text NOT NULL DEFAULT 'auto',
  transcript_started_at timestamptz,

  source text NOT NULL DEFAULT 'recorded',
  agent_enabled boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,

  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_audio_assets_workspace
  ON public.audio_assets(workspace_id, name) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_audio_assets_deleted_at
  ON public.audio_assets(deleted_at) WHERE deleted_at IS NOT NULL;
-- Para listar_audios (F22): solo los habilitados y ya transcriptos.
CREATE INDEX IF NOT EXISTS idx_audio_assets_agent_enabled
  ON public.audio_assets(workspace_id) WHERE deleted_at IS NULL AND agent_enabled = true AND is_active = true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'audio_assets_shortcut_format'
  ) THEN
    ALTER TABLE public.audio_assets ADD CONSTRAINT audio_assets_shortcut_format
      CHECK (shortcut IS NULL OR shortcut ~ '^/[a-z0-9][a-z0-9_-]{0,29}$');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'audio_assets_name_not_blank'
  ) THEN
    ALTER TABLE public.audio_assets ADD CONSTRAINT audio_assets_name_not_blank
      CHECK (length(btrim(name)) > 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'audio_assets_description_not_blank'
  ) THEN
    ALTER TABLE public.audio_assets ADD CONSTRAINT audio_assets_description_not_blank
      CHECK (length(btrim(description)) > 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'audio_assets_transcript_status_check'
  ) THEN
    ALTER TABLE public.audio_assets ADD CONSTRAINT audio_assets_transcript_status_check
      CHECK (transcript_status IN ('none', 'pending', 'ready', 'failed'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'audio_assets_transcript_source_check'
  ) THEN
    ALTER TABLE public.audio_assets ADD CONSTRAINT audio_assets_transcript_source_check
      CHECK (transcript_source IN ('auto', 'manual'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'audio_assets_source_check'
  ) THEN
    ALTER TABLE public.audio_assets ADD CONSTRAINT audio_assets_source_check
      CHECK (source IN ('recorded', 'uploaded', 'synthesized'));
  END IF;
END;
$$;

-- Unico por workspace, igual que response_templates (00026).
CREATE UNIQUE INDEX IF NOT EXISTS idx_audio_assets_shortcut
  ON public.audio_assets(workspace_id, shortcut)
  WHERE deleted_at IS NULL AND shortcut IS NOT NULL;

DROP TRIGGER IF EXISTS set_updated_at ON public.audio_assets;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.audio_assets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

COMMENT ON TABLE public.audio_assets IS
  'La banca de audios reutilizables (F20): nombre, atajo, descripcion (para la IA) y transcripcion. El archivo vive en chat-media/<workspace_id>/library/<id>.<ext>.';
COMMENT ON COLUMN public.audio_assets.description IS
  'Obligatoria. Es lo que lee el agente para decidir CUANDO usar este audio -- nunca se manda.';
COMMENT ON COLUMN public.audio_assets.transcript_source IS
  'auto: la escribio el job de transcripcion. manual: alguien la corrigio a mano, y un reintento automatico no la pisa.';

-- ------------------------------------------------------------
-- 2. RLS — igual que response_templates
-- ------------------------------------------------------------

ALTER TABLE public.audio_assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audio_assets_select" ON public.audio_assets;
CREATE POLICY "audio_assets_select" ON public.audio_assets
  FOR SELECT USING (deleted_at IS NULL AND public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "audio_assets_insert" ON public.audio_assets;
CREATE POLICY "audio_assets_insert" ON public.audio_assets
  FOR INSERT WITH CHECK (public.is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "audio_assets_update" ON public.audio_assets;
CREATE POLICY "audio_assets_update" ON public.audio_assets
  FOR UPDATE USING (public.is_workspace_admin(workspace_id))
  WITH CHECK (public.is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "audio_assets_delete" ON public.audio_assets;
CREATE POLICY "audio_assets_delete" ON public.audio_assets
  FOR DELETE USING (public.is_workspace_admin(workspace_id));

-- ------------------------------------------------------------
-- 3. purge_soft_deleted suma audio_assets
-- ------------------------------------------------------------
-- Se reescribe copiando la 00098 completa (es la ultima definicion) y
-- sumando SOLO el DELETE de audio_assets y su clave en el jsonb. El purgado
-- de la FILA no borra el archivo de Storage: eso lo hace el cron
-- content-media-cleanup (TypeScript, Bloque 6), que borra los archivos de
-- audios dados de baja hace mas de 28 dias, antes de que esto se lleve la
-- fila a los 30.

CREATE OR REPLACE FUNCTION public.purge_soft_deleted(p_retention_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_cutoff     timestamptz := now() - make_interval(days => GREATEST(p_retention_days, 0));
  v_contacts   integer := 0;
  v_notes      integer := 0;
  v_convs      integer := 0;
  v_templates  integer := 0;
  v_schedules  integer := 0;
  v_ooo        integer := 0;
  v_events     integer := 0;
  v_audios     integer := 0;
BEGIN
  DELETE FROM public.contacts WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
  GET DIAGNOSTICS v_contacts = ROW_COUNT;

  DELETE FROM public.conversations WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
  GET DIAGNOSTICS v_convs = ROW_COUNT;

  DELETE FROM public.contact_notes WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
  GET DIAGNOSTICS v_notes = ROW_COUNT;

  DELETE FROM public.response_templates WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
  GET DIAGNOSTICS v_templates = ROW_COUNT;

  DELETE FROM public.availability_schedules WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
  GET DIAGNOSTICS v_schedules = ROW_COUNT;

  DELETE FROM public.out_of_office WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
  GET DIAGNOSTICS v_ooo = ROW_COUNT;

  -- Un evento con agendas NO se purga: la agenda guarda su historia y apunta
  -- al evento. (bookings llega en la 00099; antes de eso la condicion de
  -- existencia da falso y se purgan todos los borrados.)
  IF to_regclass('public.bookings') IS NULL THEN
    DELETE FROM public.event_types WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
  ELSE
    EXECUTE '
      DELETE FROM public.event_types e
      WHERE e.deleted_at IS NOT NULL AND e.deleted_at < $1
        AND NOT EXISTS (SELECT 1 FROM public.bookings b WHERE b.event_type_id = e.id)
    ' USING v_cutoff;
  END IF;
  GET DIAGNOSTICS v_events = ROW_COUNT;

  DELETE FROM public.audio_assets WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
  GET DIAGNOSTICS v_audios = ROW_COUNT;

  RETURN jsonb_build_object(
    'cutoff', v_cutoff,
    'contacts', v_contacts,
    'conversations', v_convs,
    'contact_notes', v_notes,
    'response_templates', v_templates,
    'availability_schedules', v_schedules,
    'out_of_office', v_ooo,
    'event_types', v_events,
    'audio_assets', v_audios
  );
END;
$$;

REVOKE ALL ON FUNCTION public.purge_soft_deleted(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_soft_deleted(integer) TO service_role;
