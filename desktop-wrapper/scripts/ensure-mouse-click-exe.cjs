const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const exePath = path.join(projectRoot, "bin", "mouse_click.exe");

if (fs.existsSync(exePath)) process.exit(0);

console.error("[predist] Missing click-capture executable:");
console.error(`  ${exePath}`);
console.error("");
console.error("Build it first (requires Python 3):");
console.error("  npm run build:click");
process.exit(1);

