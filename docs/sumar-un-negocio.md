# Sumar un negocio a la misma instalación

Un mismo dueño puede manejar varios negocios desde el mismo login (por ejemplo SSA
y BusinessXcelerator). Cada negocio es un **workspace**: se elige con el selector de
arriba a la izquierda y tiene lo suyo, separado del otro.

Si el negocio es de **otro dueño** (un cliente), no va acá: es una copia nueva del
sistema (`docs/plantilla-clientes.md` y `/setup`).

## Qué es de cada negocio y qué es de la instalación

| De cada negocio | De la instalación (compartido) |
|---|---|
| Claves de Zernio, IA, Resend, Meta, Google, Fathom (Vault con prefijo `ws:<id>:`) | El dominio (`NEXT_PUBLIC_APP_URL`): los links de agenda y formularios salen del mismo |
| Canales, contactos, conversaciones, automatizaciones, contenido, ventas | El login, el ícono de la pestaña y el sitio público (`app/(sitio)/`) |
| El equipo y sus roles | El servidor de Evolution si el negocio no cargó el suyo (cada número es una instancia aparte igual) |
| La marca: nombre, logo, color y tono de la IA (Ajustes → General → Marca, 00266) | La marca de respaldo (`NEXT_PUBLIC_BRAND_*`, `AI_LANGUAGE_STYLE`) |

Los cron y los webhooks ya recorren todos los negocios: no hay nada que configurar
para el segundo.

## Cómo se crea

1. Con la migración `00266` aplicada:

   ```bash
   node scripts/create-workspace.mjs --owner-email=tu@email.com --name="BusinessXcelerator" --timezone=America/Costa_Rica
   ```

   Usa la Service Role Key del `.env`, crea el workspace con vos como Owner y copia
   los precios de IA del negocio más viejo. No crea cuentas (para eso está
   `create-owner.mjs`) y frena si ya tenés un negocio con ese nombre.
2. En la app, cambiá al negocio nuevo con el selector.
3. **Ajustes → General → Marca**: nombre, logo, color y tono. Lo vacío usa la marca de
   la instalación.
4. **Ajustes → Integraciones**: la clave de Zernio de este negocio (registra su webhook
   sola), la IA, Resend con su dominio, y lo demás que use.
5. **Agenda → Configuración → Ajustes**: un usuario de agenda **distinto** al del otro
   negocio. El link es `/calendario/<usuario>/...`, sin el negocio, así que el usuario
   es único en toda la instalación.
6. **Ajustes → Equipo**: invitar a las personas. Quien ya tiene cuenta entra al negocio
   de la invitación al aceptarla.

## Lo que no se puede romper

- **El workspace activo sale de `lib/workspace.ts`**: `getWorkspace()` (pantallas y
  Server Actions) o `getActiveWorkspace()` (API Routes, no redirige). Es el de la
  cookie `workspace_id` si la persona sigue siendo miembro; si no, el más viejo.
  `lib/workspace-boundary.test.ts` falla si alguien vuelve a buscar "el primer
  workspace" con `.limit(1)`.
- **La RLS deja leer todos los negocios de los que sos miembro.** Toda consulta del
  navegador que LISTE filas filtra por el activo (`useActiveWorkspaceId()`,
  `components/dashboard-chrome.tsx`); toda suscripción de Realtime, por
  `workspace_id` o por un id.
- **La marca de un negocio es `resolveBrand(workspace)`** (`lib/brand.ts`): campo por
  campo, lo propio o lo de la instalación, salvo que un negocio con nombre propio y sin
  logo muestra su inicial (nunca el logo del otro). Un negocio sin marca propia se ve
  exactamente igual que antes.
- **El nombre del contrato es el del negocio dueño del formulario**, en la página, al
  firmar (`loadPublishedForm`) y en el PDF.
- **El tono de la IA**: `aiLanguageStyle(propio)` y, para las tareas,
  `loadTaskInstructionsForRun` (pone `{{estilo}}` antes). La pestaña Instrucciones sigue
  con `loadTaskInstructions` (sin reemplazar, para no congelar el tono al guardar).
- **No conectar la misma cuenta de Instagram ni el mismo número en dos negocios**: el
  webhook no sabría a cuál mandarla y los mensajes se pierden.

## Pendiente

- Dominio propio por negocio (los links públicos dicen el dominio de la instalación).
- La vista previa del formulario en el editor muestra el nombre de la instalación en
  el contrato (la página pública y el PDF ya usan el del negocio).
- El `PRODID` del `.ics` de la agenda sigue con el nombre de la instalación (no se ve).
