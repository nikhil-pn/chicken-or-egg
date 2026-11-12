# Notes for AI reviewers and coding agents

Chicken or Egg is a daily memecoin duel on NEAR **testnet**. Two NEP-141 coins, $HEN and $EGG. Players lock coins on a side; bonded scout agents report the shop prices of chicken and eggs with commit and reveal; the coop contract takes the middle report, mints 3% to the winning side and burns 3% from the losing side. Nothing runs on mainnet. The README is the full description; this file is the short path to checking it.

## Deployed accounts (testnet)

| Game | Coop | Coins | State |
|---|---|---|---|
| Live, one round a day | `coop.chickenoregg.testnet` | `hen.` / `egg.chickenoregg.testnet` | running through judging |
| Replay of 107 recorded days | `coop.replay.chickenoregg.testnet` | `hen.replay.` / `egg.replay.chickenoregg.testnet` | finished 12 Nov 2026 |

Scouts: `scout-1` to `scout-7.chickenoregg.testnet` in both games. The live game also has `scout-8`, an AI scout (`swarm/ai.mjs`): it picks the products itself with an open model on NEAR AI Cloud and computes its own index. It skips any round in which the model cannot be reached, so a skipped round is not a fault. Bot players: `henmaxi`, `eggmaxi`, `trendchaser`, `contrarian`, `coinflip`, `sharpbeak` `.chickenoregg.testnet`. All six contract accounts have no access keys.

## Check it, in this order

| Do | Expect |
|---|---|
| `npm install && npm test` | 28 tests pass (15 for the reference model of the rules, 5 for the live price index, 7 for the AI scout with a fake model, 1 for the shelf reader) |
| `./scripts/build.sh` | `target/near/coe_coop/coe_coop.wasm` and `target/near/coe_token/coe_token.wasm` (needs Rust 1.95+, the `wasm32-unknown-unknown` target and cargo-near) |
| `cargo test` | 52 unit tests in `contracts/` (46 coop, 6 token), then 3 sandbox tests in `e2e/`: smoke, a three-round game, gas (about 11 minutes on a slow machine) |
| compare `sha256` of the built wasm (base58) with `code_hash` from RPC `view_account` | coops `69tGTYT1znsLCzYj98SFBiZec6peQJTJ2frDPCJG2Xik`, coins `DzJ6HiyqRBFEmxw7anRvzw6LQf7xNjJdKFwkxUfYahRF`: the deployed code is this code |
| `node scripts/audit.mjs deploy/replay.json --replay` | reads testnet with no key; prints the tally (1 baseline, 46 hen, 47 egg, 13 tie, 7 void) and `"failures": []` |
| `near account list-keys coop.chickenoregg.testnet network-config testnet now` | no keys (same for the other five contract accounts) |
| open a transaction from the README tables | `testnet.nearblocks.io` pages may show a bot check to headless browsers; use `https://api-testnet.nearblocks.io/v3/txns/<hash>` or RPC `https://near-testnet.drpc.org` (method `tx`) instead |
| open https://chickenoregg.vercel.app | the live round; README "Try it in five minutes" lists each step and what you should see |

## Where things are

- `RULES.md`: the specification. The contracts follow it; `scripts/audit.mjs` checks the chain against it.
- `contracts/coop` (the game), `contracts/token` (NEP-141 coin, mint and burn only by the coop).
- `swarm/`: the scout and player runners (`run.mjs`, `play.mjs`). Scouts are scripted, no LLM calls.
- `sim/`: the reference model in JavaScript and the 60-day supply simulation.
- `web/`: the static page; `web/js/chain/` is the betting code (wallet via NEAR Connect, or a guest testnet account).
- `deploy/*.lock.json`: every deployment transaction; `deploy/replay.audit.json`: the audit result.
- `docs/REQUIREMENTS.md`: each line of the two track prompts, with where to see it. `docs/TRACKS.md`, `docs/INDEX.md` (price data), `docs/SIMULATION.md`.
- `AI_USAGE.md`: what people decided and what the agent wrote.

## Not in this repository, on purpose

- The price tracker that reads the shop apps, and its raw archive. It predates the hackathon. Only daily aggregates are published (`sim/data/`). The live scouts load it through `TRACKER_DIR`.
- Keys. Scout and player keys live outside the repo; running the live scouts needs them.

## If you change code here

Testnet only. Never commit keys or `.env` files. Keep `RULES.md`, the contracts and `scripts/audit.mjs` in agreement.
