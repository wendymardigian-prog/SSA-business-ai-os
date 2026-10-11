# El sitio público de este clon

Este sistema es una app, pero cada clon puede tener también **páginas públicas propias**: una home, una página de servicios, una de contacto con un formulario. Viven dentro del mismo proyecto, en `app/(sitio)/`, y se arman **a pedido con Claude Code** (no hay un editor visual).

## Cómo pedir una página

Le decís a Claude Code qué querés, con el contenido y, si hay, los formularios. Por ejemplo:

> "Armá la página `/servicios` con tres tarjetas (te paso los textos) y abajo el formulario `aplicacion`."

Claude Code:

1. Crea `app/(sitio)/servicios/page.tsx`.
2. Le pone su `metadata` (título y descripción para Google).
3. Suma la ruta a `lib/site/pages.ts` (así entra al sitemap y a Google).
4. Si hay un formulario, usa `<Formulario slug="aplicacion" />`.

Las imágenes van en `public/sitio/`.

## Dónde vive cada cosa

| Qué | Dónde |
|---|---|
| Las páginas | `app/(sitio)/<ruta>/page.tsx` |
| La home (`/`) | `app/(sitio)/page.tsx`. **Por defecto redirige a `/login`**: el clon que quiere su web la reemplaza |
| El marco de todas las páginas (encabezado con el logo y el nombre, pie, seguimiento) | `app/(sitio)/layout.tsx` |
| La lista de páginas públicas (para el sitemap y Google) | `lib/site/pages.ts` |
| Las imágenes | `public/sitio/` |
| La versión por defecto que se copia a un clon nuevo | `scripts/template-files/sitio/` |

El nombre y el logo salen de las variables de marca (`NEXT_PUBLIC_BRAND_NAME` y `NEXT_PUBLIC_BRAND_LOGO_URL`, ver `lib/brand.ts`), nunca escritos en el código.

## Reglas para las páginas

- **Que sean estáticas o con caché: no leer la sesión.** Una página del sitio no usa `cookies()`, `headers()` ni el cliente de Supabase de la persona. Así carga rápido y no se vuelve dinámica sin querer.
- **Rutas reservadas.** No pueden llamarse como algo que el sistema ya usa: `dashboard`, `login`, `auth`, `invite`, `api`, `calendario`, `f`, `embed`. `lib/site/pages.ts` lo valida.
- **Sin embeber.** Las páginas del sitio no se pueden meter en un iframe de otra web (el formulario `/f/<slug>` y el calendario sí).
- **Quien tiene sesión también ve el sitio.** `/` ya no manda a nadie al dashboard por sí sola: lo hace el login (`/login` con sesión va a `/dashboard`, como siempre).

## Poner un formulario en una página: `<Formulario>`

```tsx
import { Formulario } from "@/components/forms/public/formulario";

export default function Contacto() {
  return <Formulario slug="aplicacion" />;
}
```

- Muestra **siempre la versión publicada**. Publicar, pausar, archivar o cambiar el link del formulario actualiza la página **sin volver a desplegar** (la definición se guarda en caché con la etiqueta `form:<slug>` y esas acciones la invalidan; como respaldo se renueva cada hora).
- **Prellenado.** `prefill={{ plan: "pro" }}` fija valores desde el código y gana sobre lo que traiga la URL (`?plan=basic`). Lo que viene en la URL (`?email=ana@x.com`) se lee en el navegador, así la página sigue siendo estática.
- `variant="card"` (por defecto) lo pone en una tarjeta; `variant="plain"`, sin marco. `className` suma clases.
- **Varios en la misma página** funcionan cada uno por su lado.
- Si el formulario no está disponible (en borrador, pausado, archivado o con otro nombre), la página **no se rompe**: en su lugar aparece "Este formulario no está disponible por ahora".
- El envío va por el mismo camino que `/f/<slug>`: captcha, un solo envío por intento, condiciones, archivos, pantalla de éxito o redirección, vistas e inicios en las métricas. En la respuesta queda `origen: sitio` y la ruta de la página.

## SEO

- Cada página define su `metadata` (`title`, `description`, opcionalmente `openGraph`).
- `app/robots.ts` **sigue bloqueando todo** salvo las páginas de `lib/site/pages.ts`; con esa lista vacía queda como antes (nada se indexa).
- `app/sitemap.ts` lista esas mismas páginas. Sin páginas, el sitemap queda vacío.

## De dónde vino cada persona (atribución)

Si alguien llega con `?utm_campaign=octubre` (o un `fbclid`, `gclid`, etc.) a **una página** y llena el formulario en **otra**, o vuelve días después, los datos del anuncio no se pierden:

- **En las páginas de este proyecto** (el sitio y `/f/<slug>`) el layout anota la visita en la cookie `ssa_attr` (`SameSite=Lax`, `Secure`, 90 días). No hace pedidos a la red ni carga nada de terceros.
- **En una web externa** que embebe el formulario, el mismo script `embed.js` guarda esos datos en el `localStorage` de esa web. Para que se guarden en TODAS las páginas (también donde no hay formulario), pegá una vez en el `<head>`:

  ```html
  <script src="https://TU-DOMINIO/embed/embed.js" data-agenda-track async></script>
  ```

  (El código exacto para tu dominio está en la pestaña **Publicar** de cada formulario, en "Seguimiento en todo el sitio".)
- Se guarda la **primera** visita con datos de anuncio (nunca se pisa) y la **última**. Una visita sin UTM ni ids de anuncio no cambia nada.
- Si el navegador bloquea las cookies o el almacenamiento, el formulario funciona igual con los datos de la URL actual.

Todo llega al contacto: los UTM, los ids de clic de cada plataforma (Meta, Google, Microsoft, TikTok, LinkedIn, X, Snapchat, Pinterest, Reddit), los ids del anuncio, las cookies `fbp`, `fbc` y `ga_client_id`, la página de llegada, la del envío y de dónde vino. La lista única de claves está en `lib/attribution/keys.ts`.

## Cada clon es dueño de su sitio

`scripts/export-template.mjs` **no copia** `app/(sitio)/` ni `public/sitio/` de este repo: copia solo la versión por defecto de `scripts/template-files/sitio/` (el `layout.tsx` y una home que lleva al login). Así un clon nuevo arranca con un sitio vacío y nunca hereda el de otro.

## Verificar una página nueva

1. `npm run build` compila y la página aparece como estática (`○`).
2. Se ve bien en el celular (390 px) y en la computadora.
3. Está en `lib/site/pages.ts` si tiene que aparecer en Google.
4. Si tiene formulario: se ve la versión publicada y, con el formulario pausado, la página sigue cargando.
