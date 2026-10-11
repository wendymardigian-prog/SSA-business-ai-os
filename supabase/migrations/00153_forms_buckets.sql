-- ============================================================================
-- 00153 — Formularios: buckets privados para archivos y contratos
-- ============================================================================
-- Dos buckets, los dos PRIVADOS y SIN policies para clientes:
--
--   form-uploads   archivos que sube quien responde un formulario.
--                  {workspace_id}/{form_id}/{idempotency_key}/{field_key}/{uuid}.{ext}
--   contracts      firma dibujada y PDF firmado de un contrato.
--                  {workspace_id}/{form_id}/{idempotency_key}/signature.png
--                  {workspace_id}/{form_id}/{signature_id}/contrato-v<N>.pdf
--
-- Sin policies para `authenticated` ni `anon`: escribe y firma SOLO el servidor
-- (service role). La lectura es un link firmado de 60 segundos que el servidor
-- genera unicamente si `can_see_form_submission` da true. Que sean privados es
-- una condicion de seguridad: si ya existian (creados a mano), se les fuerza.
--
-- El primer segmento del path es el workspace, como en `chat-media`.
--
-- Aditiva e idempotente.
--
-- Como volver atras (solo si estan vacios):
--   select count(*) from storage.objects where bucket_id in ('form-uploads','contracts');  -- 0
--   DELETE FROM storage.buckets WHERE id IN ('form-uploads', 'contracts');
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'form-uploads',
  'form-uploads',
  false,
  10485760,  -- 10 MB
  ARRAY[
    'image/jpeg', 'image/png', 'image/webp',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'contracts',
  'contracts',
  false,
  10485760,  -- 10 MB
  ARRAY['image/png', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;
