import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const assets = ["index.html", "manifest.webmanifest", "icon-192.png", "icon-512.png", "apple-touch-icon.png"];
const worker = new URL("sw.js", root);
const original = readFileSync(worker, "utf8");
const template = original.replace(/^const VERSION = "[^"]+";/m, 'const VERSION = "pending";');
const hash = createHash("sha256");

function normalizedText(data) {
  return data.toString("utf8").replace(/\r\n/g, "\n");
}
hash.update(normalizedText(Buffer.from(template)));
for (const name of assets) {
  const contents = readFileSync(new URL(name, root));
  hash.update(name + "\0");
  hash.update(createHash("sha256").update(name.endsWith(".png") ? contents : normalizedText(contents)).digest());
}
const version = hash.digest("hex").slice(0, 16);
const generated = template.replace('const VERSION = "pending";', 'const VERSION = "' + version + '";');
if (process.argv.includes("--check")) {
  if (generated !== original) {
    console.error("Обновите версию офлайн-кэша: node scripts/version-cache.mjs");
    process.exitCode = 1;
  }
} else {
  writeFileSync(worker, generated);
  console.log("Офлайн-кэш: " + version);
}
