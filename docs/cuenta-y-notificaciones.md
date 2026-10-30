# Mi cuenta: perfil y notificaciones

Cada persona del equipo tiene su página propia, **Mi cuenta** (`/dashboard/cuenta`), que se abre desde el menú de usuario del pie del menú lateral ("Mi perfil" y "Notificaciones"). Tiene dos pestañas y no depende de ningún permiso: es de la persona, no del negocio.

## Perfil

| Qué | Dónde se guarda | Notas |
|---|---|---|
| Nombre | `auth.users.user_metadata.full_name` | El mismo campo que ya leía todo el sistema. Al guardar se renueva la sesión para que el menú lo muestre enseguida. |
| Foto | `user_profiles.avatar_path` + bucket `user-avatars` | La pantalla la recorta a un cuadrado de 384 px antes de mandarla; el servidor la valida por sus bytes (PNG, JPG o WEBP) y la sube con el cliente de servicio. Cada foto es un archivo nuevo; la anterior se borra. |
| Teléfono y WhatsApp | `user_profiles.phone`, `whatsapp_phone`, `whatsapp_same_as_phone` | Con código de país (`+5491122334455`). El WhatsApp se usa solo para los avisos que la persona elija. |
| Zona horaria | `user_preferences.timezone` | La misma del menú de usuario. |
| Tema | `localStorage` | Igual que el botón del menú. |
| Contraseña | Supabase Auth | Pide la actual; la verifica entrando con ella en una sesión aparte y pone la nueva con esa sesión (cumple con "haber entrado hace poco"). |
| Sesiones | Supabase Auth | "Cerrar sesión en los otros dispositivos" (`signOut({ scope: 'others' })`). |

El email no se cambia desde acá (Supabase pide confirmarlo por correo): lo cambia un Admin.

**La foto en el resto del sistema.** El layout del panel carga una vez el mapa "persona → foto" (`workspace_member_profiles`, que desde la 00274 devuelve `avatar_path`) y lo comparte con `MemberAvatarsProvider`. Cualquier círculo de una persona (`Avatar` con `userId`, `MemberCircle`) busca ahí su foto; sin foto, las iniciales de siempre. Se ve en Ajustes → Equipo, las tareas, la bandeja, el contenido y los filtros del dashboard de chat. En la Agenda, si la persona no subió una foto propia de agenda, se usa la del perfil.

## Olvidé mi contraseña

1. En el login, "¿Olvidaste tu contraseña?" lleva a `/recuperar`.
2. La persona escribe su email. La respuesta es **siempre la misma** exista o no la cuenta. Tope: 10 pedidos por hora por IP y 3 por email.
3. Supabase manda el email. El link vuelve por:
   - `/auth/callback?next=/restablecer` (el link por defecto de Supabase, que funciona si se abre en el mismo navegador), o
   - `/auth/confirm?token_hash=…&type=recovery&next=/restablecer` (la plantilla en español de abajo, que funciona desde cualquier navegador).
4. En `/restablecer` elige la contraseña nueva y entra al panel. Un link vencido o usado vuelve a `/recuperar` con el aviso.

### Lo que hay que configurar en Supabase (una vez por instalación)

- **SMTP propio** (Authentication → Emails → SMTP Settings) con Resend: `smtp.resend.com`, puerto `465`, usuario `resend`, la API key de Resend como contraseña y un remitente de un dominio verificado. Sin esto Supabase manda como mucho 2 emails por hora.
- **Plantilla "Reset password"** (Authentication → Emails → Templates), en español y con el link que funciona desde cualquier navegador:

  ```html
  <h2>Elegí tu contraseña nueva</h2>
  <p>Pediste cambiar la contraseña de tu cuenta. Si no fuiste vos, ignorá este email.</p>
  <p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/restablecer">Elegir mi contraseña nueva</a></p>
  ```

- **Redirect URLs**: el dominio con `/**` (ya estaba en el `/setup`).

## Notificaciones

### Qué se elige

