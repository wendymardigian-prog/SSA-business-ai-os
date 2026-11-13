---
description: Guiar la conexión de los servicios externos (Google Calendar/Meet/YouTube/Drive, WhatsApp, Instagram, Resend, IA, render) y armar la guía con las direcciones de esta instalación.
disable-model-invocation: true
---

# Conectar servicios externos

Estás corriendo este comando porque alguien quiere conectar su sistema con un servicio externo: Google (Calendar, Meet, YouTube y Drive), WhatsApp, Instagram, el email (Resend), la inteligencia artificial o el servicio de render del Diseñador IA. La guía completa, con direcciones de ejemplo, está en `guias/conexiones.md`. Tu trabajo es:

1. armarle esa misma guía con las direcciones de SU instalación;
2. acompañarlo, de a un paso, en la conexión que elija.

## Cómo comportarte durante todo el comando

- Hablá en español, en lenguaje simple. Si usás un término técnico (dominio, cliente OAuth, webhook, variable de entorno...), explicalo entre paréntesis la primera vez.
- Avanzá de a un paso. Antes de pasar al siguiente, confirmá algo concreto («¿ya ves el botón Crear cliente?») y esperá la respuesta.
- Si la persona pega una captura, usala para ver en qué pantalla está y decirle exactamente qué tocar.
- **Nunca le pidas una clave por chat**: ni el Client Secret de Google, ni una API key, ni el `AUTHENTICATION_API_KEY` de Evolution, ni contraseñas. Decile DÓNDE copiarla y DÓNDE pegarla (siempre en el sistema, en **Ajustes → Integraciones**). Si igual te pega una, no la repitas ni la uses, y avisale que conviene generar una nueva porque quedó escrita en el chat.
- La fuente de verdad del contenido es `guias/conexiones.md`. Leela antes de empezar y seguila. No inventes pasos ni nombres de botones. Si una pantalla del proveedor no coincide con la guía (los proveedores cambian sus pantallas), pedile una captura y guiala con lo que ve.
- Nada de un negocio se escribe en el código ni en archivos que se suben a GitHub. Lo único que escribís es la guía personalizada, en `Claude outputs/` (está en `.gitignore`).

## Paso 1. Los datos de la instalación

Ninguno es secreto. Sacá lo que puedas sin preguntar y confirmalo con la persona:

- **Dominio del sistema**: la dirección donde entra el equipo, sin `https://` ni barra final. Si existe un `.env` local, leé solo la línea `NEXT_PUBLIC_APP_URL` (nunca muestres ni leas en voz alta el resto del archivo). Si dice `localhost`, no sirve: preguntá la dirección publicada (el dominio propio, o la de Railway si todavía no tiene).
- **Dirección de Railway**, solo si tiene dominio propio: Railway → su servicio → Settings → Networking. Si no la sabe, seguí sin ella.
- **Reference ID de Supabase**: está en `NEXT_PUBLIC_SUPABASE_URL` del `.env` (`https://<ref>.supabase.co`), en `supabase/.temp/project-ref` o en Supabase → Project Settings → General.
- **ID del proyecto de Google Cloud**: solo si va a conectar Google. Si todavía no lo tiene, completalo cuando lo cree (sección Google, paso 1).

Normalizá lo que te den: minúsculas, sin `https://`, sin barra final ni ruta. Un dominio con espacios o sin punto no sirve: pedilo de nuevo.

## Paso 2. Armar su guía

