# Chicken or Egg

**Which came first? Real prices decide, every round.**

> Built at NEAR HACKATHON. Deadline: 14 Nov 2026 23:59 UTC (Sun 15 Nov 05:29 IST).
> Tracks: Memecoins With Mechanics (`memecoins`) and AI Swarms (`swarms`).
> Network: NEAR testnet only. Nothing here runs on mainnet.

Two memecoins, **$HEN** and **$EGG**, settle the oldest argument on Earth, one round at a time.

## How to play

1. **Pick a side.** Lock some $HEN on the hen, or some $EGG on the egg. This is called roosting.
2. **The scouts go shopping.** A swarm of agents reads the real shop price of chicken and of eggs and reports both on NEAR.
3. **Whichever price rose more came first.** That side hatches: its locked coins grow by 3%, freshly minted. The other side gets fried: 3% of its locked coins burn.
4. **Take your coins back**, or leave them in the nest and pick again.

If the two prices moved almost the same, it is a tie and nothing is minted or burned.
Coins you do not lock are never touched.

Nobody on the team decides the winner. The contract takes the middle value of what the scouts report,
pays the scouts that were close to it, and takes bond from the ones that were not.

The full rules, with the exact arithmetic, are in [`RULES.md`](RULES.md). They were written before the contracts.

## The two coins

`$HEN` and `$EGG` are ordinary NEP-141 coins with 18 decimals. Only the coop contract can mint or burn them, and it does so only for the reasons in this table. Both coins started at a supply of zero. There is no team allocation and no presale.

| What happens | What it does to the supply | Parameter (value in the replay) |
|---|---|---|
| A new player claims a starter pack, once per account | mints 1,000 HEN and 1,000 EGG | `starter_fee` 0.1 NEAR, `starter_cap` 100 packs |
| Your side wins the round | your roosted coins come back with 3% more, newly minted | `hatch_bps` 300 |
| Your side loses the round | 3% of your roosted coins are burned | `fry_bps` 300 |
| The two price moves are closer than 0.1 percentage points | tie: nothing is minted or burned | `tie_bps` 10 |
| Scouts reported honestly in a round with a winner | mints 100 of the winning coin, shared by the honest scouts | `scout_pay` 100 |
| Fewer than 3 scouts reported | void round: nothing is minted or burned | `min_reveals` 3 |

All parameters were set once, when the contract was created. Anyone can read them with `get_config`. The contract has no method that changes them, and the three contract accounts have no access keys, so nobody can replace the code.

The coop writes every mint and burn to a log that anyone can read with `get_ledger`: the round, the reason, the coin and the amount.

The values were chosen from a simulation of 200 scripted players on the real price series. It shows the supply of both coins over 60 days for six kinds of crowd: [`docs/SIMULATION.md`](docs/SIMULATION.md).

## The scout swarm

The scouts are the agents that tell the contract what chicken and eggs cost. Each scout is its own NEAR account under one parent account, and each has locked a bond in NEAR. The coop contract is their coordinator. It does not trust any single scout.

One round for a scout:

1. **Seal.** The scout sends only a hash of its two prices and a secret salt. No scout can see or copy another scout's prices.
2. **Open.** After every seal is in, the scout sends the prices and the salt. The contract checks them against the hash.
3. **Settle.** Anyone may call `settle()`. For each price the contract takes the middle value (the median) of the opened reports and compares it with the last round.
4. **Pay and punish.** A scout within 1% of the middle on both prices is honest and shares the scout pay. A scout outside 1%, or one that sealed a report and never opened it, loses 10% of its bond. That NEAR goes to a pot, and the honest scouts of the round share it equally.
5. **Bench.** A scout whose bond falls below the floor (half of the bond) is benched. The contract refuses its reports until someone tops the bond up.

The replay runs seven scouts with scripted behaviours and no LLM calls, so every run can be repeated:

| Scout | Behaviour |
|---|---|
| `scout-1` to `scout-4` | honest: report the day's prices as recorded |
| `scout-5` | noisy: each price is off by up to 0.5% |
| `scout-6` | lazy: skips one round in five, and in one round in ten seals a report and never opens it |
| `scout-7` | liar: reports chicken 8% too high, to make the hen win |

