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
| Scouts that seal a report and never open it lose bond | round 11, [settle](https://testnet.nearblocks.io/txns/89naNGSBKCoC5wRJ7iaB59nGQ8rBTXReHRbLj6hfqjUr): six scouts slashed, round void |
| A scout that lies is slashed until it is benched | `scout-7` reported false prices in seven rounds (3, and 5 to 10). It was slashed 7 times, its bond fell from 0.3 to 0.143 NEAR, below the floor of 0.15, and the coop stopped taking its reports. |

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

## Licence

MIT. See `LICENSE`.
