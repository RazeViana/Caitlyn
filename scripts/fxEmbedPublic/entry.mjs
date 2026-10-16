/**
 * @file entry.mjs
 * @description Runs the pinned FxEmbed renderer without account sessions or a public metadata API.
 * Suppresses upstream content logs and validates every outbound host and redirect.
 *
 * @module publicFxEntry
 */

import app from "./src/worker.ts";
import { createPublicFxService } from "./public-service.mjs";
import { guardedUpstreamFetch } from "./public-routing.mjs";

for (const level of ["log", "info", "debug", "warn", "error"]) console[level] = () => undefined;
globalThis.fetch = guardedUpstreamFetch(globalThis.fetch.bind(globalThis));
export default createPublicFxService(app, process.env.FXEMBED_PUBLIC_ORIGIN);