Each scout signs its reports with a restricted key. That key may call four methods on the coop (`commit`, `reveal`, `settle`, `collect_scout`) and cannot send NEAR. If a scout's machine is broken into, the thief cannot withdraw the bond or move the scout's NEAR. The worst it can do is send false reports and get the scout slashed.

[`RULES.md`](RULES.md) has the sequence diagram and the exact whole-number arithmetic. It was written before the contract code.

## Proof on NEAR testnet

Everything below is on chain and can be checked without trusting this page.

| Account | What it is |
|---|---|
| [`coop.replay.chickenoregg.testnet`](https://testnet.nearblocks.io/address/coop.replay.chickenoregg.testnet) | The coop: the coordinator contract. Runs the rounds, the only minter and burner. |
| [`hen.replay.chickenoregg.testnet`](https://testnet.nearblocks.io/address/hen.replay.chickenoregg.testnet) | $HEN, a NEP-141 token. |
| [`egg.replay.chickenoregg.testnet`](https://testnet.nearblocks.io/address/egg.replay.chickenoregg.testnet) | $EGG, a NEP-141 token. |
| `scout-1` to `scout-7.chickenoregg.testnet` | Seven scout agents, each its own sub-account with its own bond. Example: [`scout-1.chickenoregg.testnet`](https://testnet.nearblocks.io/address/scout-1.chickenoregg.testnet) |

| Claim | Proof |
|---|---|
| Both coins and the coop are deployed, every parameter set in one `new` call | [$HEN](https://testnet.nearblocks.io/txns/3RTnbP1tgXy2Z4nbDUKbFGPwdMi6SMAfJrhWJKPaFndq) · [$EGG](https://testnet.nearblocks.io/txns/ALw76grsf8XtVFhLgSJHXdtz16TYwvhysYp3EodadVFd) · [coop](https://testnet.nearblocks.io/txns/3xnAngUxThDFKVuHfxM6tcugtsDFDNoM9Ep6C5tx7A22) |
| Nobody holds a key to any of the three contracts. The last key of each was deleted | [$HEN](https://testnet.nearblocks.io/txns/8MX8ug3M1UBBNCNLdZSDkWR5S4jHCGRpAqgYfj3y5oyQ) · [$EGG](https://testnet.nearblocks.io/txns/EXdBZouXNZhQhqtNeMYVJjsVFwbvFVWNXJW7rdrxzvby) · [coop](https://testnet.nearblocks.io/txns/5pP5KKgDGVGbHjRRoMYuTN3EPtq4Ctg5PjZRKXD9uWxv) |
| A scout posts its own bond and joins | [bond](https://testnet.nearblocks.io/txns/i2B1WSSsVavSKtp326ZFPP2ALnBWuZFXavA4dnjmicX) · [join](https://testnet.nearblocks.io/txns/HPhmrTsBLCmkEXjxX6aUKWhFtYUvLxFpR6Hd362WoKC9) |
| A running scout signs with a key that may call four methods and cannot send NEAR | [key added](https://testnet.nearblocks.io/txns/EuqfZ9Np3sbC4W3EWo7W3C4fiYV1k8YVmKV3rxkASFTG) (`commit`, `reveal`, `settle`, `collect_scout`) |
| A new player takes a starter pack | [henmaxi](https://testnet.nearblocks.io/txns/6m581wLSsJEwSKcj7jQyYGBREtnFTuCDGzHJp7UmeYUo) |
| A round goes to the hen: mint to hen roosters, burn from egg roosters | round 13, [settle](https://testnet.nearblocks.io/txns/AZz1dQZsSLJDhJxNxaKmuCg6nsdyCr22ycqDDcF4EgLn) |
| A round goes to the egg | round 18, [settle](https://testnet.nearblocks.io/txns/3zyfMYBb2rsFTF4mMJpMReBjfpeQNiuVGYZE9L24uaz9) |
| A tie: the two moves were closer than 0.1 percentage points, nothing minted or burned | round 6, [settle](https://testnet.nearblocks.io/txns/8bSZubdzPrRLMVP9H5v9qaKqReVcbJpUWfrTtHB3XchU) |
| Scouts that seal a report and never open it lose bond | round 11, [settle](https://testnet.nearblocks.io/txns/89naNGSBKCoC5wRJ7iaB59nGQ8rBTXReHRbLj6hfqjUr): six scouts slashed, round void |
| A scout that lies is slashed until it is benched | `scout-7` reported false prices in seven rounds (3, and 5 to 10). It was slashed 7 times, its bond fell from 0.3 to 0.143 NEAR, below the floor of 0.15, and the coop stopped taking its reports. One of the seven: [round 6 settle](https://testnet.nearblocks.io/txns/8bSZubdzPrRLMVP9H5v9qaKqReVcbJpUWfrTtHB3XchU). |

Check any of it yourself with the NEAR CLI:

```sh
# the coop has no access keys
near account list-keys coop.replay.chickenoregg.testnet network-config testnet now
# every parameter of the game
near contract call-function as-read-only coop.replay.chickenoregg.testnet get_config json-args '{}' network-config testnet now
# the record of the liar
near contract call-function as-read-only coop.replay.chickenoregg.testnet get_scout json-args '{"scout_id":"scout-7.chickenoregg.testnet"}' network-config testnet now
```

Every transaction of the launch is listed in [`deploy/replay.lock.json`](deploy/replay.lock.json).

## Limits, stated plainly

- **A majority of scouts can lie together.** The middle value is safe only while fewer than half of the reporting scouts collude. Anyone can join as a scout for one bond, so an attack costs about (N/2 + 1) bonds. With real money the bond must be far larger than what one round can move.
- **We run the first scouts.** All seven run on our machine. Registration is open to anyone, but until others join, the result rests on us.
- **Many accounts.** Hatches and fries are in proportion to the coins roosted, so splitting coins over many accounts gains nothing. The starter pack is per account. One person with many accounts can take many packs; only the fee (0.1 NEAR) and the cap (100 packs) limit that.
- **Shop prices move slowly.** Someone who watches the shelves closely will guess better than a coin flip. That is the game.
- **One city, three shops.** The prices are real shelf prices from grocery delivery apps in Kochi, India. This is a real series, not a national statistic. The contract compares each price only with its own value in the last round, so the currency and the units drop out. See [`docs/INDEX.md`](docs/INDEX.md).
- **The testnet game is a replay.** It plays 107 recorded days, one day about every 100 seconds, so anyone can check each round against `sim/data/daily-index.json`. The scouts read the recorded series, not the shops.
- **The coop pays for its own storage.** Each round adds about 450 bytes to the contract (measured over rounds 11 to 20), which locks about 0.0045 NEAR. The coop pays this from its own balance. Anyone can send it more NEAR.
- **NEAR has no timer.** A round moves on only when someone calls `settle()`. The scouts take turns, and anyone else may call it too.
- **Testnet only.** Nothing is deployed on mainnet and the coins have no value.

## What went wrong during the replay

The mistakes are on chain and we left them there. Six of the first 20 rounds are void:

- **Rounds 1, 2 and 4** passed while we were starting and restarting the scout program. No scout reported.
- **Rounds 11, 12 and 15.** The free public RPC node we used stopped answering for a minute or two at a time. In round 11 six scouts had sealed their reports and could not open them in time. The contract did what the rules say: it slashed all six and made the round void ([transaction](https://testnet.nearblocks.io/txns/89naNGSBKCoC5wRJ7iaB59nGQ8rBTXReHRbLj6hfqjUr)). Rounds 12 and 15 got fewer than three reports and are void too.

A void round mints and burns nothing and keeps the last good prices. The scouts report the missed day again in the next round, so no recorded day is skipped. After round 12 the scouts got a second RPC node, and after round 15 a limit of 20 seconds per request (`lib/near.mjs`).

## Licence

MIT. See `LICENSE`.
