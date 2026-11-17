// Checks the plugin folder Buzz installs: manifest, icon, and a plugin.js
// built from the current src/ with no runtime imports.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && detail ? ` (${detail})` : ""}`);
  if (!ok) failed++;
};

const manifest = JSON.parse(readFileSync(join(root, "plugin/manifest.json"), "utf8"));
check("manifest id", manifest.id === "orca", manifest.id);
check("manifest apiVersion 1", manifest.apiVersion === 1);
const desc = Buffer.byteLength(manifest.description || "");
check("manifest description is 1-280 bytes", desc >= 1 && desc <= 280, `${desc} bytes`);
const host = manifest.host ?? {};
const processes = host.processes ?? [];
const [orca] = processes;
check("manifest runs only the orca locator", processes.length === 1 && orca.id === "orca" && orca.program === "sh" && orca.args?.length === 3 && orca.args[0] === "-c" && orca.args[2] === "orca", JSON.stringify(processes));
const locator = orca?.args?.[1] ?? "";
check("the locator finds Orca.app and answers when it is missing", /\/Applications\/Orca\.app/.test(locator) && /Contents\/Resources\/bin\/orca/.test(locator) && /orca_not_installed/.test(locator) && /exec "\$o" "\$@"/.test(locator));
check("the locator fits Buzz's 1024-byte argument limit", Buffer.byteLength(locator) <= 1024, `${Buffer.byteLength(locator)} bytes`);
// `files` reads what workers attach (host.readFile, host.resolveDirectory).
check("manifest asks for files", host.files === true, JSON.stringify(host.files));
check("manifest asks for nothing else", Object.keys(host).sort().join(",") === "files,processes", Object.keys(host).join(","));

// Buzz rejects the folder if the icon breaks its limits: PNG, at most 1 MiB,
// 4096 px a side and 1,048,576 px in all.
const icon = readFileSync(join(root, "plugin/icon.png"));
const png = icon.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
const [w, h] = [icon.readUInt32BE(16), icon.readUInt32BE(20)];
check("icon.png is a PNG within Buzz's limits", png && icon.length <= 1 << 20 && w <= 4096 && h <= 4096 && w * h <= 1 << 20, `${icon.length} bytes, ${w}x${h}`);

const before = readFileSync(join(root, "plugin/plugin.js"), "utf8");
check("plugin.js has no runtime imports", !/(^|[;\n])\s*import\s*[{*\w"']/.test(before.replace(/\bimport\.meta\b/g, "")));
execFileSync("node", ["build.mjs"], { cwd: root, stdio: "ignore" });
check("plugin.js is built from the current src/ (run npm run build)", before === readFileSync(join(root, "plugin/plugin.js"), "utf8"));

console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
