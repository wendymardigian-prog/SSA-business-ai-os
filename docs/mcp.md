# Conector MCP

Cada persona del equipo puede conectar Claude (u otra app que hable MCP) al sistema y hacer desde ahí **todo lo que su rol
le permite**: consultar y analizar datos, crear y editar, configurar, mandar mensajes, subir documentos a Conocimiento…
Es el mismo sistema de permisos de las pantallas: si algo no se puede hacer con el mouse, tampoco por el MCP.

## Cómo se conecta una persona

1. En el sistema: **Mi cuenta → Conexiones → «Conectar Claude (MCP)»**. La tarjeta solo aparece si el rol tiene
   **«Usar el MCP»** (`mcp.usar`, Ajustes → Roles, en «Agente de IA»). Owner y Admin lo tienen siempre.
2. Copiá la dirección del conector: `https://<dominio principal>/api/mcp`. Es **la misma para todo el equipo**.
3. En Claude: Configuración → Conectores → Agregar conector personalizado → pegar → «Conectar».
   En Claude Code: `claude mcp add --transport http <nombre> https://<dominio>/api/mcp` y después `/mcp` (la tarjeta
   muestra el comando con el nombre de la marca).
4. Claude abre `/oauth/consent` en el sistema: la persona entra con su usuario (si no lo estaba), elige el negocio y toca
   «Permitir».
5. Vuelve a Claude ya conectada. En la tarjeta aparece la app, con su negocio, «Cambiar negocio» y «Desconectar».

A la persona la identifica su inicio de sesión del paso 4, no la dirección: la dirección no es secreta.

## Cómo funciona por dentro

- **Inicio de sesión: el servidor OAuth 2.1 de Supabase.** El access token que recibe Claude es un JWT de Supabase de
  esa persona, con `client_id` = la app conectada. Claude descubre todo solo:
  - el 401 de `/api/mcp` trae `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource/api/mcp"`;
  - esos metadatos (`app/.well-known/oauth-protected-resource`) dicen que el servidor de autorización es
    `${SUPABASE_URL}/auth/v1`;
  - Supabase tiene registro dinámico de clientes, autoriza y manda a la persona a nuestro consentimiento.
  - `app/.well-known/oauth-authorization-server` reenvía los metadatos de Supabase para clientes viejos.
- **Identidad inyectada (`lib/request-identity.ts`).** La ruta verifica el token (`getClaims`, la misma firma que la
  sesión), busca la conexión (`mcp_connections`: persona + app → negocio) y corre TODO dentro de `runWithIdentity`.
  Ahí `createClient()` usa el token de la persona en vez de las cookies y `getActiveWorkspace()` usa el negocio de la
  conexión (comprobando la membresía). Por eso **las 900+ acciones de `lib/actions` y las rutas de `/api/v1` corren sin
  cambios, con sus guards y la RLS**. Fuera de un pedido del MCP no hay identidad inyectada y todo sigue como siempre.
- **«Usar el MCP» se mira en cada pedido**: quitarlo del rol corta en el pedido siguiente (403). Una conexión
  desconectada da 401.
- **Historial**: lo que se hace por el MCP queda en `audit_log` a nombre de la persona (`actor_type = user`) con
  `metadata.via = "mcp"` y `actor_label = "MCP · <app>"` (`logAudit` lo agrega solo).
- **Sin estado**: un servidor MCP nuevo por pedido, respuesta JSON (`enableJsonResponse`), `maxDuration` 300 s.

## Las herramientas

| Herramienta | Qué hace |
|---|---|
| `negocio_actual`, `cambiar_negocio`, `mis_permisos` | El negocio de la conexión, cambiarlo (solo a uno donde tiene «Usar el MCP») y los permisos del rol |
| `listar_tablas`, `describir_tabla` | Las tablas de `public` y `app_servicio` (los esquemas expuestos; nunca `app_servicio_portal`) (de la descripción OpenAPI de PostgREST, cacheada 10 min) |
| `consultar` | Leer con la sesión (manda la RLS): columnas explícitas, filtros, orden, paginación; `agrupar_por` + `metricas` para análisis (hasta 50.000 filas). Por defecto filtra por el negocio activo |
| `sql_owner` | Solo el Owner del negocio: SQL de solo lectura (`public.mcp_readonly_sql`, 00530) |
| `listar_acciones`, `describir_accion`, `ejecutar_accion` | Cualquier acción de la app (el catálogo) |
| Guiadas | `subir_documento_conocimiento`, `estado_documentos`, `reuniones_sin_analizar`, `analizar_reuniones`, `agendar_reunion`, `mover_reunion`, `enviar_whatsapp`, `enviar_a_grupo`, `crear_automatizacion`, `publicar_automatizacion`, `ver_roles`, `cambiar_permisos_rol`, `invitar_persona`, `errores_del_sistema` |

