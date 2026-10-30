-- ============================================================
-- 00270_contacts_email_status
-- ============================================================
-- Suscripcion a emails (E1, M1). ADITIVA: columnas nuevas, indices y backfill.
-- Ninguna tabla nueva. Se aplica ANTES de desplegar el codigo.
--
-- Que suma:
--   1. contacts.email_status: 'subscribed' | 'unsubscribed' | 'bounced' | 'complained'
--      (NOT NULL, default 'subscribed'). Vale para las dos direcciones del contacto
--      (email y secundario). `is_subscribed` NO se toca: sigue siendo solo de las
--      difusiones por chat.
--   2. contacts.email_status_at: cuando paso al estado actual (en una importacion,
--      la fecha original).
--   3. contacts.email_status_source: de donde vino (unsubscribe_page, one_click,
--      admin, flow, resend_bounce, resend_complaint, import:<origen>, inherit,
--      merge, backfill).
--   4. contacts.email_subscribed_at: cuando dio el consentimiento original.
--   5. contacts.email_unsubscribe_token: uuid opaco y unico para el link de baja.
--      No es un secreto de nivel credencial: solo permite darse de baja.
--   6. workspaces.email_footer_address: direccion postal opcional del pie de los
--      emails de marketing (Ajustes -> General -> Marca).
--   7. Dos indices NO unicos para buscar una direccion normalizada dentro del
--      workspace, INCLUIDOS los contactos borrados (una baja no se "borra"
--      borrando el contacto). El unico `uq_contacts_workspace_email` (00205)
--      excluye borrados y no cubre el secundario: no sirve para esto.
--   8. Backfill: todos quedan 'subscribed', con email_subscribed_at y
--      email_status_at = created_at y source 'backfill'. Sin entradas en audit_log.
--      El trigger `set_updated_at` se apaga SOLO durante ese UPDATE (misma
--      transaccion): el backfill no cambia el `updated_at` de ningun contacto.
--
-- Cómo volver atrás (en este orden; ningun codigo viejo lee estas columnas):
--   DROP INDEX IF EXISTS public.idx_contacts_ws_email_all;
--   DROP INDEX IF EXISTS public.idx_contacts_ws_secondary_email_all;
--   DROP INDEX IF EXISTS public.uq_contacts_email_unsubscribe_token;
--   ALTER TABLE public.contacts
--     DROP CONSTRAINT IF EXISTS contacts_email_status_check,
--     DROP COLUMN IF EXISTS email_status,
--     DROP COLUMN IF EXISTS email_status_at,
--     DROP COLUMN IF EXISTS email_status_source,
--     DROP COLUMN IF EXISTS email_subscribed_at,
--     DROP COLUMN IF EXISTS email_unsubscribe_token;
--   ALTER TABLE public.workspaces
--     DROP CONSTRAINT IF EXISTS workspaces_email_footer_address_len,
--     DROP COLUMN IF EXISTS email_footer_address;
--   (Si ya esta aplicada la 00271, revertir primero esa.)
--
-- Idempotente: IF NOT EXISTS en columnas e indices, DO $$ para el CHECK, y el
-- backfill solo toca filas sin `email_status_source`.
-- ============================================================

-- 1-5. Columnas de contacts
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS email_status text NOT NULL DEFAULT 'subscribed',
  ADD COLUMN IF NOT EXISTS email_status_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS email_status_source text,
  ADD COLUMN IF NOT EXISTS email_subscribed_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS email_unsubscribe_token uuid DEFAULT gen_random_uuid();

-- Una fila sin token (no deberia haber: el default lo llena al agregar la columna).
UPDATE public.contacts SET email_unsubscribe_token = gen_random_uuid() WHERE email_unsubscribe_token IS NULL;
ALTER TABLE public.contacts ALTER COLUMN email_unsubscribe_token SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contacts_email_status_check') THEN
    ALTER TABLE public.contacts
      ADD CONSTRAINT contacts_email_status_check
      CHECK (email_status IN ('subscribed', 'unsubscribed', 'bounced', 'complained'));
  END IF;
END $$;

COMMENT ON COLUMN public.contacts.email_status IS
  'Estado de las direcciones de email del contacto: subscribed | unsubscribed | bounced | complained. Se cambia SOLO con public.set_email_status / set_email_status_by_address (00271). No es is_subscribed (difusiones por chat).';
COMMENT ON COLUMN public.contacts.email_unsubscribe_token IS
  'Token opaco del link de baja (/baja/<token>). Solo permite darse de baja.';

-- 6. Pie de los emails de marketing
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS email_footer_address text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspaces_email_footer_address_len') THEN
    ALTER TABLE public.workspaces
      ADD CONSTRAINT workspaces_email_footer_address_len
      CHECK (email_footer_address IS NULL OR char_length(email_footer_address) <= 300);
  END IF;
END $$;

-- 7. Indices
CREATE UNIQUE INDEX IF NOT EXISTS uq_contacts_email_unsubscribe_token
  ON public.contacts (email_unsubscribe_token);

CREATE INDEX IF NOT EXISTS idx_contacts_ws_email_all
  ON public.contacts (workspace_id, public.normalize_email(email))
  WHERE public.normalize_email(email) IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_ws_secondary_email_all
  ON public.contacts (workspace_id, public.normalize_email(secondary_email))
  WHERE public.normalize_email(secondary_email) IS NOT NULL;

-- 8. Backfill (sin tocar updated_at). Corre UNA vez: si ya hay filas 'backfill',
-- no se repite (los contactos creados despues nacen con source NULL y sus fechas
-- reales, y la guardia de la 00271 no deja tocarlos por fuera de la funcion).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.contacts WHERE email_status_source = 'backfill') THEN
    ALTER TABLE public.contacts DISABLE TRIGGER set_updated_at;
    UPDATE public.contacts
       SET email_subscribed_at = created_at,
           email_status_at = created_at,
           email_status_source = 'backfill'
     WHERE email_status_source IS NULL;
    ALTER TABLE public.contacts ENABLE TRIGGER set_updated_at;
  END IF;
END $$;
