# ssa-render

El servicio que convierte los diseños del Diseñador IA en **PNG** y **PDF**. Es un navegador sin pantalla (Chromium, vía Playwright) que vive aparte del resto del sistema, en su propio servicio de Railway.

SSA le manda **el HTML ya armado**. Este servicio no tiene credenciales de Supabase ni acceso a la base: solo recibe HTML, lo dibuja y devuelve archivos.

- Playwright: **1.65.0** (fijado, sin `^`). La imagen del `Dockerfile` es `mcr.microsoft.com/playwright:v1.65.0-noble`: tienen que ser la misma versión.
- Dependencias propias: `playwright`, `pngjs` (decodificar la captura para medir luminancia) y `pdf-lib` (unir las hojas de un PDF).
- Node puro (`node:http`), sin framework.

## Variables de entorno

| Variable | Obligatoria | Qué es |
| --- | --- | --- |
| `RENDER_SERVICE_SECRET` | Sí | Secreto compartido con SSA para firmar los pedidos (32+ bytes al azar). Sin ella el proceso termina con un mensaje claro. |
| `RENDER_ALLOWED_HOSTS` | No | Hosts a los que el navegador puede salir, separados por comas. Admite comodines `*.dominio`. Por defecto `fonts.googleapis.com,fonts.gstatic.com`. Para las imágenes del Storage de Supabase hay que sumar `*.supabase.co` (o el host exacto del proyecto). |
| `PORT` | No | Puerto donde escucha. Por defecto `8080` (Railway lo pone solo). |

## Contrato

### `GET /health`

Sin firma. Responde `200` con `{ "ok": true, "version": "1.0.0+playwright.1.65.0" }`.

### `POST /render`

Cabecera `X-Render-Signature` obligatoria (ver "La firma"). Cuerpo JSON:

```json
{
  "html": "<!doctype html>…",
  "pages": [{ "html": "<!doctype html>…" }],
  "width": 1080,
  "height": 1350,
  "format": "png",
  "scale": 2,
  "measure": true
}
```

- Exactamente **uno** de `html` o `pages` (no vacío, hasta **35** páginas).
- `width`: entero de 1 a 4000. `height`: entero de 1 a 20000 (alto para páginas web).
- `format`: `"png"` o `"pdf"`.
- `scale`: `1`, `2` o `0.5` (por defecto `1`). Solo afecta al PNG; el PDF es vectorial.
- `measure`: `true` pide además las mediciones (solo con `png`).

Respuesta `200`:

```json
{
  "ok": true,
  "version": "1.0.0+playwright.1.65.0",
  "files": [{ "page": 0, "contentType": "image/png", "base64": "…" }],
  "measure": [
    {
      "page": 0,
      "elements": [
        { "id": "titulo", "x": 20, "y": 20, "w": 200, "h": 30, "overflow": false, "bgLuminance": 0.0052 }
      ]
    }
  ]
}
```

- **PNG**: un archivo por documento, `page` es el índice (desde 0). Se recorta a `width × height` (en CSS px; con `scale: 2` la imagen es el doble).
- **PDF**: **un solo** archivo (`page: 0`) con una hoja por documento, cada una de `width × height` px.
- **`measure`**: por documento, cada elemento con atributo `data-el` con su caja en px CSS, `overflow` (`scrollHeight > clientHeight + 1`) y `bgLuminance`: la luminancia relativa WCAG (0 a 1) del fondo detrás de los elementos con `data-el-type="text"`, o `null` en los demás. Se mide sacando una captura con los textos transparentes y promediando los píxeles de la caja de cada texto.

Errores (siempre `{ "ok": false, "error": "…" }`):

