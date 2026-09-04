const fs = require("node:fs");
const path = require("node:path");

const repositoryRoot = path.resolve(__dirname, "..");
const distPath = path.join(repositoryRoot, "dist");

fs.rmSync(distPath, { force: true, recursive: true });
