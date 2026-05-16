/**
 * Lance evaluate_boardroom.py avec le premier interpréteur Python disponible.
 * Windows : py -3 | macOS/Linux : python3 | python
 */
const { spawnSync } = require("child_process");
const path = require("path");

const script = path.join(__dirname, "evaluate_boardroom.py");
const extraArgs = process.argv.slice(2);

const attempts = [
  { cmd: "py", args: ["-3", script, ...extraArgs] },
  { cmd: "python3", args: [script, ...extraArgs] },
  { cmd: "python", args: [script, ...extraArgs] },
];

for (const { cmd, args } of attempts) {
  const result = spawnSync(cmd, args, { stdio: "inherit", shell: false });
  if (result.error?.code === "ENOENT") continue;
  process.exit(result.status ?? 1);
}

console.error(
  "Python introuvable. Installez Python 3 (https://python.org) puis :\n" +
    "  py -3 -m pip install -r scripts/requirements.txt"
);
process.exit(1);
