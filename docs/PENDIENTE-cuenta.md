# Pendientes de Mi cuenta (perfil y notificaciones)

Lo que quedó afuera de esta tanda, a propósito, y lo que falta hacer a mano.

## Para que funcione en producción

1. Aplicar `00273` y `00274` (aditivas) **antes** de desplegar, y `00275` **después** del deploy. Registrar cada una en `supabase_migrations.schema_migrations`.
2. `node scripts/verify-account.mjs` (y `--despues-de-00275`).
3. En Supabase Auth: SMTP propio con Resend y la plantilla "Reset password" en español (texto en `docs/cuenta-y-notificaciones.md`).
4. Ajustes → General → "Avisos al equipo por WhatsApp": elegir el WhatsApp (producción hoy no tiene WhatsApp conectado, así que la columna queda deshabilitada hasta que se conecte uno).

## Quedó afuera

- **Cambiar el email de acceso**: Supabase pide confirmarlo por correo en las dos direcciones; lo hace un Admin.
- **Notificaciones push del navegador** (service worker, permisos del navegador).
- **"Leído" por persona en los avisos generales**: un aviso sin destinatario que lee un Admin queda leído para los demás Admins (es una sola columna `read_at`). Arreglarlo pide una tabla de lecturas.
- **Horario de "no molestar"** para email y WhatsApp.
- **Verificar el WhatsApp con un código**: por ahora alcanza con el mensaje de prueba.
- **Preferencias distintas por negocio**: hoy son de la persona, iguales en todos sus negocios (el aviso dice de cuál es). El jsonb admite separarlas si hace falta.
- **El teléfono del equipo en Ajustes → Equipo**: se guarda pero no se muestra a nadie más.
