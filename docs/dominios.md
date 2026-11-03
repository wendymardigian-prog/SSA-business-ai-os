# Dominios: de dónde sale cada link

Cada instalación tiene un **dominio principal** (la variable `NEXT_PUBLIC_APP_URL`) y cada negocio puede tener el
suyo para los **links públicos** (Ajustes → General → «Dominio de tus links»). Todo el código pasa por
`lib/public-url.ts`; un test (`lib/public-url.test.ts`) falla si alguien vuelve a leer la variable en otro lado o a
armar un link con `window.location.origin`.

## La regla

| Dominio principal (`appUrl()`) | Dominio del negocio (`publicBaseUrl(workspace)`, o el principal si no tiene) |
|---|---|
| Lo usa el **equipo** y los **proveedores** | Lo ve o lo recibe un **lead**, o lo pega el negocio en otro lado |
| Invitaciones, «Olvidé mi contraseña», avisos al equipo, links al panel (`submission.url`, tareas, EOD) | Agenda (eventos, gestionar una reunión, `.ics`), formularios (`/f/`), links firmados y contratos |
| Retorno de OAuth (Google, Fathom) y de conectar canales de Zernio | Baja de emails (pie, `List-Unsubscribe`, el link de baja de «Tu sitio web») |
| Webhooks de Zernio, Evolution y Resend | Links medidos (`/l/`), el embed de la agenda y de formularios |
| `metadataBase`, `sitemap.xml`, `robots.txt` | Webhooks entrantes (`/api/hooks/<token>`), la guía de «Tu sitio web» |

**Nunca se arma un link con el dominio por el que entró la persona**: un email o una automatización salen sin
nadie mirando, y el link que ves en la pantalla tiene que ser el mismo que recibe el lead. Además, «Olvidé mi
contraseña» con el host del pedido es un agujero conocido.

## Railway → dominio principal

Quien abre una página por el dominio de Railway (`*.up.railway.app`) termina en el principal (307, `middleware.ts`,
`canonicalRedirectUrl`). Así el dominio por el que entrás y el de los links coinciden, y el retorno de Google/Fathom
encuentra su cookie (antes, conectar Google desde el dominio propio fallaba si la variable decía Railway).

No se redirige nunca: `/api/` (webhooks ya registrados, la baja en un clic, formularios de otras webs), `/auth/`
(el retorno de Supabase guarda su verificación en una cookie de ese dominio), `/embed/` y `?embed=1` (un embed ya
instalado confía solo en los mensajes de su dominio) y lo que no es GET/HEAD (Server Actions, envíos). Tampoco si el
principal no está configurado, es local o es el mismo Railway. **Los links viejos de Railway siguen funcionando.**

## Dominio propio de un negocio

Vive en `workspaces.scheduling_public_base_url` (00098: nació solo para la agenda, sin pantalla; desde el 3/11/2026
vale para todos los links públicos; no se renombró para no hacer una migración que borra). Lo guarda
`saveBusinessDomain` (`settings.general`), que antes **comprueba que el dominio llegue a este sistema**: le pide
`/api/public/instance` y compara la huella (sale de `NEXT_PUBLIC_SUPABASE_URL`, que ya es pública). Solo https, sin
ruta, nunca local ni de Railway. Un valor roto en la base nunca llega a un link (se usa el principal).

## Pasar una instalación a su dominio propio (checklist)

1. **Railway** → el servicio de la app → Settings → Networking → Custom Domain: agregar el dominio y apuntar el DNS
   como indica Railway.
2. **Railway** → Variables: `NEXT_PUBLIC_APP_URL=https://<dominio>` (Railway vuelve a armar la app: la variable se
   lee al compilar).
3. **Supabase** → Authentication → URL Configuration: Site URL `https://<dominio>` y en Redirect URLs sumar
   `https://<dominio>/**` (dejar la de Railway también). Sin esto falla «Olvidé mi contraseña».
4. **Google Cloud** → el cliente OAuth → Authorized redirect URIs: sumar `https://<dominio>/api/oauth/google/callback`.
   **Fathom** (si se usa): la dirección de retorno que muestra Ajustes → Integraciones → Fathom.
5. **Supabase Vault** (opcional, los cron siguen andando por Railway):
   `select private.set_system_secret('app_url', 'https://<dominio>');`
6. **Webhooks** (opcional): «Sincronizar canales» y «Actualizar webhook» de Resend los vuelven a registrar con el
   dominio nuevo. Los de Railway siguen funcionando.

Para el dominio de un **segundo negocio**: los pasos 1 y, si el equipo va a entrar por ahí, 3; después cargarlo en
Ajustes → General → «Dominio de tus links» de ese negocio.
