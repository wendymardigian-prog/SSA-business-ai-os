-- 00508: el borrador de una automatización sabe quién lo dejó y tiene una revisión; cada versión publicada puede
-- llevar una nota.
--
-- - `flows.draft_updated_by`: quién guardó el borrador por última vez (para el aviso «Hay cambios sin publicar de…»).
-- - `flows.draft_rev`: sube con cada escritura del borrador (guardar, descartar, publicar, restaurar). El lienzo guarda
--   con `UPDATE … WHERE draft_rev = <la que vio>`: si otra persona guardó en el medio, no se pisa y se avisa.
-- - `flow_versions.note`: lo que escribió quien publicó (opcional, hasta 280 caracteres).
--
-- Aditiva: sin el código nuevo nadie las lee. Va ANTES de desplegar el código (el lienzo las escribe al guardar).

ALTER TABLE public.flows
  ADD COLUMN IF NOT EXISTS draft_updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.flows
  ADD COLUMN IF NOT EXISTS draft_rev integer NOT NULL DEFAULT 0;
ALTER TABLE public.flow_versions
  ADD COLUMN IF NOT EXISTS note text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'flow_versions_note_len') THEN
    ALTER TABLE public.flow_versions ADD CONSTRAINT flow_versions_note_len CHECK (note IS NULL OR char_length(note) <= 280);
  END IF;
END $$;

COMMENT ON COLUMN public.flows.draft_updated_by IS 'Quién guardó por última vez los cambios sin publicar.';
COMMENT ON COLUMN public.flows.draft_rev IS 'Revisión del borrador: sube con cada escritura. Guardar exige la que se vio (no pisar a otra persona).';
COMMENT ON COLUMN public.flow_versions.note IS 'Nota opcional de quien publicó esta versión.';
