# What each track asks for, and where to check it

The hackathon gives every track a starter prompt with a list of requirements. This page takes the two lists for our tracks line by line. The left column quotes the prompt. The right column says where to look.

Game on testnet: `coop.replay.chickenoregg.testnet`. Every transaction that set it up is in [`deploy/replay.lock.json`](../deploy/replay.lock.json).

## Track `memecoins`: Memecoins With Mechanics

| The prompt asks for | How we meet it | Check it |
|---|---|---|
| "An NEP-141 token with the mechanic in the contract, not in a backend somebody could switch off." | `$HEN` and `$EGG` are NEP-141 coins. Only the coop contract can mint or burn them, and it does so in two places: `settle()` (hatch, fry, scout pay) and `claim_starter()` (the starter pack). No server takes part in a mint or a burn. | `contracts/token/src`, `contracts/coop/src/settle.rs`; a hen round on chain: [settle of round 13](https://testnet.nearblocks.io/txns/AZz1dQZsSLJDhJxNxaKmuCg6nsdyCr22ycqDDcF4EgLn) |
| "All parameters (target, mint size, burn size) set at launch and readable by anyone." | All 19 parameters are arguments of `new` and are stored once. `get_config` returns them. | `contracts/coop/src/lib.rs` (`Config`); `near contract call-function as-read-only coop.replay.chickenoregg.testnet get_config json-args '{}' network-config testnet now` |
| "No admin key that can change them later." | The coop has no owner and no method that writes the config. The coop and both coins have zero access keys, so nobody can deploy new code. | `near account list-keys coop.replay.chickenoregg.testnet network-config testnet now` (same for `hen.` and `egg.`); the three key-drop transactions are in the README proof table |
| "Sybil resistance good enough for a demo, with its limits written plainly in the README." | Hatches and fries are in proportion to the coins roosted, so many accounts gain nothing over one. An account roosts on one side per round. The starter pack is once per account, costs a fee and has a cap. The limit: one person with many accounts can take many packs. | README, "Limits, stated plainly"; `RULES.md`, "Limits, stated plainly" |
| "A page with the current streak, today's progress and a log of every mint and burn." | The data is on chain today: `get_stats` (streak and best streak), `get_round` (phase and time left), `get_ledger` (every mint and burn). The page that shows it is in `web/` and is **not finished yet**. | `get_stats`, `get_round`, `get_ledger` on the coop |
| "Simulate 60 days of community behavior first and show me supply over time under a few scenarios. Then we pick the parameters." | 200 scripted players on the real price series, six kinds of crowd, five parameter sets, supply at day 30 and day 60. The parameters of the game were picked from that table. | [`docs/SIMULATION.md`](SIMULATION.md); `npm run sim:supply` |

## Track `swarms`: AI Swarms

| The prompt asks for | How we meet it | Check it |
|---|---|---|
| "Each agent gets its own sub-account under one parent ..., so every action on chain traces back to a specific agent." | Seven scouts, `scout-1.chickenoregg.testnet` to `scout-7.chickenoregg.testnet`. Each posted its own bond and signs its own reports. Every round records which account settled it and which accounts were slashed. The six bot players are sub-accounts of the same parent. | [`scout-1`](https://testnet.nearblocks.io/address/scout-1.chickenoregg.testnet) on the explorer; `get_scouts` and `get_history` on the coop |
| "A coordinator contract or service that opens a round, collects sealed bids, reveals them and picks a winner." | The coop contract. It opens each round, takes sealed price reports (`commit`), checks the opened reports against the seals (`reveal`), takes the middle value and decides the round (`settle`). Our "bids" are price reports and our "clearing price" is the middle value. | `contracts/coop/src/scouts.rs`, `settle.rs`; `e2e/tests/game.rs` |
| "Write down the rules in RULES.md before writing code." | `RULES.md` is the second commit of the repository. The first contract code is the third. | `git log --reverse --oneline` (first four lines) |
| "A simulation mode ... using scripted strategies, so the market runs without any LLM calls." | 20 scripted scouts over 107 days in three scenarios: one liar, a ring of 5, and a majority ring of 11. The scouts on testnet use the same scripted strategies. | [`docs/SIMULATION.md`](SIMULATION.md), "The scout swarm"; `npm run sim:swarm`; `swarm/sources.mjs` |
| "A live page showing rounds, bids, clearing price and who got what." | The data is on chain today: `get_history` (each round with its middle prices, reports, honest scouts, slashed scouts, NEAR paid from the pot) and `get_scouts` (bond and earnings per scout). The page in `web/` is **not finished yet**. | `get_history`, `get_scouts` on the coop |
| "Start with RULES.md and a sequence diagram of one round in text." | `RULES.md`, section "One round". | [`RULES.md`](../RULES.md) |

## What we do not do

- The example in the swarms prompt settles through NEAR Intents. This game does not use NEAR Intents: nothing in it is swapped or sent across chains.
- The scouts are scripted programs. They make no LLM calls.
- Everything runs on testnet. Nothing is deployed on mainnet.
