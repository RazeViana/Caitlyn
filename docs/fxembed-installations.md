# FxEmbed installation inventory

Installed inside `caitlyn-fxembed:local` in Docker context `colima-caitlyn-media-test` on 2026-09-13. No macOS or root-project packages installed. Upstream lifecycle install scripts disabled. Existing Docker/Colima reused.

The later account-support candidate `sha256:8892d8b6cd000c8fae5f612a5e3c3fb09d687f206cced55ae7a12cd07d0a3768` reused all 12 base/dependency layers unchanged. No additional packages were installed; this inventory still applies. Existing host 1Password CLI 2.39.0 at `/opt/homebrew/bin/op` was reused, not installed by this work.

- FxEmbed source: `5b5b6207d9fd93bae15a68ab659fbc97cdbf61b5` (`vendor/fxembed`).
- Local workspace: `@fxembed/atmosphere@0.0.1` at `/app/packages/atmosphere`.
- Node.js: `v24.19.0` at `/usr/local/bin/node`.
- npm: `11.17.0` at `/usr/local/lib/node_modules/npm`.
- Pinned Linux arm64 base: `node:24.19.0-bookworm-slim@sha256:be8929e08ae137e81b5e1edba02259e6c4cb2f5ad655092bb9f56b97e41c4536`.

## npm packages present in the image

