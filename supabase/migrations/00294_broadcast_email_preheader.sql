-- 00294_broadcast_email_preheader: la linea que la bandeja de entrada muestra al lado del asunto de un broadcast de email.
--
-- Aditiva. Va ANTES de desplegar el codigo: el editor guarda esta columna con cada borrador.
-- En el paso «Enviar email» de un flujo el preheader vive en los datos del nodo: no necesita columna.
--
-- Como volver atras: ALTER TABLE public.broadcasts DROP COLUMN IF EXISTS email_preheader;
-- (despues de volver al codigo anterior).

ALTER TABLE public.broadcasts ADD COLUMN IF NOT EXISTS email_preheader text;

COMMENT ON COLUMN public.broadcasts.email_preheader IS
  'Email: la linea que la bandeja de entrada muestra al lado del asunto. Admite las variables del broadcast. Opcional.';
