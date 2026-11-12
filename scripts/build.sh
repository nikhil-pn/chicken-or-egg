#!/usr/bin/env bash
# Builds both contracts to target/near/<crate>/<crate>.wasm.
# Needs cargo-near: https://github.com/near/cargo-near
set -euo pipefail
cd "$(dirname "$0")/.."
for crate in token coop; do
  (cd "contracts/$crate" && cargo near build non-reproducible-wasm)
done
ls -l target/near/*/*.wasm
