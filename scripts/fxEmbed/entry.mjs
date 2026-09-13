/**
 * @file entry.mjs
 * @description Restricts the local FxEmbed service to post metadata and a content-free health endpoint.
 * Suppresses upstream content/token logging before any requests are handled.
 *
 * @module fxEmbedEntry
 */

import app from "./src/worker.ts";
import * as credentials from "./src/providers/twitter/proxy/credentials.ts";
import { createLocalFxService } from "./service.mjs";

for (const level of ["log", "info", "debug", "warn", "error"]) console[level] = () => undefined;

export default createLocalFxService(app, credentials, () => caches.default.match(new Request("https://caitlyn-fxembed.invalid/health-probe")));