Una fila por **evento** (unos 25, agrupados en secciones: Chat, Tareas, Agenda, Contenido, Ventas y finanzas, Formularios y reportes, Agente IA y gasto, Canales e integraciones, Automatizaciones y llamadas), con tres interruptores: **Campana, Email y WhatsApp**. Un evento junta tipos de aviso parecidos ("reunión agendada, movida o cancelada" es una sola fila). Cada persona ve solo las filas que le pueden llegar: lo que va solo a Owner/Admin no se le muestra a un Member (salvo que tenga el permiso que lo abre).

El catálogo es `lib/notifications/preferences.ts` y es la única lista: la usan la pantalla, la campana y el envío. `preferences.test.ts` falla si aparece un tipo de aviso que no está en ningún evento.

**Valores por defecto:** campana prendida en todo; email prendido solo en lo crítico (un chat necesita una persona, una publicación no salió, un canal se desconectó, una integración necesita atención); WhatsApp apagado en todo. Lo que la persona cambia se guarda en `user_preferences.notification_prefs` (`{ evento: { bell, email, whatsapp } }`); lo que no cambió sigue al default (si mañana cambia un default, le llega).

### La campana

- Muestra **lo propio y lo general**: los avisos dirigidos a la persona y los que no tienen destinatario (los generales del negocio, que la RLS ya limita). Un Owner/Admin ya no ve en su campana los avisos personales de los demás.
- No muestra los tipos que la persona silenció. Silenciar es de pantalla: el aviso existe y vuelve a aparecer si se prende de nuevo.
- "Marcar todas como leídas" marca solo lo que esa persona ve.
- La RLS (`can_see_notification`) no cambió.

### Email y WhatsApp

Cada aviso nuevo encola un job `notification_deliver` (trigger de la 00275, que nunca puede tumbar el insert del aviso). El job (`lib/notifications/deliver.ts`):

1. Resuelve a quién va: la persona del aviso (si sigue en el negocio) o los Owner/Admin si es general.
2. Mira qué eligió cada una para ese evento.
3. Manda el email (Resend del negocio, plantilla `teamNotificationEmail`, con el nombre del negocio y el link) y/o el WhatsApp (desde el canal de avisos del negocio, al número de su perfil).
4. Anota cada envío en `notifications.metadata.delivered` en el momento: un reintento no repite.
5. **Tope:** a una persona, por un mismo evento y una misma cosa, como mucho un email y un WhatsApp cada 10 minutos.
6. Un fallo del proveedor reagenda a 1, 5 y 15 minutos; nunca lanza por eso. Un aviso de más de 24 horas ya no se manda.

**El WhatsApp de avisos** se elige en Ajustes → General → "Avisos al equipo por WhatsApp" (`workspaces.team_alerts_settings`, pide `settings.general`). Tiene que ser un WhatsApp conectado por Evolution. Sin él, la columna WhatsApp aparece deshabilitada con el motivo. En el perfil, "Mandarme un WhatsApp de prueba" (3 por hora) confirma que el número está bien.

El aviso de "canal desconectado" ya no manda su propio email desde `notifyWorkspaceAdmins`: lo manda el job, y por defecto le sigue llegando a Owner/Admin.

## Migraciones

| Migración | Qué hace | Cuándo se aplica |
|---|---|---|
| `00273_user_profiles` | Tabla `user_profiles` (RLS: solo la fila propia) y bucket `user-avatars` (público, sin policies de escritura) | Antes del deploy |
| `00274_notification_prefs` | `user_preferences.notification_prefs`, `workspaces.team_alerts_settings`, `workspace_member_profiles` con la foto y la función que encola la entrega | Antes del deploy |
| `00275_notification_delivery_trigger` | El trigger de `notifications` que encola la entrega | **Después** del deploy (si no, la cola marcaría los jobs como tipo desconocido) |

Sin las migraciones aplicadas, la pantalla igual carga (sin foto y con los valores por defecto) y avisa en el log; guardar falla con un mensaje claro.

## Verificación

```
node scripts/verify-account.mjs                    # RLS de user_profiles, el bucket, las preferencias, team_alerts_settings, workspace_member_profiles
node scripts/verify-account.mjs --despues-de-00275 # además, que cada aviso encole su entrega
```

Mismas reglas que los demás `verify-*`: crean y limpian sus datos (prefijo `zz-test-`), de a uno y con el candado `/private/tmp/ssa-verify.lock`.
