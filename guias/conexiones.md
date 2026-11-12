# Guías de conexiones

Cómo conectar cada servicio externo con el sistema: Google, WhatsApp, Instagram, el email, la inteligencia artificial y el servicio de render. Al final, qué cambiar si pasás a otro dominio.

> **Con el asistente:** abrí Claude Code en la carpeta de tu repositorio y escribí `/conectar`. Te pregunta tu dominio y qué querés conectar, te arma esta misma guía con **tus** direcciones ya puestas (en `Claude outputs/`, que no se sube a GitHub) y te acompaña paso a paso.

En esta guía, las direcciones usan datos de ejemplo. Reemplazalos por los tuyos:

| Ejemplo | Qué es | Dónde está |
|---|---|---|
| `app.tunegocio.com` | El dominio del sistema, donde entra tu equipo | Tu dominio propio o, si no tenés, la dirección de Railway |
| `tu-app.up.railway.app` | La dirección de Railway | Railway → tu servicio → Settings → Networking |
| `abcdefghijklmnopqrst` | El Reference ID de Supabase | Supabase → Project Settings → General |
| `mi-proyecto-123` | El ID del proyecto de Google Cloud | Arriba a la izquierda de la consola de Google Cloud, al elegir el proyecto |

Ninguno de esos datos es secreto.

## Antes de empezar

- **Dónde se pegan las claves.** Todo se carga dentro del sistema, en **Ajustes → Integraciones**. Cada tarjeta tiene **Probar y guardar**: el sistema prueba la clave con el proveedor antes de guardarla y, si algo está mal, avisa ahí mismo. Las claves quedan cifradas y nadie las puede volver a ver.
- **Las claves nunca van por chat.** Ni a Claude, ni a ChatGPT, ni por mail o WhatsApp. Si una quedó escrita en algún chat, generá una nueva en el proveedor y reemplazala.
- **Todas son opcionales.** El sistema funciona sin ninguna. Cada una suma una función, y se puede conectar cuando haga falta.

---

## Google: Calendar, Meet, YouTube y Drive

Una sola «llave» de Google (se llama *cliente OAuth*) sirve para todo. Con ella cada persona del equipo conecta su Google Calendar: el sistema ve sus horarios ocupados, crea las reuniones en su calendario y arma el link de Google Meet. La misma llave conecta YouTube (subir videos, métricas y comentarios) y deja Drive listo para más adelante. Se hace una vez y lleva de 15 a 20 minutos.