| Package | Version | Container path |
| --- | --- | --- |
| `@asteasolutions/zod-to-openapi` | `9.1.0` | `/app/node_modules/@asteasolutions/zod-to-openapi` |
| `@aws-sdk/checksums` | `3.1000.29` | `/app/node_modules/@aws-sdk/checksums` |
| `@aws-sdk/client-s3` | `3.1127.0` | `/app/node_modules/@aws-sdk/client-s3` |
| `@aws-sdk/core` | `3.977.9` | `/app/node_modules/@aws-sdk/core` |
| `@aws-sdk/credential-provider-env` | `3.972.70` | `/app/node_modules/@aws-sdk/credential-provider-env` |
| `@aws-sdk/credential-provider-http` | `3.972.72` | `/app/node_modules/@aws-sdk/credential-provider-http` |
| `@aws-sdk/credential-provider-ini` | `3.973.15` | `/app/node_modules/@aws-sdk/credential-provider-ini` |
| `@aws-sdk/credential-provider-login` | `3.972.77` | `/app/node_modules/@aws-sdk/credential-provider-login` |
| `@aws-sdk/credential-provider-node` | `3.972.82` | `/app/node_modules/@aws-sdk/credential-provider-node` |
| `@aws-sdk/credential-provider-process` | `3.972.70` | `/app/node_modules/@aws-sdk/credential-provider-process` |
| `@aws-sdk/credential-provider-sso` | `3.973.14` | `/app/node_modules/@aws-sdk/credential-provider-sso` |
| `@aws-sdk/credential-provider-web-identity` | `3.972.76` | `/app/node_modules/@aws-sdk/credential-provider-web-identity` |
| `@aws-sdk/middleware-sdk-s3` | `3.972.75` | `/app/node_modules/@aws-sdk/middleware-sdk-s3` |
| `@aws-sdk/nested-clients` | `3.997.44` | `/app/node_modules/@aws-sdk/nested-clients` |
| `@aws-sdk/s3-request-presigner` | `3.1127.0` | `/app/node_modules/@aws-sdk/s3-request-presigner` |
| `@aws-sdk/signature-v4-multi-region` | `3.996.46` | `/app/node_modules/@aws-sdk/signature-v4-multi-region` |
| `@aws-sdk/token-providers` | `3.1116.0` | `/app/node_modules/@aws-sdk/token-providers` |
| `@aws-sdk/types` | `3.974.5` | `/app/node_modules/@aws-sdk/types` |
| `@aws-sdk/xml-builder` | `3.972.40` | `/app/node_modules/@aws-sdk/xml-builder` |
| `@aws/lambda-invoke-store` | `0.3.0` | `/app/node_modules/@aws/lambda-invoke-store` |
| `@babel/code-frame` | `7.29.7` | `/app/node_modules/@babel/code-frame` |
| `@babel/compat-data` | `7.29.7` | `/app/node_modules/@babel/compat-data` |
| `@babel/core` | `7.29.7` | `/app/node_modules/@babel/core` |
| `@babel/generator` | `7.29.8` | `/app/node_modules/@babel/generator` |
| `@babel/helper-compilation-targets` | `7.29.7` | `/app/node_modules/@babel/helper-compilation-targets` |
| `@babel/helper-globals` | `7.29.7` | `/app/node_modules/@babel/helper-globals` |
| `@babel/helper-module-imports` | `7.29.7` | `/app/node_modules/@babel/helper-module-imports` |
| `@babel/helper-module-transforms` | `7.29.7` | `/app/node_modules/@babel/helper-module-transforms` |
| `@babel/helper-string-parser` | `7.29.7` | `/app/node_modules/@babel/helper-string-parser` |
| `@babel/helper-validator-identifier` | `7.29.7` | `/app/node_modules/@babel/helper-validator-identifier` |
| `@babel/helper-validator-option` | `7.29.7` | `/app/node_modules/@babel/helper-validator-option` |
| `@babel/helpers` | `7.29.7` | `/app/node_modules/@babel/helpers` |
| `@babel/parser` | `7.29.8` | `/app/node_modules/@babel/parser` |
| `@babel/template` | `7.29.7` | `/app/node_modules/@babel/template` |
| `@babel/traverse` | `7.29.8` | `/app/node_modules/@babel/traverse` |
| `@babel/types` | `7.29.8` | `/app/node_modules/@babel/types` |
| `@cacheable/memory` | `2.2.0` | `/app/node_modules/@cacheable/memory` |
| `@keyv/bigmap` | `1.3.1` | `/app/node_modules/@cacheable/memory/node_modules/@keyv/bigmap` |
| `keyv` | `5.6.0` | `/app/node_modules/@cacheable/memory/node_modules/keyv` |
| `@cacheable/utils` | `2.5.0` | `/app/node_modules/@cacheable/utils` |
| `keyv` | `5.6.0` | `/app/node_modules/@cacheable/utils/node_modules/keyv` |
| `@cloudflare/kv-asset-handler` | `0.5.0` | `/app/node_modules/@cloudflare/kv-asset-handler` |
| `@cloudflare/unenv-preset` | `2.16.1` | `/app/node_modules/@cloudflare/unenv-preset` |
| `@cloudflare/vitest-pool-workers` | `0.22.0` | `/app/node_modules/@cloudflare/vitest-pool-workers` |
| `wrangler` | `4.124.0` | `/app/node_modules/@cloudflare/vitest-pool-workers/node_modules/wrangler` |
| `zod` | `4.4.3` | `/app/node_modules/@cloudflare/vitest-pool-workers/node_modules/zod` |
| `@cloudflare/workerd-linux-arm64` | `1.20260815.1` | `/app/node_modules/@cloudflare/workerd-linux-arm64` |
| `@cloudflare/workers-types` | `5.20260906.1` | `/app/node_modules/@cloudflare/workers-types` |
| `@cspotcode/source-map-support` | `0.8.1` | `/app/node_modules/@cspotcode/source-map-support` |
| `@jridgewell/trace-mapping` | `0.3.9` | `/app/node_modules/@cspotcode/source-map-support/node_modules/@jridgewell/trace-mapping` |
| `@esbuild/linux-arm64` | `0.28.1` | `/app/node_modules/@esbuild/linux-arm64` |
| `@eslint-community/eslint-utils` | `4.10.1` | `/app/node_modules/@eslint-community/eslint-utils` |
| `@eslint-community/regexpp` | `4.12.2` | `/app/node_modules/@eslint-community/regexpp` |
| `@eslint/config-array` | `0.23.5` | `/app/node_modules/@eslint/config-array` |
| `@eslint/config-helpers` | `0.7.0` | `/app/node_modules/@eslint/config-helpers` |
| `@eslint/core` | `1.2.1` | `/app/node_modules/@eslint/core` |
| `@eslint/eslintrc` | `2.1.4` | `/app/node_modules/@eslint/eslintrc` |
| `balanced-match` | `1.0.2` | `/app/node_modules/@eslint/eslintrc/node_modules/balanced-match` |
| `brace-expansion` | `1.1.18` | `/app/node_modules/@eslint/eslintrc/node_modules/brace-expansion` |
| `espree` | `9.6.1` | `/app/node_modules/@eslint/eslintrc/node_modules/espree` |
| `globals` | `13.24.0` | `/app/node_modules/@eslint/eslintrc/node_modules/globals` |
| `ignore` | `5.3.2` | `/app/node_modules/@eslint/eslintrc/node_modules/ignore` |
| `minimatch` | `3.1.5` | `/app/node_modules/@eslint/eslintrc/node_modules/minimatch` |
| `@eslint/js` | `10.0.1` | `/app/node_modules/@eslint/js` |
| `@eslint/object-schema` | `3.0.5` | `/app/node_modules/@eslint/object-schema` |
| `@eslint/plugin-kit` | `0.7.3` | `/app/node_modules/@eslint/plugin-kit` |
| `@formatjs/fast-memoize` | `3.1.7` | `/app/node_modules/@formatjs/fast-memoize` |
| `@formatjs/icu-messageformat-parser` | `3.5.17` | `/app/node_modules/@formatjs/icu-messageformat-parser` |
| `@formatjs/icu-skeleton-parser` | `2.1.11` | `/app/node_modules/@formatjs/icu-skeleton-parser` |
| `@fxembed/atmosphere` | `0.0.1` | `/app/node_modules/@fxembed/atmosphere` |
| `@hono/sentry` | `1.2.2` | `/app/node_modules/@hono/sentry` |
| `@hono/zod-openapi` | `1.6.3` | `/app/node_modules/@hono/zod-openapi` |
| `@hono/zod-validator` | `0.9.1` | `/app/node_modules/@hono/zod-validator` |
| `@humanfs/core` | `0.19.2` | `/app/node_modules/@humanfs/core` |
| `@humanfs/node` | `0.16.8` | `/app/node_modules/@humanfs/node` |
| `@humanfs/types` | `0.15.0` | `/app/node_modules/@humanfs/types` |
| `@humanwhocodes/config-array` | `0.13.0` | `/app/node_modules/@humanwhocodes/config-array` |
| `balanced-match` | `1.0.2` | `/app/node_modules/@humanwhocodes/config-array/node_modules/balanced-match` |
| `brace-expansion` | `1.1.18` | `/app/node_modules/@humanwhocodes/config-array/node_modules/brace-expansion` |
| `minimatch` | `3.1.5` | `/app/node_modules/@humanwhocodes/config-array/node_modules/minimatch` |
| `@humanwhocodes/module-importer` | `1.0.1` | `/app/node_modules/@humanwhocodes/module-importer` |
| `@humanwhocodes/object-schema` | `2.0.3` | `/app/node_modules/@humanwhocodes/object-schema` |
| `@humanwhocodes/retry` | `0.4.3` | `/app/node_modules/@humanwhocodes/retry` |
| `@img/colour` | `1.1.0` | `/app/node_modules/@img/colour` |
| `@img/sharp-libvips-linux-arm64` | `1.3.1` | `/app/node_modules/@img/sharp-libvips-linux-arm64` |
| `@img/sharp-libvips-linuxmusl-arm64` | `1.3.1` | `/app/node_modules/@img/sharp-libvips-linuxmusl-arm64` |
| `@img/sharp-linux-arm64` | `0.35.2` | `/app/node_modules/@img/sharp-linux-arm64` |
| `@img/sharp-linuxmusl-arm64` | `0.35.2` | `/app/node_modules/@img/sharp-linuxmusl-arm64` |
| `@jridgewell/gen-mapping` | `0.3.13` | `/app/node_modules/@jridgewell/gen-mapping` |
| `@jridgewell/remapping` | `2.3.5` | `/app/node_modules/@jridgewell/remapping` |
| `@jridgewell/resolve-uri` | `3.1.2` | `/app/node_modules/@jridgewell/resolve-uri` |
| `@jridgewell/source-map` | `0.3.11` | `/app/node_modules/@jridgewell/source-map` |
| `@jridgewell/sourcemap-codec` | `1.6.0` | `/app/node_modules/@jridgewell/sourcemap-codec` |
| `@jridgewell/trace-mapping` | `0.3.31` | `/app/node_modules/@jridgewell/trace-mapping` |
| `@keyv/serialize` | `1.1.1` | `/app/node_modules/@keyv/serialize` |
| `@microsoft/eslint-formatter-sarif` | `3.1.0` | `/app/node_modules/@microsoft/eslint-formatter-sarif` |
| `@eslint/js` | `8.57.1` | `/app/node_modules/@microsoft/eslint-formatter-sarif/node_modules/@eslint/js` |
| `balanced-match` | `1.0.2` | `/app/node_modules/@microsoft/eslint-formatter-sarif/node_modules/balanced-match` |
| `brace-expansion` | `1.1.18` | `/app/node_modules/@microsoft/eslint-formatter-sarif/node_modules/brace-expansion` |
| `eslint` | `8.57.1` | `/app/node_modules/@microsoft/eslint-formatter-sarif/node_modules/eslint` |
| `eslint-scope` | `7.2.2` | `/app/node_modules/@microsoft/eslint-formatter-sarif/node_modules/eslint-scope` |
| `espree` | `9.6.1` | `/app/node_modules/@microsoft/eslint-formatter-sarif/node_modules/espree` |
| `file-entry-cache` | `6.0.1` | `/app/node_modules/@microsoft/eslint-formatter-sarif/node_modules/file-entry-cache` |
| `flat-cache` | `3.2.0` | `/app/node_modules/@microsoft/eslint-formatter-sarif/node_modules/flat-cache` |
| `globals` | `13.24.0` | `/app/node_modules/@microsoft/eslint-formatter-sarif/node_modules/globals` |
| `ignore` | `5.3.2` | `/app/node_modules/@microsoft/eslint-formatter-sarif/node_modules/ignore` |
| `minimatch` | `3.1.5` | `/app/node_modules/@microsoft/eslint-formatter-sarif/node_modules/minimatch` |
| `@nodelib/fs.scandir` | `2.1.5` | `/app/node_modules/@nodelib/fs.scandir` |
| `@nodelib/fs.stat` | `2.0.5` | `/app/node_modules/@nodelib/fs.stat` |
| `@nodelib/fs.walk` | `1.2.8` | `/app/node_modules/@nodelib/fs.walk` |
| `@oxc-project/types` | `0.147.0` | `/app/node_modules/@oxc-project/types` |
| `@pkgr/core` | `0.3.6` | `/app/node_modules/@pkgr/core` |
| `@poppinss/colors` | `4.1.6` | `/app/node_modules/@poppinss/colors` |
| `@poppinss/dumper` | `0.6.5` | `/app/node_modules/@poppinss/dumper` |
| `supports-color` | `10.2.2` | `/app/node_modules/@poppinss/dumper/node_modules/supports-color` |
| `@poppinss/exception` | `1.2.3` | `/app/node_modules/@poppinss/exception` |
| `@rolldown/binding-linux-arm64-gnu` | `1.2.6` | `/app/node_modules/@rolldown/binding-linux-arm64-gnu` |
| `@rolldown/binding-linux-arm64-musl` | `1.2.6` | `/app/node_modules/@rolldown/binding-linux-arm64-musl` |
| `@rolldown/pluginutils` | `1.0.1` | `/app/node_modules/@rolldown/pluginutils` |
| `@sentry/bundler-plugins` | `10.71.0` | `/app/node_modules/@sentry/bundler-plugins` |
| `@sentry/cli` | `2.58.6` | `/app/node_modules/@sentry/cli` |
| `@sentry/cli-linux-arm64` | `2.58.6` | `/app/node_modules/@sentry/cli-linux-arm64` |
| `@sentry/conventions` | `0.16.0` | `/app/node_modules/@sentry/conventions` |
| `@sentry/core` | `10.71.0` | `/app/node_modules/@sentry/core` |
| `@sentry/esbuild-plugin` | `5.4.0` | `/app/node_modules/@sentry/esbuild-plugin` |
| `@sentry/types` | `8.9.2` | `/app/node_modules/@sentry/types` |
| `@sentry/utils` | `8.9.2` | `/app/node_modules/@sentry/utils` |
| `@sindresorhus/is` | `7.2.0` | `/app/node_modules/@sindresorhus/is` |
| `@smithy/core` | `3.33.3` | `/app/node_modules/@smithy/core` |
| `@smithy/credential-provider-imds` | `4.5.2` | `/app/node_modules/@smithy/credential-provider-imds` |
| `@smithy/fetch-http-handler` | `5.7.2` | `/app/node_modules/@smithy/fetch-http-handler` |
| `@smithy/node-http-handler` | `4.11.3` | `/app/node_modules/@smithy/node-http-handler` |
| `@smithy/signature-v4` | `5.7.3` | `/app/node_modules/@smithy/signature-v4` |
| `@smithy/types` | `4.17.2` | `/app/node_modules/@smithy/types` |
| `@speed-highlight/core` | `1.2.24` | `/app/node_modules/@speed-highlight/core` |
| `@standard-schema/spec` | `1.1.0` | `/app/node_modules/@standard-schema/spec` |
| `@types/chai` | `5.2.3` | `/app/node_modules/@types/chai` |
| `@types/deep-eql` | `4.0.2` | `/app/node_modules/@types/deep-eql` |
| `@types/esrecurse` | `4.3.1` | `/app/node_modules/@types/esrecurse` |
| `@types/estree` | `1.0.9` | `/app/node_modules/@types/estree` |
| `@types/json-schema` | `7.0.15` | `/app/node_modules/@types/json-schema` |
| `@types/node` | `26.4.0` | `/app/node_modules/@types/node` |
| `@typescript-eslint/eslint-plugin` | `8.69.0` | `/app/node_modules/@typescript-eslint/eslint-plugin` |
| `@typescript-eslint/parser` | `8.69.0` | `/app/node_modules/@typescript-eslint/parser` |
| `@typescript-eslint/project-service` | `8.69.0` | `/app/node_modules/@typescript-eslint/project-service` |
| `@typescript-eslint/scope-manager` | `8.69.0` | `/app/node_modules/@typescript-eslint/scope-manager` |
| `@typescript-eslint/tsconfig-utils` | `8.69.0` | `/app/node_modules/@typescript-eslint/tsconfig-utils` |
| `@typescript-eslint/type-utils` | `8.69.0` | `/app/node_modules/@typescript-eslint/type-utils` |
| `@typescript-eslint/types` | `8.69.0` | `/app/node_modules/@typescript-eslint/types` |
| `@typescript-eslint/typescript-estree` | `8.69.0` | `/app/node_modules/@typescript-eslint/typescript-estree` |
| `semver` | `7.8.5` | `/app/node_modules/@typescript-eslint/typescript-estree/node_modules/semver` |
| `@typescript-eslint/utils` | `8.69.0` | `/app/node_modules/@typescript-eslint/utils` |
| `@typescript-eslint/visitor-keys` | `8.69.0` | `/app/node_modules/@typescript-eslint/visitor-keys` |
| `eslint-visitor-keys` | `5.0.1` | `/app/node_modules/@typescript-eslint/visitor-keys/node_modules/eslint-visitor-keys` |
| `@ungap/structured-clone` | `1.4.0` | `/app/node_modules/@ungap/structured-clone` |
| `@vitest/expect` | `4.1.11` | `/app/node_modules/@vitest/expect` |
| `@vitest/mocker` | `4.1.11` | `/app/node_modules/@vitest/mocker` |
| `@vitest/pretty-format` | `4.1.11` | `/app/node_modules/@vitest/pretty-format` |
| `@vitest/runner` | `4.1.11` | `/app/node_modules/@vitest/runner` |
| `@vitest/snapshot` | `4.1.11` | `/app/node_modules/@vitest/snapshot` |
| `@vitest/spy` | `4.1.11` | `/app/node_modules/@vitest/spy` |
| `@vitest/utils` | `4.1.11` | `/app/node_modules/@vitest/utils` |
| `@webassemblyjs/ast` | `1.14.1` | `/app/node_modules/@webassemblyjs/ast` |
| `@webassemblyjs/floating-point-hex-parser` | `1.13.2` | `/app/node_modules/@webassemblyjs/floating-point-hex-parser` |
| `@webassemblyjs/helper-api-error` | `1.13.2` | `/app/node_modules/@webassemblyjs/helper-api-error` |
| `@webassemblyjs/helper-buffer` | `1.14.1` | `/app/node_modules/@webassemblyjs/helper-buffer` |
| `@webassemblyjs/helper-numbers` | `1.13.2` | `/app/node_modules/@webassemblyjs/helper-numbers` |
| `@webassemblyjs/helper-wasm-bytecode` | `1.13.2` | `/app/node_modules/@webassemblyjs/helper-wasm-bytecode` |
| `@webassemblyjs/helper-wasm-section` | `1.14.1` | `/app/node_modules/@webassemblyjs/helper-wasm-section` |
| `@webassemblyjs/ieee754` | `1.13.2` | `/app/node_modules/@webassemblyjs/ieee754` |
| `@webassemblyjs/leb128` | `1.13.2` | `/app/node_modules/@webassemblyjs/leb128` |
| `@webassemblyjs/utf8` | `1.13.2` | `/app/node_modules/@webassemblyjs/utf8` |
| `@webassemblyjs/wasm-edit` | `1.14.1` | `/app/node_modules/@webassemblyjs/wasm-edit` |
| `@webassemblyjs/wasm-gen` | `1.14.1` | `/app/node_modules/@webassemblyjs/wasm-gen` |
| `@webassemblyjs/wasm-opt` | `1.14.1` | `/app/node_modules/@webassemblyjs/wasm-opt` |
| `@webassemblyjs/wasm-parser` | `1.14.1` | `/app/node_modules/@webassemblyjs/wasm-parser` |
| `@webassemblyjs/wast-printer` | `1.14.1` | `/app/node_modules/@webassemblyjs/wast-printer` |
| `@xtuc/ieee754` | `1.2.0` | `/app/node_modules/@xtuc/ieee754` |
| `@xtuc/long` | `4.2.2` | `/app/node_modules/@xtuc/long` |
| `acorn` | `8.18.0` | `/app/node_modules/acorn` |
| `acorn-jsx` | `5.3.2` | `/app/node_modules/acorn-jsx` |
| `agent-base` | `6.0.2` | `/app/node_modules/agent-base` |
| `ajv` | `6.15.0` | `/app/node_modules/ajv` |
| `ajv-formats` | `2.1.1` | `/app/node_modules/ajv-formats` |
| `ajv` | `8.20.0` | `/app/node_modules/ajv-formats/node_modules/ajv` |
| `json-schema-traverse` | `1.0.0` | `/app/node_modules/ajv-formats/node_modules/json-schema-traverse` |
| `ansi-regex` | `5.0.1` | `/app/node_modules/ansi-regex` |
| `ansi-styles` | `4.3.0` | `/app/node_modules/ansi-styles` |
| `argparse` | `2.0.1` | `/app/node_modules/argparse` |
| `assertion-error` | `2.0.1` | `/app/node_modules/assertion-error` |
| `balanced-match` | `4.0.4` | `/app/node_modules/balanced-match` |
| `baseline-browser-mapping` | `2.11.20` | `/app/node_modules/baseline-browser-mapping` |
| `blake3-wasm` | `2.1.5` | `/app/node_modules/blake3-wasm` |
| `boolbase` | `1.0.0` | `/app/node_modules/boolbase` |
| `bowser` | `2.14.1` | `/app/node_modules/bowser` |
| `brace-expansion` | `5.0.9` | `/app/node_modules/brace-expansion` |
| `browserslist` | `4.28.8` | `/app/node_modules/browserslist` |
| `buffer-from` | `1.1.2` | `/app/node_modules/buffer-from` |
| `cacheable` | `2.5.0` | `/app/node_modules/cacheable` |
| `keyv` | `5.6.0` | `/app/node_modules/cacheable/node_modules/keyv` |
| `callsites` | `3.1.0` | `/app/node_modules/callsites` |
| `caniuse-lite` | `1.0.30001810` | `/app/node_modules/caniuse-lite` |
| `chai` | `6.2.2` | `/app/node_modules/chai` |
| `chalk` | `4.1.2` | `/app/node_modules/chalk` |
| `cheerio` | `1.2.0` | `/app/node_modules/cheerio` |
| `cheerio-select` | `2.1.0` | `/app/node_modules/cheerio-select` |
| `chrome-trace-event` | `1.0.4` | `/app/node_modules/chrome-trace-event` |
| `cjs-module-lexer` | `1.2.3` | `/app/node_modules/cjs-module-lexer` |
| `color-convert` | `2.0.1` | `/app/node_modules/color-convert` |
| `color-name` | `1.1.4` | `/app/node_modules/color-name` |
| `commander` | `2.20.3` | `/app/node_modules/commander` |
| `concat-map` | `0.0.1` | `/app/node_modules/concat-map` |
| `convert-source-map` | `2.0.0` | `/app/node_modules/convert-source-map` |
| `cookie` | `1.1.1` | `/app/node_modules/cookie` |
| `cross-spawn` | `7.0.6` | `/app/node_modules/cross-spawn` |
| `css-select` | `5.2.2` | `/app/node_modules/css-select` |
| `css-what` | `6.2.2` | `/app/node_modules/css-what` |
| `debug` | `4.4.3` | `/app/node_modules/debug` |
| `deep-is` | `0.1.4` | `/app/node_modules/deep-is` |
| `detect-libc` | `2.1.2` | `/app/node_modules/detect-libc` |
| `doctrine` | `3.0.0` | `/app/node_modules/doctrine` |
| `dom-serializer` | `2.0.0` | `/app/node_modules/dom-serializer` |
| `domelementtype` | `2.3.0` | `/app/node_modules/domelementtype` |
| `domhandler` | `5.0.3` | `/app/node_modules/domhandler` |
| `domutils` | `3.2.2` | `/app/node_modules/domutils` |
| `dotenv` | `17.4.2` | `/app/node_modules/dotenv` |
| `electron-to-chromium` | `1.5.416` | `/app/node_modules/electron-to-chromium` |
| `encoding-sniffer` | `0.2.1` | `/app/node_modules/encoding-sniffer` |
| `enhanced-resolve` | `5.24.5` | `/app/node_modules/enhanced-resolve` |
| `entities` | `4.5.0` | `/app/node_modules/entities` |
| `error-stack-parser-es` | `1.0.5` | `/app/node_modules/error-stack-parser-es` |
| `es-module-lexer` | `2.3.2` | `/app/node_modules/es-module-lexer` |
| `esbuild` | `0.28.1` | `/app/node_modules/esbuild` |
| `escalade` | `3.2.0` | `/app/node_modules/escalade` |
| `escape-string-regexp` | `4.0.0` | `/app/node_modules/escape-string-regexp` |
| `eslint` | `10.10.0` | `/app/node_modules/eslint` |
| `eslint-config-prettier` | `10.1.8` | `/app/node_modules/eslint-config-prettier` |
| `eslint-config-typescript` | `3.0.0` | `/app/node_modules/eslint-config-typescript` |
| `eslint-plugin-optimize-regex` | `1.2.1` | `/app/node_modules/eslint-plugin-optimize-regex` |
| `eslint-plugin-prettier` | `5.5.6` | `/app/node_modules/eslint-plugin-prettier` |
| `eslint-scope` | `9.1.2` | `/app/node_modules/eslint-scope` |
| `eslint-visitor-keys` | `3.4.3` | `/app/node_modules/eslint-visitor-keys` |
| `eslint-visitor-keys` | `5.0.1` | `/app/node_modules/eslint/node_modules/eslint-visitor-keys` |
| `ignore` | `5.3.2` | `/app/node_modules/eslint/node_modules/ignore` |
| `espree` | `11.2.0` | `/app/node_modules/espree` |
| `eslint-visitor-keys` | `5.0.1` | `/app/node_modules/espree/node_modules/eslint-visitor-keys` |
| `esquery` | `1.7.0` | `/app/node_modules/esquery` |
| `esrecurse` | `4.3.0` | `/app/node_modules/esrecurse` |
| `estraverse` | `5.3.0` | `/app/node_modules/estraverse` |
| `estree-walker` | `3.0.3` | `/app/node_modules/estree-walker` |
| `esutils` | `2.0.3` | `/app/node_modules/esutils` |
| `events` | `3.3.0` | `/app/node_modules/events` |
| `expect-type` | `1.4.0` | `/app/node_modules/expect-type` |
| `fast-deep-equal` | `3.1.3` | `/app/node_modules/fast-deep-equal` |
| `fast-diff` | `1.3.0` | `/app/node_modules/fast-diff` |
| `fast-json-stable-stringify` | `2.1.0` | `/app/node_modules/fast-json-stable-stringify` |
| `fast-levenshtein` | `2.0.6` | `/app/node_modules/fast-levenshtein` |
| `fast-uri` | `3.1.6` | `/app/node_modules/fast-uri` |
| `fastq` | `1.20.2` | `/app/node_modules/fastq` |
| `fdir` | `6.5.0` | `/app/node_modules/fdir` |
| `file-entry-cache` | `11.1.5` | `/app/node_modules/file-entry-cache` |
| `find-up` | `5.0.0` | `/app/node_modules/find-up` |
| `flat-cache` | `6.1.23` | `/app/node_modules/flat-cache` |
| `flatted` | `3.4.4` | `/app/node_modules/flatted` |
| `fs.realpath` | `1.0.0` | `/app/node_modules/fs.realpath` |
| `gensync` | `1.0.0-beta.2` | `/app/node_modules/gensync` |
| `glob` | `13.0.6` | `/app/node_modules/glob` |
| `glob-parent` | `6.0.2` | `/app/node_modules/glob-parent` |
| `globals` | `17.12.0` | `/app/node_modules/globals` |
| `graceful-fs` | `4.2.11` | `/app/node_modules/graceful-fs` |
| `graphemer` | `1.4.0` | `/app/node_modules/graphemer` |
| `has-flag` | `4.0.0` | `/app/node_modules/has-flag` |
| `hashery` | `1.5.1` | `/app/node_modules/hashery` |
| `hono` | `4.13.7` | `/app/node_modules/hono` |
| `hookified` | `1.15.1` | `/app/node_modules/hookified` |
| `htmlparser2` | `10.1.0` | `/app/node_modules/htmlparser2` |
| `entities` | `7.0.1` | `/app/node_modules/htmlparser2/node_modules/entities` |
| `https-proxy-agent` | `5.0.1` | `/app/node_modules/https-proxy-agent` |
| `i18next` | `26.4.2` | `/app/node_modules/i18next` |
| `i18next-icu` | `2.4.4` | `/app/node_modules/i18next-icu` |
| `iconv-lite` | `0.6.3` | `/app/node_modules/iconv-lite` |
| `ignore` | `7.0.6` | `/app/node_modules/ignore` |
| `import-fresh` | `3.3.1` | `/app/node_modules/import-fresh` |
| `imurmurhash` | `0.1.4` | `/app/node_modules/imurmurhash` |
| `inflight` | `1.0.6` | `/app/node_modules/inflight` |
| `inherits` | `2.0.4` | `/app/node_modules/inherits` |
| `intl-messageformat` | `11.2.14` | `/app/node_modules/intl-messageformat` |
| `is-extglob` | `2.1.1` | `/app/node_modules/is-extglob` |
| `is-glob` | `4.0.3` | `/app/node_modules/is-glob` |
| `is-path-inside` | `3.0.3` | `/app/node_modules/is-path-inside` |
| `isexe` | `2.0.0` | `/app/node_modules/isexe` |
| `jest-worker` | `27.5.1` | `/app/node_modules/jest-worker` |
| `supports-color` | `8.1.1` | `/app/node_modules/jest-worker/node_modules/supports-color` |
| `js-tokens` | `4.0.0` | `/app/node_modules/js-tokens` |
| `js-yaml` | `4.3.2` | `/app/node_modules/js-yaml` |
| `jschardet` | `3.1.4` | `/app/node_modules/jschardet` |
| `jsesc` | `3.1.0` | `/app/node_modules/jsesc` |
| `json-buffer` | `3.0.1` | `/app/node_modules/json-buffer` |
| `json-schema-traverse` | `0.4.1` | `/app/node_modules/json-schema-traverse` |
| `json-stable-stringify-without-jsonify` | `1.0.1` | `/app/node_modules/json-stable-stringify-without-jsonify` |
| `json5` | `2.2.3` | `/app/node_modules/json5` |
| `keyv` | `4.5.4` | `/app/node_modules/keyv` |
| `kleur` | `4.1.5` | `/app/node_modules/kleur` |
| `levn` | `0.4.1` | `/app/node_modules/levn` |
| `lightningcss` | `1.33.0` | `/app/node_modules/lightningcss` |
| `lightningcss-linux-arm64-gnu` | `1.33.0` | `/app/node_modules/lightningcss-linux-arm64-gnu` |
| `lightningcss-linux-arm64-musl` | `1.33.0` | `/app/node_modules/lightningcss-linux-arm64-musl` |
| `locate-path` | `6.0.0` | `/app/node_modules/locate-path` |
| `lodash` | `4.18.1` | `/app/node_modules/lodash` |
| `lodash.merge` | `4.6.2` | `/app/node_modules/lodash.merge` |
| `lru-cache` | `5.1.1` | `/app/node_modules/lru-cache` |
| `magic-string` | `0.30.21` | `/app/node_modules/magic-string` |
| `merge-stream` | `2.0.0` | `/app/node_modules/merge-stream` |
| `mime-db` | `1.54.0` | `/app/node_modules/mime-db` |
| `miniflare` | `5.20260815.0-alpha` | `/app/node_modules/miniflare` |
| `minimatch` | `10.2.6` | `/app/node_modules/minimatch` |
| `minimizer-webpack-plugin` | `5.8.0` | `/app/node_modules/minimizer-webpack-plugin` |
| `minipass` | `7.1.3` | `/app/node_modules/minipass` |
| `ms` | `2.1.3` | `/app/node_modules/ms` |
| `nanoid` | `3.3.18` | `/app/node_modules/nanoid` |
| `natural-compare` | `1.4.0` | `/app/node_modules/natural-compare` |
| `neo-async` | `2.6.2` | `/app/node_modules/neo-async` |
| `node-fetch` | `2.7.0` | `/app/node_modules/node-fetch` |
| `node-releases` | `2.0.54` | `/app/node_modules/node-releases` |
| `nth-check` | `2.1.1` | `/app/node_modules/nth-check` |
| `obug` | `2.1.4` | `/app/node_modules/obug` |
| `once` | `1.4.0` | `/app/node_modules/once` |
| `openapi3-ts` | `4.6.1` | `/app/node_modules/openapi3-ts` |
| `optionator` | `0.9.4` | `/app/node_modules/optionator` |
| `p-limit` | `3.1.0` | `/app/node_modules/p-limit` |
| `p-locate` | `5.0.0` | `/app/node_modules/p-locate` |
| `parent-module` | `1.0.1` | `/app/node_modules/parent-module` |
| `parse5` | `7.3.0` | `/app/node_modules/parse5` |
| `parse5-htmlparser2-tree-adapter` | `7.1.0` | `/app/node_modules/parse5-htmlparser2-tree-adapter` |
| `parse5-parser-stream` | `7.1.2` | `/app/node_modules/parse5-parser-stream` |
| `entities` | `6.0.1` | `/app/node_modules/parse5/node_modules/entities` |
| `path-exists` | `4.0.0` | `/app/node_modules/path-exists` |
| `path-is-absolute` | `1.0.1` | `/app/node_modules/path-is-absolute` |
| `path-key` | `3.1.1` | `/app/node_modules/path-key` |
| `path-scurry` | `2.0.2` | `/app/node_modules/path-scurry` |
| `lru-cache` | `11.5.2` | `/app/node_modules/path-scurry/node_modules/lru-cache` |
| `path-to-regexp` | `6.3.0` | `/app/node_modules/path-to-regexp` |
| `pathe` | `2.0.3` | `/app/node_modules/pathe` |
| `picocolors` | `1.1.1` | `/app/node_modules/picocolors` |
| `picomatch` | `4.0.7` | `/app/node_modules/picomatch` |
| `postcss` | `8.5.26` | `/app/node_modules/postcss` |
| `prelude-ls` | `1.2.1` | `/app/node_modules/prelude-ls` |
| `prettier` | `3.9.6` | `/app/node_modules/prettier` |
| `prettier-linter-helpers` | `1.0.1` | `/app/node_modules/prettier-linter-helpers` |
| `progress` | `2.0.3` | `/app/node_modules/progress` |
| `proxy-from-env` | `1.1.0` | `/app/node_modules/proxy-from-env` |
| `punycode` | `2.3.1` | `/app/node_modules/punycode` |
| `qified` | `0.10.1` | `/app/node_modules/qified` |
| `hookified` | `2.2.0` | `/app/node_modules/qified/node_modules/hookified` |
| `queue-microtask` | `1.2.3` | `/app/node_modules/queue-microtask` |
| `regexp-tree` | `0.1.27` | `/app/node_modules/regexp-tree` |
| `require-from-string` | `2.0.2` | `/app/node_modules/require-from-string` |
| `resolve-from` | `4.0.0` | `/app/node_modules/resolve-from` |
| `reusify` | `1.1.0` | `/app/node_modules/reusify` |
| `rimraf` | `3.0.2` | `/app/node_modules/rimraf` |
| `balanced-match` | `1.0.2` | `/app/node_modules/rimraf/node_modules/balanced-match` |
| `brace-expansion` | `1.1.18` | `/app/node_modules/rimraf/node_modules/brace-expansion` |
| `glob` | `7.2.3` | `/app/node_modules/rimraf/node_modules/glob` |
| `minimatch` | `3.1.5` | `/app/node_modules/rimraf/node_modules/minimatch` |
| `rolldown` | `1.2.6` | `/app/node_modules/rolldown` |
| `run-parallel` | `1.2.0` | `/app/node_modules/run-parallel` |
| `safer-buffer` | `2.1.2` | `/app/node_modules/safer-buffer` |
| `schema-utils` | `4.3.3` | `/app/node_modules/schema-utils` |
| `ajv` | `8.20.0` | `/app/node_modules/schema-utils/node_modules/ajv` |
| `ajv-keywords` | `5.1.0` | `/app/node_modules/schema-utils/node_modules/ajv-keywords` |
| `json-schema-traverse` | `1.0.0` | `/app/node_modules/schema-utils/node_modules/json-schema-traverse` |
| `semver` | `6.3.1` | `/app/node_modules/semver` |
| `sharp` | `0.35.2` | `/app/node_modules/sharp` |
| `semver` | `7.8.5` | `/app/node_modules/sharp/node_modules/semver` |
| `shebang-command` | `2.0.0` | `/app/node_modules/shebang-command` |
| `shebang-regex` | `3.0.0` | `/app/node_modules/shebang-regex` |
| `siginfo` | `2.0.0` | `/app/node_modules/siginfo` |
| `source-map` | `0.7.6` | `/app/node_modules/source-map` |
| `source-map-js` | `1.2.1` | `/app/node_modules/source-map-js` |
| `source-map-support` | `0.5.21` | `/app/node_modules/source-map-support` |
| `source-map` | `0.6.1` | `/app/node_modules/source-map-support/node_modules/source-map` |
| `stackback` | `0.0.2` | `/app/node_modules/stackback` |
| `std-env` | `4.2.0` | `/app/node_modules/std-env` |
| `strip-ansi` | `6.0.1` | `/app/node_modules/strip-ansi` |
| `strip-json-comments` | `3.1.1` | `/app/node_modules/strip-json-comments` |
| `supports-color` | `7.2.0` | `/app/node_modules/supports-color` |
| `synckit` | `0.11.13` | `/app/node_modules/synckit` |
| `tapable` | `2.3.3` | `/app/node_modules/tapable` |
| `terser` | `5.51.2` | `/app/node_modules/terser` |
| `text-table` | `0.2.0` | `/app/node_modules/text-table` |
| `tinybench` | `2.9.0` | `/app/node_modules/tinybench` |
| `tinyexec` | `1.3.0` | `/app/node_modules/tinyexec` |
| `tinyglobby` | `0.2.17` | `/app/node_modules/tinyglobby` |
| `tinyrainbow` | `3.1.1` | `/app/node_modules/tinyrainbow` |
| `toucan-js` | `4.1.1` | `/app/node_modules/toucan-js` |
| `@sentry/core` | `8.9.2` | `/app/node_modules/toucan-js/node_modules/@sentry/core` |
| `tr46` | `0.0.3` | `/app/node_modules/tr46` |
| `ts-api-utils` | `2.5.0` | `/app/node_modules/ts-api-utils` |
| `ts-loader` | `9.6.2` | `/app/node_modules/ts-loader` |
| `tslib` | `2.8.1` | `/app/node_modules/tslib` |
| `tsx` | `4.23.13` | `/app/node_modules/tsx` |
| `type-check` | `0.4.0` | `/app/node_modules/type-check` |
| `type-fest` | `0.20.2` | `/app/node_modules/type-fest` |
| `typescript` | `6.0.3` | `/app/node_modules/typescript` |
| `typescript-eslint` | `8.69.0` | `/app/node_modules/typescript-eslint` |
| `undici` | `7.29.0` | `/app/node_modules/undici` |
| `undici-types` | `8.3.0` | `/app/node_modules/undici-types` |
| `unenv` | `2.0.0-rc.24` | `/app/node_modules/unenv` |
| `update-browserslist-db` | `1.3.2` | `/app/node_modules/update-browserslist-db` |
| `uri-js` | `4.4.1` | `/app/node_modules/uri-js` |
| `utf8` | `3.0.0` | `/app/node_modules/utf8` |
| `vite` | `8.2.2` | `/app/node_modules/vite` |
| `vitest` | `4.1.11` | `/app/node_modules/vitest` |
| `watchpack` | `2.5.2` | `/app/node_modules/watchpack` |
| `webidl-conversions` | `3.0.1` | `/app/node_modules/webidl-conversions` |
| `webpack` | `5.110.1` | `/app/node_modules/webpack` |
| `webpack-sources` | `3.5.1` | `/app/node_modules/webpack-sources` |
| `whatwg-encoding` | `3.1.1` | `/app/node_modules/whatwg-encoding` |
| `whatwg-mimetype` | `4.0.0` | `/app/node_modules/whatwg-mimetype` |
| `whatwg-url` | `5.0.0` | `/app/node_modules/whatwg-url` |
| `which` | `2.0.2` | `/app/node_modules/which` |
| `why-is-node-running` | `2.3.0` | `/app/node_modules/why-is-node-running` |
| `word-wrap` | `1.2.5` | `/app/node_modules/word-wrap` |
| `workerd` | `1.20260815.1` | `/app/node_modules/workerd` |
| `wrangler` | `4.129.0` | `/app/node_modules/wrangler` |
| `@cloudflare/workerd-linux-arm64` | `1.20260903.1` | `/app/node_modules/wrangler/node_modules/@cloudflare/workerd-linux-arm64` |
| `miniflare` | `5.20260903.0-alpha` | `/app/node_modules/wrangler/node_modules/miniflare` |
| `workerd` | `1.20260903.1` | `/app/node_modules/wrangler/node_modules/workerd` |
| `wrappy` | `1.0.2` | `/app/node_modules/wrappy` |
| `ws` | `8.21.0` | `/app/node_modules/ws` |
| `yallist` | `3.1.1` | `/app/node_modules/yallist` |
| `yaml` | `2.9.0` | `/app/node_modules/yaml` |
| `yocto-queue` | `0.1.0` | `/app/node_modules/yocto-queue` |
| `youch` | `4.1.0-beta.10` | `/app/node_modules/youch` |
| `youch-core` | `0.3.3` | `/app/node_modules/youch-core` |
| `zod` | `4.5.4` | `/app/node_modules/zod` |

