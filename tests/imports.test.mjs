import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => entry.isDirectory() ? files(resolve(directory, entry.name)) : [resolve(directory, entry.name)]));
  return nested.flat();
}

const modules = (await files(resolve("src/js"))).filter((file) => file.endsWith(".js") && !file.endsWith("app.js"));
for (const module of modules) await import(pathToFileURL(module));
console.log(`Imports válidos: ${modules.length} módulos.`);
