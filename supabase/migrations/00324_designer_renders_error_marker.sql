-- 00324_designer_renders_error_marker
--
-- Diseñador IA: una exportación que falla del todo deja `design-renders/<ws>/<pieza>/exports/<marca>/error.json` con
-- el motivo, para que la pantalla deje de mostrar «Preparando tu archivo…» y diga por qué (`EXPORT_ERROR_FILE`,
-- lib/designer/jobs/render.ts). El bucket (00319) solo aceptaba PNG, PDF y ZIP, así que ese archivo nunca se subía:
-- lo encontró `verify-designer --bloque ds5`. Se suma `application/json` a los tipos admitidos.
--
-- Aditiva e idempotente: no cambia ningún archivo ni política. Puede ir antes o después del deploy.
--
-- Cómo volver atrás:
--   update storage.buckets
--      set allowed_mime_types = array['image/png','application/pdf','application/zip']
--    where id = 'design-renders';

UPDATE storage.buckets
   SET allowed_mime_types = allowed_mime_types || array['application/json']
 WHERE id = 'design-renders'
   -- Sin lista (NULL = cualquier tipo) no hay nada que sumar: no se restringe de más.
   AND allowed_mime_types IS NOT NULL
   AND NOT ('application/json' = ANY (allowed_mime_types));
