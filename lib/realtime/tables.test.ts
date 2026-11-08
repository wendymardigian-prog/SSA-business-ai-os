import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { REALTIME_TABLES } from "./tables";

/**
 * La publicacion de Realtime tiene exactamente las tablas que la interfaz
 * escucha. Una tabla publicada que nadie escucha le cuesta a la base en cada
 * cambio (asi estuvo `messages` hasta la 00327); una escuchada que no esta
 * publicada no avisa nada y la pantalla queda vieja sin ningun error.
 */

const root = join(__dirname, "..", "..");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "node_modules" || name.startsWith(".") || name === "__fixtures__") continue;
      out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

/** Las tablas que escucha la interfaz: `table: "x"` y los `for (const table of [...])` de los archivos con postgres_changes. */
function listenedTables(): string[] {
  const tables = new Set<string>();
  for (const dir of ["app", "components", "lib"]) {
    for (const file of sourceFiles(join(root, dir))) {
      const src = readFileSync(file, "utf8");
      if (!src.includes("postgres_changes")) continue;
      for (const m of src.matchAll(/table:\s*"([a-z_]+)"/g)) tables.add(m[1]);
      for (const m of src.matchAll(/for\s*\(const table of \[([^\]]+)\]/g)) {
        for (const t of m[1].matchAll(/"([a-z_]+)"/g)) tables.add(t[1]);
      }
    }
  }
  return [...tables].sort();
}

describe("la publicacion de Realtime", () => {
  it("tiene exactamente las tablas que escucha la interfaz", () => {
    expect(listenedTables()).toEqual([...REALTIME_TABLES].sort());
  });

  it("messages no esta: nadie la escucha (00327)", () => {
    expect(REALTIME_TABLES).not.toContain("messages");
  });
});