## Linux base packages

These packages came with the pinned Debian base image; no apt packages were added.

| Package | Version |
| --- | --- |
| `adduser` | `3.134` |
| `apt` | `2.6.1` |
| `base-files` | `12.4+deb12u15` |
| `base-passwd` | `3.6.1` |
| `bash` | `5.2.15-2+b13` |
| `bsdutils` | `1:2.38.1-5+deb12u3` |
| `coreutils` | `9.1-1` |
| `dash` | `0.5.12-2` |
| `debconf` | `1.5.82` |
| `debian-archive-keyring` | `2023.3+deb12u2` |
| `debianutils` | `5.7-0.5~deb12u1` |
| `diffutils` | `1:3.8-4` |
| `dpkg` | `1.21.23` |
| `e2fsprogs` | `1.47.0-2+b2` |
| `findutils` | `4.9.0-4` |
| `gcc-12-base:arm64` | `12.2.0-14+deb12u1` |
| `gpgv` | `2.2.40-1.1+deb12u2` |
| `grep` | `3.8-5` |
| `gzip` | `1.12-1` |
| `hostname` | `3.23+nmu1` |
| `init-system-helpers` | `1.65.2+deb12u1` |
| `libacl1:arm64` | `2.3.1-3` |
| `libapt-pkg6.0:arm64` | `2.6.1` |
| `libattr1:arm64` | `1:2.5.1-4` |
| `libaudit-common` | `1:3.0.9-1` |
| `libaudit1:arm64` | `1:3.0.9-1` |
| `libblkid1:arm64` | `2.38.1-5+deb12u3` |
| `libbz2-1.0:arm64` | `1.0.8-5+b1` |
| `libc-bin` | `2.36-9+deb12u14` |
| `libc6:arm64` | `2.36-9+deb12u14` |
| `libcap-ng0:arm64` | `0.8.3-1+b3` |
| `libcap2:arm64` | `1:2.66-4+deb12u3+b1` |
| `libcom-err2:arm64` | `1.47.0-2+b2` |
| `libcrypt1:arm64` | `1:4.4.33-2` |
| `libdb5.3:arm64` | `5.3.28+dfsg2-1` |
| `libdebconfclient0:arm64` | `0.270` |
| `libext2fs2:arm64` | `1.47.0-2+b2` |
| `libffi8:arm64` | `3.4.4-1` |
| `libgcc-s1:arm64` | `12.2.0-14+deb12u1` |
| `libgcrypt20:arm64` | `1.10.1-3+deb12u1` |
| `libgmp10:arm64` | `2:6.2.1+dfsg1-1.1` |
| `libgnutls30:arm64` | `3.7.9-2+deb12u7` |
| `libgpg-error0:arm64` | `1.46-1` |
| `libhogweed6:arm64` | `3.8.1-2` |
| `libidn2-0:arm64` | `2.3.3-1+b1` |
| `liblz4-1:arm64` | `1.9.4-1` |
| `liblzma5:arm64` | `5.4.1-1+deb12u1` |
| `libmd0:arm64` | `1.0.4-2` |
| `libmount1:arm64` | `2.38.1-5+deb12u3` |
| `libnettle8:arm64` | `3.8.1-2` |
| `libp11-kit0:arm64` | `0.24.1-2` |
| `libpam-modules:arm64` | `1.5.2-6+deb12u2` |
| `libpam-modules-bin` | `1.5.2-6+deb12u2` |
| `libpam-runtime` | `1.5.2-6+deb12u2` |
| `libpam0g:arm64` | `1.5.2-6+deb12u2` |
| `libpcre2-8-0:arm64` | `10.42-1` |
| `libseccomp2:arm64` | `2.5.4-1+deb12u1` |
| `libselinux1:arm64` | `3.4-1+b6` |
| `libsemanage-common` | `3.4-1` |
| `libsemanage2:arm64` | `3.4-1+b5` |
| `libsepol2:arm64` | `3.4-2.1` |
| `libsmartcols1:arm64` | `2.38.1-5+deb12u3` |
| `libss2:arm64` | `1.47.0-2+b2` |
| `libstdc++6:arm64` | `12.2.0-14+deb12u1` |
| `libsystemd0:arm64` | `252.39-1~deb12u2` |
| `libtasn1-6:arm64` | `4.19.0-2+deb12u1` |
| `libtinfo6:arm64` | `6.4-4` |
| `libudev1:arm64` | `252.39-1~deb12u2` |
| `libunistring2:arm64` | `1.0-2` |
| `libuuid1:arm64` | `2.38.1-5+deb12u3` |
| `libxxhash0:arm64` | `0.8.1-1` |
| `libzstd1:arm64` | `1.5.4+dfsg2-5` |
| `login` | `1:4.13+dfsg1-1+deb12u2` |
| `logsave` | `1.47.0-2+b2` |
| `mawk` | `1.3.4.20200120-3.1` |
| `mount` | `2.38.1-5+deb12u3` |
| `ncurses-base` | `6.4-4` |
| `ncurses-bin` | `6.4-4` |
| `passwd` | `1:4.13+dfsg1-1+deb12u2` |
| `perl-base` | `5.36.0-7+deb12u3` |
| `sed` | `4.9-1+deb12u1` |
| `sysvinit-utils` | `3.06-4` |
| `tar` | `1.34+dfsg-1.2+deb12u1` |
| `tzdata` | `2026b-0+deb12u1` |
| `usr-is-merged` | `37~deb12u1` |
| `util-linux` | `2.38.1-5+deb12u3` |
| `util-linux-extra` | `2.38.1-5+deb12u3` |
| `zlib1g:arm64` | `1:1.2.13.dfsg-1` |

The base image also contains Yarn 1.22.22 under `/opt/yarn-v1.22.22` (unused).

## Generated trust store

`/app/ca-certificates.pem` is generated from Node 24.19.0's built-in Mozilla root certificates and supplied to workerd through `SSL_CERT_FILE`. No OS CA package or custom certificate was installed, and TLS verification remains enabled.

## Final active images

- FxEmbed: `sha256:2ad432736e361f74eb33eb99f360692d45735446667ddf0816675ed9fb2ea864` (`caitlyn-fxembed:local`).
- Updated verifier: `sha256:e63b987a52171befed7615eff7cfbe41bb5d01e27bcc4155f957a336399b0870` (`caitlyn-media-api:local`, `caitlyn-media-fxembed:local`), seven dependency layers reused, no package installation.
- Intermediate build images and earlier extractor images were retained; no global pruning was performed.
