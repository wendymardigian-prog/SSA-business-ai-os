---
description: Conectar la web propia de un negocio (otro dominio, por ejemplo un sitio estático) para que mande sus formularios y pida links de baja a este sistema.
disable-model-invocation: true
---

# Cómo conectar la web de un negocio

Estás corriendo este comando porque alguien quiere que **su propia web** (en otro dominio: Astro, Webflow, Framer, una página hecha a mano...) mande sus formularios a este sistema **desde el navegador**, sin un servidor propio. Guiala paso a paso, en español simple, y explicá cada término técnico entre paréntesis la primera vez.

Reglas para todo el comando:
- Nada se configura en el código ni en variables de entorno: todo es configuración del negocio, desde la pantalla. Este sistema es una plantilla y lo de un negocio no puede quedar escrito para todos.
- **Nunca pidas claves por chat.** Para conectar la web no hace falta ninguna: el formulario se identifica por su link (slug) y el negocio por su identificador.
- Si la instalación tiene varios negocios (el selector de arriba), todo lo de abajo se hace con el negocio correcto elegido.

## Lo que ya hace el sistema

- **Recibe formularios desde otra web** (`POST /api/public/forms/<slug>/submit`) con CORS (el permiso que necesita el navegador para leer la respuesta de otro dominio) por negocio: solo desde las direcciones que el negocio cargó.
- **Rechaza en el servidor** (403 `origin_not_allowed`) un envío desde una dirección que no está cargada: CORS solo esconde la respuesta, no frena el envío.
- Protecciones: campo trampa (honeypot), tope de 60 envíos por hora por IP (30 por formulario), clave de idempotencia (un reintento no duplica) y tope de tamaño (64 KB sin archivos; 413 si se pasa).
- **Pedir un link de baja nuevo** (`POST /api/public/email/unsubscribe-link?workspace=<identificador>`): para la página de baja de la web, cuando los links viejos no sirven.

## Paso 1. Cargar las direcciones de la web

En el sistema: **Ajustes → Integraciones → Tu sitio web**.
- Cargar cada dirección exacta, con `https://` y sin ruta: `https://tusitio.com`. Si la web también responde con `www`, cargar las dos. Si tiene una dirección de prueba (por ejemplo la de su hosting), también.
- Para probar en la compu: `http://localhost:<puerto>`, marcado como **de desarrollo**.
- Lo puede cambiar quien tiene el permiso de administrar integraciones.

En esa misma pantalla están la **dirección de este sistema**, el **identificador del negocio** y, por cada formulario publicado, su **link (slug)** y las **claves (key)** de sus preguntas, con un ejemplo para copiar.

## Paso 2. Crear los formularios

En **Formularios**, uno por cada formulario de la web:
- Cada pregunta tiene una **clave** (key): es el nombre que usa la web en `answers`. Tiene que coincidir letra por letra.
- Tipo de cada pregunta: el email como **Email** y el teléfono como **Teléfono** (aunque la web los mande sin mostrarlos): solo así se pueden guardar en el contacto. Los datos que la web completa sola (por ejemplo, de qué página vino) van como **Oculto**.
- Pestaña **Contacto**: qué pregunta va a qué dato del contacto. Una pregunta llena un solo dato: si el teléfono tiene que ir también como WhatsApp, la web manda una segunda clave con el mismo número.
- **Casilla de emails de marketing**: una pregunta de tipo **Consentimiento** mapeada a **"Suscripción a emails de marketing"**. Sin marcar y con contacto nuevo, el contacto queda **Sin suscribir** (no recibe marketing; lo transaccional, como confirmaciones y recordatorios, le llega igual). Marcada, lo suscribe (nunca levanta una baja).
- Un formulario en dos pasos: el paso 2 lleva el **email** (tipo Email) para encontrar el mismo contacto, con "Solo vincular" y "Completar solo lo vacío".
- **Publicar** el formulario. Las etiquetas y el aviso al equipo se eligen en el mismo formulario; los emails de confirmación y recordatorios, en su pestaña de automatizaciones (como **Transaccional**, para que le lleguen a todos los que se anotaron).