1. Leé `guias/conexiones.md` completa.
2. Escribí `Claude outputs/conexiones-<dominio>.md` (creá la carpeta si no existe) con el mismo contenido, reemplazando los ejemplos:
   - `app.tunegocio.com` → su dominio;
   - `tu-app.up.railway.app` → su dirección de Railway. Si no tiene dominio propio, o si la dirección de Railway ES su dominio, sacá las líneas que la repiten y las aclaraciones sobre Railway de los orígenes y las direcciones de retorno;
   - `abcdefghijklmnopqrst` → su Reference ID;
   - `mi-proyecto-123` → el ID de su proyecto de Google Cloud (en los links que terminan en `?project=`);
   - `tunegocio.com`, en «Dominios autorizados» y en el pedido para ChatGPT o Claude → su dominio principal sin subdominio. Si el sistema vive en `*.up.railway.app`, va la dirección completa: Google no acepta `up.railway.app` solo;
   - en la tabla «Ejemplo / Qué es» de arriba, poné sus datos;
   - arriba de todo, una línea: «Guía armada para `<dominio>` el `<fecha>`».
3. Revisá que no quede ningún dato de ejemplo donde ya tenías el real: buscá `tunegocio`, `tu-app.up.railway.app`, `abcdefghijklmnopqrst` y `mi-proyecto-123`.
4. Decile dónde quedó el archivo y que puede abrirlo, imprimirlo o pasárselo a quien lo vaya a ayudar. No tiene ningún secreto.

## Paso 3. Qué quiere conectar

Preguntale qué quiere conectar ahora, con estas opciones y lo que suma cada una:

- **Google**: agendar con Google Calendar y links de Meet; YouTube (uno o varios canales); importar archivos de Drive a Recursos.
- **WhatsApp**: la bandeja de WhatsApp, por QR.
- **Instagram**: mensajes directos y comentarios.
- **Email (Resend)**: las invitaciones y los avisos desde su dominio.
- **Inteligencia artificial**: que el agente converse; opcionalmente, Conocimiento y transcripción de audios.
- **Servicio de render**: exportar PDF e imágenes desde el Diseñador IA. Si elige esta, el camino recomendado es el que ya trae el sistema («Conectá el servicio de render del Diseñador IA»). Ofrecé hacerlo con el conector de Railway; si no lo tiene, seguí la guía a mano.
- **Cambié de dominio**: la lista de «Si cambiás de dominio».

Si no sabe por dónde empezar: Email primero (sin remitente no salen ni las invitaciones al equipo), después la IA y los canales que use.

## Paso 4. Guiar la conexión elegida

Seguí la sección de su guía personalizada, de a un paso, con estas reglas:

- **Google**: preguntá primero si todo el equipo usa cuentas de Google Workspace de la empresa (decide Interna o Externa). Si la persona no es **Propietario** del proyecto de Google Cloud («No tienes permisos suficientes»), no sigas adivinando: ofrecé el atajo (que el Propietario le dé el rol) o el pedido para ChatGPT o Claude de la guía, ya con sus datos, para que se lo pase al dueño. Insistí en que hacen falta las TRES direcciones de retorno: `…/api/oauth/google_calendar/callback` (calendario), `…/api/oauth/google/callback` (YouTube) y `…/api/oauth/google_drive/callback` (Drive). Cuando cree el cliente, avisale antes: «Ahora Google te va a mostrar el secreto. No me lo pases: copialo y pegalo directo en la tarjeta Google del sistema». Si va a usar Drive, también hacen falta la clave de API (restringida a la Google Picker API) y el número del proyecto: se pegan en la misma tarjeta.
- **WhatsApp**: el «Token del webhook» se genera con el botón **Generar** de la tarjeta; no se copia de Evolution.
- **Instagram**: el «Secreto del webhook» de la tarjeta de Zernio queda vacío.
- **Resend**: sin remitente elegido no sale ningún email; recordalo al final.
- Al terminar cada conexión, pedile que la pruebe como dice la guía («Cómo comprobar» o «Probalo») y que te cuente qué ve. Si falla, buscá el síntoma en «Si algo sale mal» de esa sección antes de proponer otra cosa.

## Cierre

Resumí en una o dos líneas qué quedó conectado y qué no, dónde está su guía personalizada y que puede volver a escribir `/conectar` para la siguiente conexión.
