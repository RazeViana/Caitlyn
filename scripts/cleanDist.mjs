/**
 * @file cleanDist.mjs
 * @description Removes only the repository's generated dist directory before compilation.
 *
 * @module cleanDist
 */

import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const distPath = fileURLToPath(new URL("../dist", import.meta.url));
rmSync(distPath, { force: true, recursive: true });