> **Quién lo puede hacer.** Solo una cuenta con rol **Propietario** (*Owner*) en el proyecto de Google Cloud puede prender servicios y crear la llave. Ser «Administrador de la organización» no alcanza. Si te aparece «No tienes permisos suficientes», mirá [Si no sos el dueño del proyecto](#si-no-sos-el-dueño-del-proyecto).

### 1. Elegí el proyecto

1. Entrá a [console.cloud.google.com](https://console.cloud.google.com/) con la cuenta de Google de la empresa.
2. Arriba a la izquierda, al lado de «Google Cloud», tocá el selector de proyecto. Si ya hay uno para el sistema, elegilo. Si no, tocá **Proyecto nuevo**, ponele un nombre y, si te deja elegir, crealo dentro de la organización de la empresa.
3. Anotá el ID del proyecto: los links de esta guía terminan en `?project=<ID>`.

### 2. ¿Interna o externa?

Google pregunta quién va a poder conectarse. Se decide una vez por proyecto y vale para todas sus llaves.

| | Interna (recomendada si se puede) | Externa |
|---|---|---|
| Cuándo | Todo el equipo usa cuentas de Google Workspace de la empresa (`nombre@tuempresa.com`) y el proyecto está dentro de la organización de esa empresa. Si no lo está, la opción no aparece. | Alguien del equipo usa Gmail personal, o la empresa no tiene Google Workspace. |
| Revisión de Google | Ninguna, aunque se usen Calendar, YouTube o Drive. | Ninguna para hasta 100 personas. Al conectar, Google muestra «Google no verificó esta app» y se sigue con **Configuración avanzada → Ir a…** |
| Ojo | Una cuenta de Gmail personal **no** se va a poder conectar. | Hay que **publicarla** (paso 4). Si queda «en prueba», las conexiones se cortan cada 7 días. |

> **Portal de clientes.** Si más adelante tus clientes entran a un portal con «Iniciar sesión con Google», eso va en **otro proyecto**, externo, que solo pide nombre y email. No mezcles el del equipo con el de los clientes: el del equipo tendría que pasar las revisiones de Google para Calendar, YouTube y Drive.

### 3. Prendé los cuatro servicios

Abrí cada link y tocá **Habilitar** (*Enable*). Si ya dice «Administrar», está prendido.

| Servicio | Para qué | Link |
|---|---|---|
| Google Calendar API | Calendario y links de Meet (Meet no necesita un servicio aparte) | `https://console.cloud.google.com/apis/library/calendar-json.googleapis.com?project=mi-proyecto-123` |
| YouTube Data API v3 | Subir videos y leer comentarios | `https://console.cloud.google.com/apis/library/youtube.googleapis.com?project=mi-proyecto-123` |
| YouTube Analytics API | Métricas de los videos | `https://console.cloud.google.com/apis/library/youtubeanalytics.googleapis.com?project=mi-proyecto-123` |
| Google Drive API | Preparado para un módulo futuro. Hoy el sistema no lo usa | `https://console.cloud.google.com/apis/library/drive.googleapis.com?project=mi-proyecto-123` |

### 4. Armá la pantalla de permisos

Es lo que ve cada persona cuando Google le pregunta si da permiso. Entrá a Google Auth Platform (`https://console.cloud.google.com/auth/overview?project=mi-proyecto-123`) y tocá **Comenzar** (*Get started*) si aparece.

1. **Información de la app:** nombre de la app (el de tu sistema o tu marca) y un correo de asistencia.
2. **Público** (*Audience*): **Interno** o **Externo**, según el paso 2.
3. **Información de contacto:** el mismo correo. Aceptá la política y tocá **Crear**.
4. **Desarrollo de la marca** (*Branding*), en el menú de la izquierda:
   - **Logotipo** (opcional): cuadrado, 120 × 120 píxeles, PNG o JPG, de menos de 1 MB. En una app interna no dispara ninguna revisión.
   - **Página principal de la aplicación:** `https://app.tunegocio.com`
   - **Política de privacidad y Condiciones del servicio:** opcionales en una app interna. En una externa, completalas si las tenés.
   - **Dominios autorizados** → **Agregar dominio**: tu dominio principal, sin subdominio (`tunegocio.com`). Si el sistema todavía vive en Railway, va la dirección completa (`tu-app.up.railway.app`): Google no acepta `up.railway.app` solo.
   - Tocá **Guardar**.
5. **Solo si elegiste Externa:** en **Público**, tocá **Publicar app** (*Publish app*) y confirmá. Queda «En producción».

### 5. Cargá los 9 permisos

En el menú de la izquierda, **Acceso a los datos** (*Data Access*) → **Agregar o quitar permisos**. Se abre una ventana a la derecha. Elegí una de las dos formas: dan el mismo resultado.

> **Antes:** prendé los servicios (paso 3). Si un servicio no está prendido, sus permisos no aparecen en la lista de la opción B.

**Opción A: pegar todo de una vez**

1. Bajá hasta el final de la ventana, a **Agregar permisos manualmente** (*Manually add scopes*), y pegá este bloque completo:

   ```
   https://www.googleapis.com/auth/calendar.calendarlist.readonly
   https://www.googleapis.com/auth/calendar.events.freebusy
   https://www.googleapis.com/auth/calendar.events
   openid
   https://www.googleapis.com/auth/userinfo.email
   https://www.googleapis.com/auth/youtube.readonly
   https://www.googleapis.com/auth/youtube.upload
   https://www.googleapis.com/auth/yt-analytics.readonly
   https://www.googleapis.com/auth/youtube.force-ssl
   ```

2. Tocá **Agregar a la tabla**. Los nueve aparecen tildados arriba.
3. Tocá **Actualizar**, abajo de todo, y después **Guardar** en la página.

**Opción B: buscarlos uno por uno**

La ventana tiene una tabla (API, Permiso, Descripción) con un **Filtro** arriba. Para cada fila de abajo: escribí el texto en el filtro, tildá la fila cuyo permiso termina **exactamente** igual, borrá el filtro y seguí. Lo tildado no se pierde al cambiar el filtro. Ojo: al buscar `calendar.events` aparecen otros parecidos; tildá solo el que coincide letra por letra.

| # | API | Escribí en el filtro | El permiso termina en | Descripción de Google (puede salir en español) |
|---|---|---|---|---|
| 1 | Google Calendar API | `calendarlist.readonly` | `calendar.calendarlist.readonly` | See the list of Google calendars you're subscribed to |
| 2 | Google Calendar API | `freebusy` | `calendar.events.freebusy` | See the availability on Google Calendars you have access to |
| 3 | Google Calendar API | `calendar.events` | `calendar.events` (sin nada después) | View and edit events on all your calendars |
| 4 | (sin API, arriba de todo) | `openid` | `openid` | Associate you with your personal info on Google |
| 5 | (sin API, arriba de todo) | `userinfo.email` | `userinfo.email` | See your primary Google Account email address |
| 6 | YouTube Data API v3 | `youtube.readonly` | `youtube.readonly` | View your YouTube account |
| 7 | YouTube Data API v3 | `youtube.upload` | `youtube.upload` | Manage your YouTube videos |
| 8 | YouTube Analytics API | `yt-analytics.readonly` | `yt-analytics.readonly` | View YouTube Analytics reports for your YouTube content |
| 9 | YouTube Data API v3 | `force-ssl` | `youtube.force-ssl` | See, edit, and permanently delete your YouTube videos, ratings, comments and captions |

Con los nueve tildados: **Actualizar** y después **Guardar**.

**Cómo comprobar:** en «Acceso a los datos» hay tres grupos (no sensibles, sensibles y restringidos). Entre todos tienen que sumar **9 permisos**. Si sobra alguno, se quita con el tacho de esa fila. Drive no lleva permiso todavía: se agrega cuando el sistema lo use.

### 6. Creá la llave

En el menú de la izquierda, **Clientes** (`https://console.cloud.google.com/auth/clients?project=mi-proyecto-123`) → **Crear cliente**.

1. **Tipo de aplicación:** **Aplicación web**. **Nombre:** el de tu sistema, por ejemplo «Sistema web».
2. **Orígenes de JavaScript autorizados** → **Agregar URI**, uno por línea:

   ```
   https://app.tunegocio.com
   https://tu-app.up.railway.app
   ```

   (La de Railway solo si tenés dominio propio y querés que también funcione desde Railway.)

3. **URIs de redireccionamiento autorizados** → **Agregar URI**. Copialas exactas, sin barra al final:

   ```
   https://app.tunegocio.com/api/oauth/google_calendar/callback
   https://app.tunegocio.com/api/oauth/google/callback
   https://tu-app.up.railway.app/api/oauth/google_calendar/callback
   https://tu-app.up.railway.app/api/oauth/google/callback
   https://abcdefghijklmnopqrst.supabase.co/auth/v1/callback
   ```

   - La que termina en `google_calendar/callback` es la del **calendario**; la que termina en `google/callback`, la de **YouTube**. Hacen falta las dos.
   - Las dos de Railway, solo si tenés dominio propio y querés que también funcione desde Railway.
   - La de Supabase es opcional: deja preparado un futuro «Iniciar sesión con Google» para el equipo. Hoy no se usa, y agregarla no abre ninguna puerta.

4. Tocá **Crear**. Google muestra dos datos:
   - **ID de cliente** (*Client ID*): termina en `.apps.googleusercontent.com`. No es secreto.
   - **Secreto del cliente** (*Client secret*): **es secreto**. Copialo en ese momento: puede no volver a mostrarse completo.

### 7. Pegala en el sistema

1. Entrá a `https://app.tunegocio.com/dashboard/settings/integrations` y abrí la tarjeta **Google (YouTube)**. Aunque diga YouTube, es la misma llave que usa el calendario.
2. Pegá el Client ID y el Client Secret y tocá **Guardar**.
3. Si los datos te los pasó otra persona: el Client ID puede llegar por cualquier medio; el Client Secret, solo por un link que se borra después de leerlo (Bitwarden Send, 1Password u onetimesecret.com). Nunca en un mail o chat común.

### 8. Probalo

1. En el sistema: **Mi cuenta → Conexiones → Conectar cuenta de Google** (o **Agenda → Configuración → Calendarios**). Entrá con una cuenta del equipo y aceptá los permisos.
2. Tiene que volver al sistema con tu cuenta y tus calendarios listados. Cada persona del equipo conecta el suyo de la misma forma.
3. YouTube se conecta desde la tarjeta de Google, cuando lo vayas a usar.

### Si algo sale mal

- **«No tienes permisos suficientes» en Google Cloud:** tu cuenta no es Propietario del proyecto. Mirá el apartado siguiente.
- **Error 400: redirect_uri_mismatch:** una de las direcciones del paso 6 quedó distinta: una letra, una barra al final o `http` en vez de `https`. Copiala de nuevo. Google puede tardar unos minutos en tomar el cambio.
- **Error 403: org_internal o access_denied:** la app es Interna y la cuenta con la que entraste no es de la empresa. Usá la cuenta de Workspace.
- **«Google no verificó esta app»:** normal en una app Externa: tocá Configuración avanzada → Ir a (nombre de la app).
- **El calendario se desconecta cada semana:** la app es Externa y quedó «en prueba». Publicala (paso 4, punto 5) y volvé a conectar.
- **Conecta, pero después falla al leer el calendario:** falta prender la Google Calendar API (paso 3) o todavía no tomó el cambio: esperá 5 minutos y probá de nuevo.

### Si no sos el dueño del proyecto

El camino más rápido: que el Propietario te dé el rol a vos.

1. El Propietario entra a IAM del proyecto (`https://console.cloud.google.com/iam-admin/iam?project=mi-proyecto-123`) → **Otorgar acceso**.
2. En «Principales nuevas» escribe tu email; en «Rol» elige **Propietario** (*Owner*); y toca **Guardar**.

Si prefieren hacerlo ellos, pasales esta guía, o este pedido para ChatGPT o Claude con tus datos en lugar de los de ejemplo:

```
Necesito que me guíes paso a paso, en español y con lenguaje simple, para configurar un cliente OAuth de Google en Google Cloud Console. Soy Propietario del proyecto. Andá de a un paso y esperá a que te diga "listo" antes de seguir. Nunca me pidas que te pegue el Client Secret.

Datos:
- Proyecto de Google Cloud: mi-proyecto-123
- APIs a habilitar: Google Calendar API, YouTube Data API v3, YouTube Analytics API y Google Drive API (Drive queda prendida para más adelante, sin scopes por ahora).
- Google Auth Platform: público Interno si todo el equipo usa cuentas de Google Workspace de la empresa; si no, Externo y publicada (En producción).
- Branding: página principal https://app.tunegocio.com, dominio autorizado tunegocio.com, logo opcional de 120x120.
- Scopes en Data Access (pegarlos en "Agregar permisos manualmente"; tienen que quedar exactamente estos 9):
    https://www.googleapis.com/auth/calendar.calendarlist.readonly
    https://www.googleapis.com/auth/calendar.events.freebusy
    https://www.googleapis.com/auth/calendar.events
    openid
    https://www.googleapis.com/auth/userinfo.email
    https://www.googleapis.com/auth/youtube.readonly
    https://www.googleapis.com/auth/youtube.upload
    https://www.googleapis.com/auth/yt-analytics.readonly
    https://www.googleapis.com/auth/youtube.force-ssl
- Cliente OAuth tipo "Aplicación web":
  - Orígenes JavaScript autorizados:
    https://app.tunegocio.com
  - URIs de redireccionamiento autorizados:
    https://app.tunegocio.com/api/oauth/google_calendar/callback
    https://app.tunegocio.com/api/oauth/google/callback
    https://abcdefghijklmnopqrst.supabase.co/auth/v1/callback

Al final, recordame que el Client ID se puede mandar por cualquier medio, pero el Client Secret solo por un link que se autodestruye (Bitwarden Send, 1Password u onetimesecret.com), nunca en texto común.
```

---

## WhatsApp (Evolution API)

WhatsApp se conecta escaneando un código QR desde el celular, con un servicio llamado Evolution API que corre en tu propio Railway. Los mensajes entran a la bandeja del sistema. Lleva unos 20 minutos.

### 1. Instalá Evolution en Railway

1. En Railway, tocá **+ Create** (en algunas cuentas dice *New*) → **Template**, buscá **Evolution API** y elegí una plantilla que cree tres servicios: Evolution API, Postgres y Redis. Tocá **Deploy**. Puede ir en el proyecto del sistema o en uno aparte.
2. Esperá a que los tres figuren como *Active*.
3. En el servicio Evolution API → **Settings → Networking → Generate Domain**. Si pregunta el puerto, escribí `8080`. Anotá la dirección que te da: no es secreta.
4. En ese mismo servicio, pestaña **Variables**, copiá `AUTHENTICATION_API_KEY` (el ojito la muestra). Es una clave: pegala solo en el sistema.

### 2. Cargalo en el sistema

1. En **Ajustes → Integraciones → Evolution API (WhatsApp)** completá:
   - **Dirección del servidor:** la del paso 1.3, con `https://`. Tiene que ser la dirección pública: la red privada de Railway no sirve.
   - **API key del servidor:** la `AUTHENTICATION_API_KEY` del paso 1.4.
   - **Token del webhook:** tocá **Generar**. Es una contraseña que inventa el sistema para reconocer los mensajes de tu WhatsApp; no hay que copiarla en ningún otro lado.
   - **Prefijo de la instancia:** dejá el que viene. No lo cambies después de conectar un número.
2. Tocá **Probar y guardar**.
3. En la misma tarjeta, pestaña **Cuentas** → **Conectar WhatsApp**. En el celular: WhatsApp → **Dispositivos vinculados → Vincular un dispositivo** y escaneá el QR.

No hace falta configurar el aviso de mensajes nuevos (el *webhook*) en Evolution: el sistema lo registra solo al conectar el número, apuntando a `https://app.tunegocio.com/api/webhooks/evolution`. Tampoco hace falta cargar variables de Evolution en el servicio del sistema.

### Si algo sale mal

- **«Probar y guardar» falla:** revisá que la dirección empiece con `https://`, sea la pública de Railway y que el servicio de Evolution esté *Active*. Si cambiaste la dirección, volvé a pegar la API key en el mismo guardado.
- **El QR no aparece o vence:** tocá de nuevo Conectar WhatsApp. El QR dura unos segundos: tené el celular listo.
- **Los mensajes no entran:** desconectá y volvé a conectar el número: así se vuelve a registrar el aviso con la dirección actual del sistema.

---

## Instagram (Zernio)

Conecta los mensajes directos, los comentarios y las respuestas a historias de Instagram con la bandeja. Pasa por Zernio, un servicio que habla con Instagram por vos. Tiene 2 cuentas gratis; después, un costo por cuenta.

1. Creá una cuenta en [app.zernio.com](https://app.zernio.com) y conectá ahí tu cuenta de Instagram (tiene que ser profesional: de empresa o de creador).
2. En el panel de Zernio, creá una API key y copiala.
3. En el sistema: **Ajustes → Integraciones → Zernio**. Pegá la API key y tocá **Probar y guardar**.
4. El campo **Secreto del webhook** dejalo vacío: el sistema arma el suyo.

Al guardar, el sistema prueba la clave, crea los canales de cada cuenta, registra el aviso de mensajes nuevos en Zernio (apuntando a `https://app.tunegocio.com/api/webhooks/late`) y empieza a traer las conversaciones viejas, por partes. No hay que pegar ninguna dirección en Zernio.

### Si algo sale mal

- **«Probar y guardar» dice que la clave no sirve:** generá una nueva en Zernio y pegala de nuevo, sin espacios.
- **Conectaste otra cuenta de Instagram en Zernio y no aparece:** en **Ajustes → Integraciones → Zernio**, pestaña **Cuentas**, tocá **Sincronizar**.

---

## Email (Resend)

Manda las invitaciones al equipo, los avisos y los emails automáticos desde tu propio dominio. Opcional: recibir en la bandeja los emails que te escriben. El plan gratis tiene 100 emails por día.

1. Creá una cuenta en [resend.com](https://resend.com).
2. **Domains → Add Domain**: agregá tu dominio y cargá los registros DNS que te muestra en el panel donde administrás el dominio (no en Railway). Esperá a que figure como verificado.
3. **API Keys → Create API Key**, con permiso **Full access**. Copiala (empieza con `re_`).
4. En el sistema: **Ajustes → Integraciones → Resend**. Pegá la clave y tocá **Probar y guardar**. Con *Full access*, el sistema conecta solo el aviso de Resend (rebotes, quejas, emails entregados y abiertos).
5. En la misma tarjeta, sección **Remitentes**: elegí el remitente de los emails importantes (invitaciones, avisos) y, si vas a mandar campañas, uno aparte para marketing. Los dos tienen que ser de tu dominio verificado. **Hasta que elijas un remitente, no sale ningún email.**
6. Opcional, **Recepción de emails**: prendé «Recibir emails en la bandeja», elegí el dominio y la dirección principal (por ejemplo `hola`). El dominio tiene que tener la recepción activada y verificada en Resend.

**Si creaste la clave con «Sending access»:** funciona para mandar, pero el aviso se conecta a mano. La tarjeta te muestra la dirección exacta: en Resend, **Webhooks → Add Webhook**, pegala completa (incluido el `?w=…` del final), tildá los eventos que indica y pegá el secreto `whsec_…` en «Secreto del webhook» de la tarjeta.

### Si algo sale mal

- **El dominio no se verifica:** los registros DNS pueden tardar de minutos a horas. Revisá que el nombre y el valor estén copiados exactos, en el panel de tu dominio.
- **No sale ningún email:** falta elegir el remitente en la sección Remitentes.
- **La tarjeta marca el webhook en rojo:** tocá **Actualizar webhook** en la tarjeta.

---

## Inteligencia artificial

El sistema usa tus propias claves («traé tu propia clave»): pagás directo a cada proveedor por lo que uses. Sin ninguna, todo funciona igual y las conversaciones las responde el equipo.

1. Creá la clave en el proveedor (links en la tabla).
2. En el sistema: **Ajustes → Integraciones**, sección **Inteligencia artificial**, tarjeta del proveedor. Pegá la clave y tocá **Probar y guardar**. Una clave que el proveedor rechaza no se guarda.

| Tarjeta | Para qué | La clave empieza con | Dónde se crea |
|---|---|---|---|
| Anthropic (Claude) | Que el agente converse y las tareas de IA. Elegí al menos uno de estos tres | `sk-ant-` | [console.anthropic.com](https://console.anthropic.com/settings/keys) |
| OpenAI | Lo mismo, con los modelos GPT | `sk-` | [platform.openai.com](https://platform.openai.com/api-keys) |
| Google (Gemini) | Lo mismo, con los modelos Gemini | — | [aistudio.google.com](https://aistudio.google.com/app/apikey) |
| Voyage AI | Opcional. Indexa los documentos de Conocimiento para que el agente los consulte. No conversa | — | [dashboard.voyageai.com](https://dashboard.voyageai.com/api-keys) |
| Groq | Opcional. Transcribe las notas de voz de WhatsApp e Instagram. Sin esto, un audio pasa a una persona | `gsk_` | [console.groq.com](https://console.groq.com/keys) |

**Para no llevarte sorpresas:** antes de prender el agente, poné un tope de gasto en **Agentes IA → Topes y avisos**. Y no cambies el modelo de Voyage una vez que tengas documentos: obliga a indexar todo de nuevo.

---

## Servicio de render del Diseñador IA

Un servicio aparte que convierte los diseños en PDF e imágenes para exportarlos o generarlos desde plantillas. Sin él, el Diseñador funciona, pero esas acciones dicen «Falta conectar el servicio de render». Se duerme cuando no se usa: cuesta del orden de USD 5 a 10 por mes.

**Con el asistente:** abrí Claude Code en la carpeta de tu repositorio y pedile «Conectá el servicio de render del Diseñador IA». Lo arma con el conector de Railway; vos solo pegás un secreto.

**A mano, en el proyecto de Railway del sistema:**

1. **+ Create → GitHub Repo** → tu repositorio. Renombrá el servicio nuevo a `render`, exactamente así.
2. En sus **Settings**: **Root Directory** = `render`, y prendé **Serverless**.
3. **Networking → Generate Domain**, puerto `8080`.
4. Generá un secreto largo al azar (en la Terminal de Mac: `openssl rand -hex 32 | pbcopy` lo deja copiado sin mostrarlo). En el servicio `render` → **Variables**, creá `RENDER_SERVICE_SECRET` y pegalo.
5. En el mismo servicio, creá esta variable:

   ```
   RENDER_ALLOWED_HOSTS=fonts.googleapis.com,fonts.gstatic.com,abcdefghijklmnopqrst.supabase.co
   ```

6. En el servicio **del sistema** → **Variables**, creá estas dos. Son referencias: Railway completa el valor solo.

   ```
   RENDER_SERVICE_SECRET=${{render.RENDER_SERVICE_SECRET}}
   RENDER_SERVICE_URL=https://${{render.RAILWAY_PUBLIC_DOMAIN}}
   ```

7. Redesplegá primero `render` y después el sistema.

**Cómo comprobar:** abrí la dirección del servicio render terminada en `/health`: tiene que decir `"ok":true`. Después, en el sistema, abrí un diseño y tocá **Exportar → PDF**. La primera vez tarda unos segundos porque el servicio estaba dormido.

---

## Si cambiás de dominio

Cuando el sistema pasa de la dirección de Railway a un dominio propio (o de un dominio a otro), estos son todos los lugares donde va la dirección nueva:

1. **Railway** → tu servicio → **Settings → Networking → Custom Domain**. Agregá el dominio y cargá el registro CNAME que te muestra en el panel de tu dominio. Esperá a que figure verificado.
2. **Railway → Variables** del sistema (esto redespliega la app):

   ```
   NEXT_PUBLIC_APP_URL=https://app.tunegocio.com
   ```

3. **Supabase → SQL Editor** (las tareas automáticas usan esta dirección):

   ```
   select private.set_system_secret('app_url', 'https://app.tunegocio.com');
   ```

4. **Supabase → Authentication → URL Configuration**: *Site URL* = `https://app.tunegocio.com`, y una *Redirect URL* nueva: `https://app.tunegocio.com/**`.
5. **Google Cloud:** sumá el dominio nuevo a los orígenes y a las direcciones de retorno de la llave ([paso 6 de Google](#6-creá-la-llave)) y al dominio autorizado. Dejá las viejas hasta comprobar que todo anda.
6. **Instagram (Zernio):** en **Ajustes → Integraciones → Zernio**, pestaña **Cuentas**, tocá **Sincronizar**. Mueve el aviso de Zernio a la dirección nueva.
7. **Resend:** en la tarjeta, **Actualizar webhook**. Crea un aviso nuevo con la dirección nueva; el viejo queda en Resend y conviene borrarlo a mano en **Webhooks**.
8. **WhatsApp:** no hace falta mientras la dirección de Railway siga activa. Para pasarlo al dominio nuevo, desconectá y volvé a conectar el número.

La dirección de Railway sigue funcionando después del cambio: lleva al dominio nuevo, salvo los avisos de los proveedores, que entran igual. Por eso nada se corta mientras actualizás.

---

*Los nombres de los botones de Google, Railway, Zernio y Resend pueden cambiar con el tiempo: si uno no coincide, buscá el más parecido en la misma pantalla.*