| Código | Error | Cuándo |
| --- | --- | --- |
| 400 | `invalid_request` (con `detail`) | JSON roto o pedido que no cumple el contrato |
| 401 | `bad_signature` | Falta la firma, es inválida o tiene más de 60 s |
| 413 | `body_too_large` | Cuerpo de más de 15 MB (se corta sin leer el resto) |
| 503 | `busy` | Hay 3 renders en curso y la cola de espera (10) está llena |
| 504 | `timeout` | El render pasó los 30 s |
| 500 | `render_failed` | Cualquier otra falla (sin volcar el HTML ni el detalle) |

### La firma

`X-Render-Signature: t=<segundos>,v1=<hex>`, donde `v1` es el HMAC-SHA256 de la cadena `${t}.${cuerpo}` con `RENDER_SERVICE_SECRET`, y `cuerpo` es el cuerpo **crudo** tal cual se manda. Se rechaza si la marca de tiempo difiere más de 60 s de la hora del servicio. La firma se verifica **antes** de parsear el JSON, con comparación en tiempo constante.

`sign.mjs` tiene `signRenderBody`, `renderSignatureHeader` y `verifyRenderSignature`. **Se copia letra por letra en SSA** (`lib/designer/render-sign.ts`) y un test de SSA compara las dos copias: si se toca uno, se toca el otro.

## Seguridad

- **Sin JavaScript**: cada pedido abre un contexto nuevo con `javaScriptEnabled: false`. Los `<script>` del documento no corren.
- **Red restringida**: el navegador solo puede pedir `data:`, `about:` y https (puerto 443, sin usuario ni clave) a los hosts de `RENDER_ALLOWED_HOSTS`. Todo lo demás se aborta. El navegador nunca navega a una URL: el HTML se carga como contenido (`setContent`).
- **Sin disco persistente** y sin credenciales de la base.
- **Logs sin datos**: solo duración, cantidad de páginas, formato y código de respuesta. Nunca el HTML ni el cuerpo.
- Un solo Chromium para todos los pedidos (se lanza al primero; si se cae, se vuelve a lanzar). Corre con `--no-sandbox` porque el contenedor de Railway no admite el sandbox de Chromium: el aislamiento real son el JavaScript apagado y la red restringida.

## Con JavaScript apagado (lo que se comprobó)

Con un Chromium real:

- `page.evaluate` **funciona** (va por el protocolo de depuración) y los scripts del documento no corren.
- `setContent` con `waitUntil: "load"` ya espera las imágenes y las fuentes que pide el CSS; después se espera `document.fonts.ready`.
- Los temporizadores y los escuchadores de eventos de la página **no corren**: dentro de `evaluate` no se usa `setTimeout` ni `addEventListener` (se cuelga).

## Tests

```
cd render
node --test
```

No necesitan Playwright ni red: el navegador es uno falso que se inyecta con `launchBrowser`, y la hora se fija con `now`. No forman parte de la suite principal (`npx vitest run`).

## Correrlo en local

```
cd render
npm ci
npx playwright install chromium
RENDER_SERVICE_SECRET=algo-largo-al-azar npm start
curl http://localhost:8080/health
```

## En Railway

Se crea como un servicio aparte apuntando a la carpeta `render/` (usa el `Dockerfile`). Se deja con **Serverless prendido**: se duerme cuando no recibe pedidos y se despierta con el primero, así casi no cuesta mientras no se usa. **El primer pedido después de dormir tarda unos segundos** (arranca el contenedor y lanza Chromium); el cliente de SSA y los jobs lo toleran con su tiempo de espera y sus reintentos.

En SSA hay que cargar `RENDER_SERVICE_URL` y `RENDER_SERVICE_SECRET`; en este servicio, `RENDER_SERVICE_SECRET` (el mismo valor) y, si hace falta, `RENDER_ALLOWED_HOSTS`. El paso a paso guiado está en `/setup` (paso 6, opcional): Claude crea y configura el servicio y la persona solo pega el secreto. Si los dos servicios están en el mismo proyecto de Railway, la app toma el secreto y la dirección con referencias (`${{render.RENDER_SERVICE_SECRET}}` y `https://${{render.RAILWAY_PUBLIC_DOMAIN}}`).