## Paso 3. El envío desde la web

```js
const res = await fetch("https://<este-sistema>/api/public/forms/<slug>/submit", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    idempotency_key: crypto.randomUUID(), // uno por envío; un reintento usa el MISMO
    origin: "site",                      // así no hace falta version_id: usa la versión publicada
    answers: { name: "…", email: "…", email_consent: true },
    honeypot: "",                         // un campo invisible: si un bot lo llena, no se guarda nada
    attribution: { utm_source, utm_medium, utm_campaign, utm_content, utm_term, fbclid, fbp, fbc, meta_event_id },
  }),
});
const data = await res.json();
```

- `fbp` y `fbc` van dentro de `attribution` porque las cookies `_fbp` y `_fbc` de la web no viajan a otro dominio.
- `meta_event_id` (el id del evento del Pixel) se guarda con la respuesta, para no contar dos veces el mismo lead cuando se sume la API de Conversiones de Meta.

Respuestas:

| Estado | Cuerpo | Qué hacer |
|---|---|---|
| 200 | `{ ok: true, duplicate: false, submission_id, success }` | Listo. `success` trae el mensaje o la redirección configurados. |
| 200 | `{ ok: true, duplicate: true, … }` | Ya se había guardado (reintento con la misma clave). |
| 400 | `{ ok: false, error: "invalid", fields: { <key>: "<mensaje>" }, message }` | Mostrar el mensaje junto a cada campo. |
| 400 | `{ ok: false, error: "invalid_request", message }` | El cuerpo no tiene la forma esperada. |
| 403 | `{ ok: false, error: "origin_not_allowed" }` (sin CORS) | La dirección de la web no está cargada en el paso 1. |
| 404 | `{ ok: false, error: "unavailable" }` | El formulario no existe o no está publicado. |
| 409 | `{ ok: false, error: "already_answered", message }` | Una encuesta de "una vez por contacto" ya respondida. |
| 413 | `{ ok: false, error: "payload_too_large", message }` | El cuerpo es demasiado grande. |
| 429 | `{ ok: false, error: "rate_limited", message }` | Demasiados envíos: probar más tarde. |
| 500 | `{ ok: false, error: "server_error", message }` | Reintentar con la MISMA `idempotency_key`. |

Un 403 o un 404 desde otra web llegan sin CORS: el navegador los muestra como error de red. Si pasa, revisar el paso 1 y que el formulario esté publicado.

## Paso 4. La página de baja de la web (opcional)

Para los links de baja viejos que ya no sirven: la página le pide el email a la persona y llama:

```js
await fetch("https://<este-sistema>/api/public/email/unsubscribe-link?workspace=<identificador>", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, honeypot: "" }),
});
```

Responde **siempre** `{ ok: true }` (para no revelar quién está en la lista). Si el email es de un contacto del negocio, le llega un email con su link para darse de baja. Topes: 5 por hora por IP y 3 por día por email. Los emails de marketing nuevos ya traen su propio link de baja: esta página es solo para los viejos.

## Paso 5. Probar

1. Con la web en la compu (`http://localhost:<puerto>`, cargado como de desarrollo), mandar un formulario y ver la respuesta en **Formularios → Respuestas**: el contacto, la atribución y el origen "Página del sitio".
2. Desde una dirección que NO está cargada, el navegador tiene que bloquearlo.
3. Probar el preflight (el "¿puedo?" del navegador) con curl:

```bash
curl -i -X OPTIONS "https://<este-sistema>/api/public/forms/<slug>/submit" -H "Origin: https://tusitio.com" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: content-type"
```

Tiene que responder `204` con `Access-Control-Allow-Origin: https://tusitio.com`.
