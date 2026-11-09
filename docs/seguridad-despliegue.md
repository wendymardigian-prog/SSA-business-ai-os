# Seguridad del despliegue: checklist de Auth

Lo que se configura en el panel de Supabase de cada instalación (no está en el código ni en las migraciones). `node scripts/verify-auth-settings.mjs` comprueba los dos primeros puntos con la Management API (el token de la CLI).

## 1. Registro público apagado (obligatorio)

**Supabase › Authentication › Sign In / Providers › "Allow new users to sign up": apagado.**

El alta es solo por invitación. Desde la 00309 y la 00316, una cuenta que se registra sola no crea un negocio, pero igual queda una cuenta en `auth.users`: con el registro apagado ni siquiera se puede crear.

- `verify-auth-settings` sale **1** con "Apagá Allow new users to sign up en Supabase › Authentication" si está prendido.
- Las invitaciones y `scripts/create-owner.mjs` siguen funcionando con el registro apagado: las cuentas las crea el servidor.

## 2. Contraseñas filtradas (recomendado)

**Supabase › Authentication › Attack Protection › "Leaked password protection": prendida.**

Rechaza contraseñas que aparecen en filtraciones conocidas (HaveIBeenPwned). `verify-auth-settings` **avisa** (no falla) si está apagada.

## 3. Verificación en dos pasos (recomendada para Owner y Admin)

La app permite activar la verificación en dos pasos (TOTP). Se recomienda que el Owner y los Admin la usen: son las cuentas que pueden ver y cambiar todo el negocio.

## Cuándo revisarlo

- Al armar un clon nuevo (`/setup` lo pide).
- Después de cambiar de plan o de proyecto en Supabase.
