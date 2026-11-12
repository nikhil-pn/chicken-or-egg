#!/usr/bin/env bash
# Bundles the two browser libraries the page signs with into single-file ES modules:
#   web/vendor/near-api-js.js    keys, signing and sending for "Play without a wallet"
#   web/vendor/near-connect.js   the NEAR Connect wallet picker (HOT Labs)
# The live page then needs no CDN for its own code. Exact versions, installed into a
# throwaway folder; nothing is added to the project's package.json or node_modules.
# Needs node 22+ and npm. Run again only to change a version.
set -euo pipefail

NEAR_API_JS=7.4.0     # 23 Oct 2026. 7.5.x came out on 11 Nov in four patch releases: too fresh.
NEAR_CONNECT=0.12.0   # 26 Oct 2026, the current release.
ESBUILD=0.28.2

root="$(cd "$(dirname "$0")/.." && pwd)"
out="$root/web/vendor"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$out"

cd "$work"
echo '{"private":true}' > package.json
npm install --no-audit --no-fund --ignore-scripts --save-exact \
  "near-api-js@$NEAR_API_JS" "@hot-labs/near-connect@$NEAR_CONNECT" "esbuild@$ESBUILD" >/dev/null

# Only what the page uses, so the bundle stays small. `is-my-json-valid` (node-only, used by
# near-api-js only for Contract ABI checks, which the page never makes) is replaced by a stub.
cat > no-json-validator.js <<'EOF'
export default function validator() { throw new Error('JSON schema validation is not bundled'); }
EOF
cat > near-api-js.entry.js <<'EOF'
export { Account, JsonRpcProvider, KeyPair, actions } from 'near-api-js';
EOF
cat > near-connect.entry.js <<'EOF'
export { NearConnector } from '@hot-labs/near-connect';
EOF

bundle() { # entry, output file, banner
  node -e '
    const [entry, outfile, banner] = process.argv.slice(1);
    require("esbuild").build({
      entryPoints: [entry], outfile, bundle: true, format: "esm", platform: "browser",
      target: "es2022", minify: true, legalComments: "eof", banner: { js: banner },
      define: { "process.env.NODE_ENV": "\"production\"", global: "globalThis" },
      plugins: [{ name: "stub", setup(b) {
        b.onResolve({ filter: /^is-my-json-valid$/ }, () => ({ path: require("path").resolve("no-json-validator.js") }));
      } }],
    }).catch(() => process.exit(1));
  ' "$1" "$2" "$3"
}

bundle near-api-js.entry.js "$out/near-api-js.js" \
  "/* near-api-js $NEAR_API_JS (MIT AND Apache-2.0), bundled by scripts/build-vendor.sh with esbuild $ESBUILD */"
bundle near-connect.entry.js "$out/near-connect.js" \
  "/* @hot-labs/near-connect $NEAR_CONNECT (MIT), bundled by scripts/build-vendor.sh with esbuild $ESBUILD */"

ls -l "$out"
