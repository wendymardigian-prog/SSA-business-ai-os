# Diseñador IA · Puesta en marcha

Lo que hay que hacer a mano, una vez por instalación, para que el Diseñador IA pueda exportar y generar archivos (PDF e imágenes). Todo lo demás (diseñar, la IA, publicar con link, las plantillas) funciona sin esto.

## Qué es el servicio de render

`ssa-render` es un navegador sin pantalla (Chromium con Playwright) que convierte un diseño en PNG y PDF. Vive **aparte** del servicio de SSA, en la carpeta `render/` del mismo repo, con su propio `Dockerfile` sobre la imagen oficial de Playwright (`mcr.microsoft.com/playwright:v1.65.0-noble`).

- SSA le manda el HTML ya armado. El servicio **no** tiene credenciales de Supabase ni acceso a la base.
- Cada pedido va firmado (HMAC-SHA256 con marca de tiempo, se rechaza si tiene más de 60 s).
- Las páginas se abren **sin JavaScript** y el navegador solo puede salir a Google Fonts y al Storage del proyecto.

## Crear el servicio en Railway

1. En el proyecto de Railway de la instalación: **New → GitHub Repo** → este repositorio.
2. En **Settings → Source → Root Directory**: `render`. Railway usa el `Dockerfile` de esa carpeta.
3. En **Settings → Deploy**: prender **Serverless** (el servicio se duerme cuando no hay pedidos y se despierta con el primero). Casi no cuesta mientras no se usa.
   - Lo que implica: el primer archivo después de un rato sin uso tarda unos segundos más. SSA espera hasta 60 s, reintenta una vez y, si igual falla, el trabajo se reagenda a 1, 5 y 15 minutos.
4. En **Settings → Networking**: **Generate Domain** (queda algo como `https://ssa-render-production.up.railway.app`).
5. Variables del servicio `ssa-render`:

| Variable | Valor |
|---|---|
| `RENDER_SERVICE_SECRET` | 32+ bytes al azar (`openssl rand -hex 32`). El mismo valor va en SSA. |
| `RENDER_ALLOWED_HOSTS` | `fonts.googleapis.com,fonts.gstatic.com,<ref>.supabase.co` (el host EXACTO del Storage del proyecto, el mismo de `NEXT_PUBLIC_SUPABASE_URL`; mejor que el comodín `*.supabase.co`, que abriría a cualquier proyecto). Sin el host del Storage, las imágenes de los diseños no cargan. |

6. Variables del servicio de **SSA** (la app):

| Variable | Valor |
|---|---|
| `RENDER_SERVICE_URL` | El dominio del paso 4, sin barra final. |
| `RENDER_SERVICE_SECRET` | El mismo valor del paso 5. |

`DESIGNER_FAKE_RENDER` **no** va en producción (es para desarrollo y `verify-designer`).

## Cómo probarlo

- `GET <RENDER_SERVICE_URL>/health` → `{"ok":true,"version":"1.0.0+playwright.1.65.0"}` (la primera vez puede tardar unos segundos si estaba dormido).
- En el Diseñador IA: abrir un diseño → **Exportar → PDF**. Tiene que descargarse.

## Costo

Con Serverless, se paga solo el tiempo que está despierto: para el uso de una agencia, del orden de **USD 5–10 por mes** (más si se generan cientos de piezas por día).

## Si el servicio no está

- Exportar y generar muestran **"Falta conectar el servicio de render"**. Las generaciones quedan **Fallidas** con ese motivo y se reintentan desde la pestaña **Generaciones** cuando el servicio está.
- Si el servicio está pero falla de forma pasajera (dormido, ocupado, la red), el trabajo se reintenta solo a 1, 5 y 15 minutos y recién después queda fallido con el motivo.
- El link público de un diseño ya publicado sigue funcionando (sirve los archivos que ya se habían generado).

## Las migraciones

D1 a D3 (`00319`, `00320`, `00321`) van **antes** de desplegar el código. En una instalación nueva, `/setup` las aplica con las demás.
