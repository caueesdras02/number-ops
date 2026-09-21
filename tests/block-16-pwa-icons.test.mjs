import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

// ---------------------------------------------------------------------------
// BLOCO 16 — ícones do PWA (manifest.json + apple-touch-icon): garante que o
// ícone usado na Tela de Início (iOS/Android) é o glifo oficial da marca
// (src/assets/fivecon-no.png), OPACO (sem transparência) e no tamanho
// declarado — não a wordmark larga/transparente nem um placeholder.
// ---------------------------------------------------------------------------

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function pngDimensions(buffer) {
  // PNG: 8 bytes de assinatura + 4 bytes de tamanho do chunk + "IHDR" (4 bytes)
  // + width (4 bytes, big-endian) + height (4 bytes, big-endian).
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

const manifestRaw = await readFile(path.join(root, "manifest.json"), "utf8");
const manifest = JSON.parse(manifestRaw);

assert.equal(manifest.display, "standalone");
assert.match(manifest.background_color, /^#[0-9a-f]{6}$/i);
assert.match(manifest.theme_color, /^#[0-9a-f]{6}$/i);
assert.ok(manifest.name && manifest.short_name, "precisa de name/short_name pro nome do atalho");

const expectedIcons = [
  { src: "./src/assets/icons/icon-192.png", sizes: "192x192", purpose: "any" },
  { src: "./src/assets/icons/icon-512.png", sizes: "512x512", purpose: "any" },
  { src: "./src/assets/icons/icon-maskable-192.png", sizes: "192x192", purpose: "maskable" },
  { src: "./src/assets/icons/icon-maskable-512.png", sizes: "512x512", purpose: "maskable" },
];
for (const expected of expectedIcons) {
  const found = manifest.icons.find((icon) => icon.src === expected.src);
  assert.ok(found, `manifest.json precisa referenciar ${expected.src}`);
  assert.equal(found.sizes, expected.sizes);
  assert.equal(found.purpose, expected.purpose);
}
assert.doesNotMatch(manifestRaw, /number-ops\.png/, "manifest não deve mais usar a wordmark larga/transparente como ícone");

// Cada arquivo referenciado existe de verdade e tem exatamente o tamanho declarado.
for (const expected of expectedIcons) {
  const filePath = path.join(root, expected.src.replace(/^\.\//, ""));
  const buffer = await readFile(filePath);
  const { width, height } = pngDimensions(buffer);
  const [w, h] = expected.sizes.split("x").map(Number);
  assert.equal(width, w, `${expected.src} deveria ter ${w}px de largura`);
  assert.equal(height, h, `${expected.src} deveria ter ${h}px de altura`);
}

const indexHtml = await readFile(path.join(root, "index.html"), "utf8");
assert.match(indexHtml, /<link rel="apple-touch-icon" sizes="180x180" href="\.\/src\/assets\/icons\/apple-touch-icon-180\.png" \/>/, "apple-touch-icon precisa apontar pro ícone opaco de 180x180, não pra wordmark original");
assert.match(indexHtml, /<link rel="icon" type="image\/svg\+xml" href="\.\/src\/assets\/favicon\.svg" \/>/);
assert.match(indexHtml, /<link rel="icon" type="image\/png" href="\.\/src\/assets\/fivecon-no\.png" \/>/, "favicon PNG de fallback precisa continuar presente");
assert.match(indexHtml, /<link rel="manifest" href="\.\/manifest\.json" \/>/);

const appleTouchBuffer = await readFile(path.join(root, "src/assets/icons/apple-touch-icon-180.png"));
const appleTouchDims = pngDimensions(appleTouchBuffer);
assert.equal(appleTouchDims.width, 180);
assert.equal(appleTouchDims.height, 180);

console.log("Bloco 16 (ícones do PWA): todos os cenários passaram.");