Las guiadas llaman por dentro a las mismas acciones (`executeCatalogAction`) o a los handlers de `/api/v1` en el mismo
proceso (`callRoute`): mismos permisos, mismas validaciones.

## El catálogo de acciones

`scripts/build-mcp-catalog.mjs` recorre los archivos `"use server"` de `lib/actions/` con el compilador de TypeScript
y genera:

- `lib/mcp/catalog.generated.ts`: cada acción con sus parámetros (las interfaces desplegadas para que la IA sepa qué
  mandar), su JSDoc, las claves de permiso que se ven en el cuerpo y su tipo (lectura / escritura / delicada). Va como
  texto: importado como `.json`, TypeScript deducía el tipo de cada entrada y se quedaba sin memoria.
- `lib/mcp/action-loaders.generated.ts`: un import estático por archivo (para que el bundler los incluya).

`lib/mcp/overrides.json` dice lo que queda **afuera** (entrar, contraseñas, links públicos, cambiar el negocio por
cookie) y pisa la clasificación o la descripción cuando hace falta. **Después de sumar o cambiar una acción, correr
`node scripts/build-mcp-catalog.mjs`**: `lib/mcp/mcp.test.ts` falla si el catálogo no está al día.

Un parámetro `FormData` se manda como objeto; un archivo, como `{ nombre, tipo, base64 }` o `{ url }` (la URL se baja
con `safeFetchResponse`, solo direcciones públicas, tope 25 MB).

## Lo delicado pide confirmación

Una acción delicada (borrar, anular, cancelar, enviar, invitar, roles, publicar, fusionar, restaurar…) pedida sin
`confirmacion` **no hace nada**: devuelve un resumen y un token. El token (`lib/mcp/confirm.ts`) firma persona, negocio,
acción y argumentos, vence a los 5 minutos y se usa **una sola vez** (`mcp_used_confirmations`). Confirmar no saltea
ningún permiso: la acción igual decide.

## SQL del Owner

`public.mcp_readonly_sql(p_workspace_id, p_query)` es **SECURITY INVOKER** (corre con la sesión: manda la RLS, no ve
`vault`, `private` ni `auth`) y antes de ejecutar pasa la transacción a solo lectura (`SET LOCAL
transaction_read_only = on`): nada que escriba puede correr, ni dentro de un `WITH`. Exige ser Owner del negocio, un
solo `SELECT`/`WITH` sin `;` en el medio, 15 s y hasta 1.000 filas.

## Lo que no se puede romper

- **`createClient()` y `getActiveWorkspace()` solo cambian dentro de `runWithIdentity`.** Fuera de un pedido del MCP
  leen las cookies como siempre (`lib/request-identity.test.ts`).
- **El negocio de un pedido es el de la conexión.** Si la persona dejó de ser miembro, el pedido no cae a otro negocio.
- **Nunca se loguea el token, los argumentos ni el mensaje de error de una acción** (pueden traer datos personales).
- **`mcp_connections` y `mcp_used_confirmations` las escribe solo el servidor.**
- Un tipo exportado de una acción nueva va fuera del archivo `"use server"` (como `lib/mcp/connection-types.ts`).

## Puesta en marcha (cada instalación)

1. Aplicar la migración `00530_mcp_connector` (aditiva).
2. En el panel de Supabase: **Authentication → OAuth Server**: prenderlo, *Authorization path* `/oauth/consent` (sobre
   la Site URL, que tiene que ser el dominio principal de la app) y **Allow dynamic client registration**.
3. Dar «Usar el MCP» a los roles que corresponda (Owner y Admin ya lo tienen).

## Verificación

```
node scripts/build-mcp-catalog.mjs --check
MCP_APP_URL=http://localhost:3000 node scripts/verify-mcp.mjs --remota
```

`verify-mcp` necesita la app corriendo (`npm run dev`) contra la base de su `.env`. Como los demás `verify-*`, crea
usuarios y datos `zz-test-` y los limpia; se corre de a uno, con el candado `/private/tmp/ssa-verify.lock`. Contra una
base que no es local hay que pasar `--remota` a propósito. Si el Auth tiene el servidor OAuth prendido, prueba además
el flujo completo de un cliente MCP (registro dinámico, consentimiento, código y token).

## La plantilla de estudiantes

El conector viaja. Como la plantilla poda módulos (y sus archivos de `lib/actions`), `scripts/plantilla/export-with-profile.mjs`
vuelve a generar el catálogo con el código ya podado, igual que el embed.
