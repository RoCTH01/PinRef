import { readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

function javascriptFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) return javascriptFiles(file);
    return entry.isFile() && /\.(?:js|mjs|cjs)$/.test(entry.name) ? [file] : [];
  });
}

const files = [...javascriptFiles("extension"), ...javascriptFiles("test"), ...javascriptFiles("scripts")];
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`PASS: parsed ${files.length} JavaScript files`);
