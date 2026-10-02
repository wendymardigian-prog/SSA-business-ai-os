import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * S4: no debe quedar texto visible en inglés en Configuración ni en
 * Canales. Lee como texto los archivos reales (mismo patrón que
 * member-baseline.test.ts y page-actions.test.ts) y falla si aparece
 * alguna de las cadenas que estaban en inglés antes de este bloque.
 *
 * Son frases, no palabras sueltas: una palabra como "Active" también
 * aparece adentro de identificadores (`isActive`, `handleToggleActive`), así
 * que las cadenas incluyen las comillas que las delimitan en el código
 * (`"Active"`) para no disparar con un falso positivo.
 *
 * Los nombres técnicos (modelos, claves de permiso, nombres de proveedor
 * como Zernio) no se traducen y no están en esta lista.
 */

const FILES = [
  "app/(dashboard)/dashboard/settings/settings-view.tsx",
  "app/(dashboard)/dashboard/settings/team/page.tsx",
  "components/settings/team-view.tsx",
  "app/(dashboard)/dashboard/channels/channels-view.tsx",
  "app/(dashboard)/dashboard/channels/callback/page.tsx",
  "lib/actions/team.ts",
  "app/api/v1/channels/connect/route.ts",
  "app/api/v1/channels/sync/route.ts",
  "app/api/v1/channels/[channelId]/route.ts",
];

const BANNED_STRINGS = [
  // settings-view.tsx
  "Workspace Name",
  "Global Keywords",
  "Save Changes",
  "Settings saved",
  "Saving...",
  "Add a keyword...",
  "No global keywords configured",
  // team-view.tsx
  "(you)",
  "Joined{",
  "Expires{",
  '"Remove member"',
  '"Revoke invite"',
  "Invite a Member",
  "Pending Invites",
  "Inviting...",
  "colleague@example.com",
  "Members (",
  // team/page.tsx
  '"Unknown"',
  // lib/actions/team.ts
  '"Workspace mismatch"',
  "A valid email address is required",
  "An invite for this email is already pending",
  "Only workspace owners can remove members",
  "You cannot remove yourself from the workspace",
  '"Not authenticated"',
  '"Invite not found"',
  "This invite is no longer valid",
  "This invite has expired",
  "This invite was sent to a different email address",
  // channels-view.tsx
  '"Syncing..."',
  "Connect Channel",
  "No channels yet",
  "Channel is active",
  "Channel is inactive",
  '"Delete channel"',
  '"Active"',
  '"Inactive"',
  "Failed to connect",
  "Failed to start connection",
  '"Sync failed"',
  "Could not save some channels",
  "Nothing to connect",
  "All channels up to date",
  "Failed to sync. Check your connection.",
  "Failed to delete channel",
  "Copied!",
  "Copy DM link",
  "Delete channel?",
  // channels/callback/page.tsx
  "Syncing your new channel",
  "Connection was cancelled or failed.",
  "Failed to sync channels.",
  "account connected successfully!",
  "Channel is already synced.",
  "Failed to sync. You can try syncing manually.",
  "Redirecting to channels...",
  // API routes de canales
  '"Unauthorized"',
  '"Channel not found"',
  "Unsupported platform",
  "No Zernio profiles found",
  // Con la comilla de cierre: así no coincide con el console.error homónimo
  // (texto de log para devs, no visible en la UI).
  'Failed to get connect URL"',
  "Connection failed:",
  "Failed to disconnect on Zernio",
  // Con el inicio de la interpolación: así no coincide con el console.error
  // homónimo (dos argumentos, sin interpolar), que es texto de log.
  "Failed to sync channels: ${",
];

describe("Español parejo en Ajustes y Canales (S4)", () => {
  for (const file of FILES) {
    it(`${file} no tiene texto en inglés de la lista conocida`, () => {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      const found = BANNED_STRINGS.filter((banned) => source.includes(banned));
      expect(found).toEqual([]);
    });
  }
});
