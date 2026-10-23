-- ============================================================
-- 00257_stickers
-- ============================================================
-- Stickers de WhatsApp (octubre 2026): la biblioteca del negocio.
--
-- WhatsApp no deja leer los stickers guardados en el celular (ni Baileys ni
-- Evolution exponen esa sincronizacion), asi que la biblioteca se arma sola
-- con el uso:
--   - cada sticker que se manda (desde aca o desde el celular: llegan al
--     webhook como `fromMe`) se agrega solo (`source = 'sent'`);
--   - uno recibido se guarda con un boton (`source = 'saved'`);
--   - se pueden subir imagenes o GIFs, que el servidor convierte a sticker
--     webp de 512 x 512 (`source = 'uploaded'`; un GIF queda animado).
--
-- Un sticker por contenido: `sha256` de los bytes del webp, unico por
-- workspace. Si se borra y vuelve a aparecer al mandarlo, no revive solo
-- (alguien lo saco a proposito); subirlo o guardarlo a mano si lo revive.
--
-- El archivo vive en el bucket `chat-media` (ya existe, privado, la policy de
-- lectura mira el primer segmento = workspace), bajo `<ws>/stickers/<sha>.webp`.
-- La retencion de 180 dias borra solo lo que referencia un mensaje, y un
-- sticker se COPIA a la conversacion antes de mandarse.
--
-- Escribe solo el servidor (las acciones chequean el permiso). La app lee con
-- la RLS (miembros del workspace). Nada se borra de verdad: `deleted_at`.
--
-- Aditiva: se aplica ANTES de desplegar el codigo que la usa.
--
-- Como volver atras:
--   DROP TABLE IF EXISTS public.stickers;
--
-- Idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.stickers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  storage_path  text NOT NULL,
  sha256        text NOT NULL,
  mime_type     text NOT NULL DEFAULT 'image/webp',
  is_animated   boolean NOT NULL DEFAULT false,
  size_bytes    integer,
  source        text NOT NULL,
  is_favorite   boolean NOT NULL DEFAULT false,
  use_count     integer NOT NULL DEFAULT 0,
  last_used_at  timestamptz,
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

COMMENT ON TABLE public.stickers IS
  'Biblioteca de stickers de WhatsApp (00257): los mandados se agregan solos, los recibidos se guardan con un boton, y se pueden subir. Archivo en chat-media/<ws>/stickers/<sha>.webp.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stickers_source_check') THEN
    ALTER TABLE public.stickers ADD CONSTRAINT stickers_source_check
      CHECK (source IN ('uploaded', 'sent', 'saved'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stickers_sha256_check') THEN
    ALTER TABLE public.stickers ADD CONSTRAINT stickers_sha256_check
      CHECK (sha256 ~ '^[0-9a-f]{64}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stickers_path_check') THEN
    ALTER TABLE public.stickers ADD CONSTRAINT stickers_path_check
      CHECK (storage_path = workspace_id::text || '/stickers/' || sha256 || '.webp');
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_stickers_workspace_sha
  ON public.stickers (workspace_id, sha256);

CREATE INDEX IF NOT EXISTS idx_stickers_workspace_recent
  ON public.stickers (workspace_id, last_used_at DESC NULLS LAST)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS set_updated_at ON public.stickers;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.stickers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.stickers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stickers_select" ON public.stickers;
CREATE POLICY "stickers_select" ON public.stickers
  FOR SELECT USING ((select public.is_workspace_member(workspace_id)));

-- Sin policies de escritura: escribe el servidor.

REVOKE ALL ON public.stickers FROM anon, authenticated;
GRANT SELECT ON public.stickers TO authenticated;
GRANT ALL ON public.stickers TO service_role;
