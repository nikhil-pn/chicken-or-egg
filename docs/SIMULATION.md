# Simulation

This is the off-chain simulation that the parameters in `README.md` were chosen from.
It is plain Node.js with no dependencies. `sim/engine.mjs` is a reference model of the coop contract and follows the whole-number rules in `RULES.md`.
Every number below comes from a run of the commands in the last section.

## What was simulated

- **Prices.** The real daily index for chicken and eggs in Kochi, 27 Jul to 10 Nov 2026: 107 days, so 106 day-pairs. `sim/build-data.mjs` turns the research file into `sim/data/daily-index.json`: whole-number prices (chicken in paise per kg, eggs in paise per dozen), chained from the day-one median using each day's same-product move. It is aggregate only. See `sim/data/README.md`.
- **Rounds.** One round per day. Round 1 is the baseline, so day N below means "after round N". The headline run uses the first 60 days (1 baseline plus 59 decided rounds). A second run uses all 107 days.
- **Players.** 200 players, each with one starter pack of 1,000 HEN and 1,000 EGG. Start supply is 200,000 of each coin. Each round a player picks a side by a scripted rule and roosts a share of the wallet balance of that coin. Rules: random, momentum (yesterday's winner), contrarian, always HEN, always EGG, sharp (right 65% of the time, using the true result).
- **Scouts.** 5 honest scouts, 10 NEAR bond each. Other settings: tie_bps 10, scout_pay 100 coins per round. All randomness uses a seeded PRNG, so every run repeats exactly.
- **Crowds.** "mixed" is 25% random, 25% momentum, 15% contrarian, 10% always HEN, 10% always EGG, 15% sharp, each roosting 50% of its coins. The others are all momentum, all sharp, all on one side (always HEN), and the mixed crowd at 10% and 90% participation.
- **Parameter sets.** (hatch_bps, fry_bps) in (200,200), (300,300), (500,300), (300,500), (1000,1000).

## What the real series gives under the integer rules

The first round is the baseline, so there are 106 decided pairs. The original float analysis found 48 HEN, 52 EGG, 6 tie. The integer rules with `tie_bps` 5 give almost the same split (48 / 52 / 6).

| tie_bps | HEN | EGG | TIE | Longest streak (same result, ties break it) |
|---|---|---|---|---|
| 0 | 50 | 56 | 0 | 5 EGG |
| 5 | 48 | 52 | 6 | 4 EGG |
| **10** | **46** | **47** | **13** | 4 EGG |
| 25 | 45 | 41 | 20 | 4 EGG |
| 50 | 37 | 31 | 38 | 4 EGG |

The series is close to a fair coin: no side dominates, and long streaks are rare. A tie threshold of 10 bps (0.1 percentage points) makes about one round in eight a tie.

## Supply over time

Supply is in thousands of coins. d30 and d60 are after round 30 and 60 of the headline run. "min-max" is the lowest and highest supply in the 60 days. "minted" is hatch plus scout pay, "burned" is fry, both summed over both coins and over the 60 days. The last column is the supply at the end of the full 107-day run.

| Crowd | hatch/fry | HEN d30 | HEN d60 | EGG d30 | EGG d60 | HEN min-max | EGG min-max | minted | burned | full run end HEN / EGG |
|---|---|---|---|---|---|---|---|---|---|---|
| mixed | 200/200 | 207.5 | 209.9 | 194.9 | 197.3 | 200.0-209.9 | 194.1-200.0 | 60.4 | 53.2 | 205.5 / 207.6 |
| mixed | 300/300 | 210.7 | 213.6 | 192.1 | 194.8 | 200.0-213.8 | 190.8-200.0 | 88.1 | 79.7 | 206.2 / 209.4 |
| mixed | 500/300 | 228.5 | 249.0 | 201.9 | 220.0 | 200.0-249.0 | 197.5-223.2 | 155.3 | 86.3 | 261.2 / 266.8 |
| mixed | 300/500 | 200.5 | 190.3 | 177.8 | 169.0 | 187.3-203.7 | 169.0-200.0 | 82.1 | 122.8 | 166.2 / 169.3 |
| mixed | 1000/1000 | 236.7 | 243.0 | 175.3 | 180.4 | 200.0-245.7 | 171.2-200.0 | 289.1 | 265.7 | 218.3 / 229.4 |
| all momentum | 200/200 | 192.8 | 194.0 | 181.1 | 182.4 | 190.7-203.3 | 179.6-200.0 | 42.4 | 66.0 | 180.8 / 182.7 |
| all momentum | 300/300 | 188.4 | 189.5 | 171.8 | 173.0 | 185.4-204.9 | 169.5-200.0 | 59.3 | 96.8 | 169.7 / 172.3 |
| all momentum | 500/300 | 198.9 | 214.0 | 171.8 | 185.1 | 193.9-218.0 | 171.2-200.0 | 99.6 | 100.5 | 198.8 / 204.6 |
| all momentum | 300/500 | 170.3 | 159.8 | 154.6 | 145.2 | 157.3-204.9 | 145.2-200.0 | 54.0 | 149.0 | 127.4 / 128.8 |
| all momentum | 1000/1000 | 158.7 | 157.4 | 118.1 | 117.5 | 149.9-216.1 | 112.3-200.0 | 152.3 | 277.4 | 106.0 / 111.1 |
| all sharp | 200/200 | 216.0 | 225.4 | 202.9 | 211.8 | 200.0-225.4 | 198.7-213.6 | 77.5 | 40.2 | 231.5 / 233.9 |
| all sharp | 300/300 | 223.5 | 237.4 | 203.8 | 216.6 | 200.0-237.4 | 198.0-219.3 | 115.6 | 61.6 | 246.1 / 249.8 |
| all sharp | 500/300 | 247.1 | 285.6 | 217.9 | 252.6 | 200.0-285.6 | 198.0-255.7 | 205.6 | 67.4 | 327.1 / 335.7 |
| all sharp | 300/500 | 216.4 | 218.7 | 192.4 | 194.0 | 200.0-219.8 | 190.5-200.0 | 110.6 | 97.9 | 209.0 / 211.8 |
| all sharp | 1000/1000 | 282.8 | 338.1 | 209.5 | 250.8 | 200.0-338.1 | 193.4-261.3 | 426.5 | 237.5 | 371.9 / 390.2 |
| all one side | 200/200 | 213.7 | 214.8 | 201.0 | 202.4 | 200.0-216.4 | 200.0-202.4 | 67.5 | 50.4 | 201.7 / 204.7 |
| all one side | 300/300 | 219.8 | 220.5 | 201.0 | 202.4 | 200.0-223.5 | 200.0-202.4 | 100.2 | 77.3 | 199.6 / 204.7 |
| all one side | 500/300 | 256.9 | 294.9 | 201.0 | 202.4 | 200.0-294.9 | 200.0-202.4 | 188.4 | 91.1 | 310.7 / 204.7 |
| all one side | 300/500 | 198.6 | 173.3 | 201.0 | 202.4 | 168.1-206.2 | 200.0-202.4 | 90.4 | 114.7 | 125.3 / 204.7 |
| all one side | 1000/1000 | 263.0 | 255.4 | 201.0 | 202.4 | 200.0-276.2 | 200.0-202.4 | 354.8 | 297.0 | 173.9 / 204.7 |
| low part. 10% | 200/200 | 202.7 | 204.3 | 199.7 | 201.3 | 200.0-204.3 | 199.6-201.7 | 16.3 | 10.7 | 204.7 / 205.2 |
| low part. 10% | 300/300 | 203.3 | 205.0 | 199.1 | 200.8 | 200.0-205.0 | 198.9-201.4 | 21.8 | 16.0 | 204.8 / 205.5 |
| low part. 10% | 500/300 | 206.6 | 211.3 | 201.1 | 205.7 | 200.0-211.3 | 199.5-206.3 | 33.2 | 16.2 | 214.4 / 215.4 |
| low part. 10% | 300/500 | 201.2 | 200.3 | 196.0 | 195.1 | 199.5-201.7 | 195.1-200.0 | 21.6 | 26.2 | 195.8 / 196.6 |
| low part. 10% | 1000/1000 | 207.5 | 209.9 | 194.9 | 197.3 | 200.0-209.9 | 194.1-200.0 | 60.4 | 53.2 | 205.5 / 207.6 |
| high part. 90% | 200/200 | 212.6 | 215.8 | 190.4 | 193.4 | 200.0-216.2 | 188.9-200.0 | 104.8 | 95.6 | 206.8 / 210.6 |
| high part. 90% | 300/300 | 218.8 | 222.8 | 185.7 | 189.4 | 200.0-223.9 | 183.5-200.0 | 155.5 | 143.2 | 209.1 / 214.7 |
| high part. 90% | 500/300 | 253.8 | 295.0 | 203.6 | 236.1 | 200.0-295.0 | 195.5-242.5 | 297.2 | 166.0 | 323.3 / 335.5 |
| high part. 90% | 300/500 | 200.7 | 181.7 | 162.0 | 147.6 | 176.8-206.5 | 147.6-200.0 | 137.1 | 207.9 | 143.7 / 148.7 |
| high part. 90% | 1000/1000 | 276.8 | 286.6 | 161.6 | 168.8 | 200.0-295.9 | 154.2-200.0 | 542.1 | 486.7 | 247.0 / 270.4 |

What this shows:

- Supply reacts to the game in every scenario. It never explodes and never collapses to zero.
- At 300/300 under a mixed crowd, HEN ends 60 days at 213.6k and EGG at 194.8k (start 200k each). That is a visible move of about 7%.
- A skilled crowd (all sharp) makes supply grow, because sharp players win more than half the rounds: 237.4k HEN at day 60 under 300/300. This is the reward for skill and it stays bounded.
- A momentum crowd shrinks supply: on this series (tie_bps 10) the result flipped from one decisive day to the next in 50 of 80 cases, so yesterday's winner usually lost. At 300/300 HEN ends at 189.5k.
- Raising fry above hatch (300/500) is a sink: an everyone-on-HEN crowd ends the full run at 125.3k HEN, down 37%. Raising hatch above fry (500/300) is an inflator: the same crowd ends at 310.7k HEN, up 55%.
- 1000/1000 moves supply too fast. All-sharp reaches 338.1k HEN at day 60 (+69%) and a 90% participation mixed crowd burns 486.7k coins in 60 days.
- "low part. 10%" at 1000/1000 gives the same numbers as "mixed" at 200/200. The roosted share times the rate is the same, so the two knobs trade off. This is expected, not a bug.

Surprises and notes:

- The coin a crowd never roosts barely moves. With everyone on HEN, EGG supply only grows by scout pay (200.0k to 202.4k at day 60).
- Scout pay is small next to the crowd: 100 coins per winning round, 5.4k coins in total over the 54 winning rounds of the first 60 days, and shared by the honest scouts.

## The scout swarm

20 scripted scouts over the full 107-day series, with the recommended parameters (slash_bps 1000, tolerance_bps 100, min_reveals 3, bond 10 NEAR, min_bond 5 NEAR). "lazy" scouts skip 20% of rounds and seal-but-never-reveal in another 10%. A "liar" reports the chicken price 8% too high. A "ring" reports one shared false number: each round it picks a side at random and moves that price 4% above the last good price and the other 4% below.

| Scenario | HEN | EGG | TIE | VOID | Results that differ from the truth |
|---|---|---|---|---|---|
| a) 14 honest, 3 noisy, 2 lazy, 1 liar | 46 | 47 | 13 | 0 | 0 |
| b) ring of 5 among 20 | 46 | 47 | 13 | 0 | 0 |
| c) ring of 11 among 20 (majority) | 63 | 43 | 0 | 0 | 63 |

(Each row also has 1 baseline round. "Differ" is measured against the result computed from the true prices.)

Per kind, averages per scout: bond left (NEAR), NEAR earned from the pot, coins earned, scouts benched and the first round in which one was benched.

| Scenario | Kind | Bond left | NEAR earned | Coins earned | Benched | First benched |
|---|---|---|---|---|---|---|
| a | honest (14) | 10.000 | 0.870 | 532.2 | 0/14 | - |
| a | noisy (3) | 10.000 | 0.870 | 532.2 | 0/3 | - |
| a | lazy (2) | 4.782 | 0.424 | 125.9 | 2/2 | round 37 |
| a | liar (1) | 4.782 | 0 | 0.0 | 1/1 | round 7 |
| b | honest (11) | 10.000 | 2.608 | 662.7 | 0/11 | - |
| b | noisy (2) | 10.000 | 2.608 | 662.7 | 0/2 | - |
| b | lazy (2) | 4.782 | 1.302 | 342.4 | 2/2 | round 59 |
| b | ring (5) | 4.782 | 0 | 0.0 | 5/5 | round 7 |
| c | honest (6) | 4.782 | 0 | 0.0 | 6/6 | round 7 |
| c | noisy (2) | 4.782 | 0 | 0.0 | 2/2 | round 7 |
| c | lazy (1) | 4.782 | 0 | 0.0 | 1/1 | round 7 |
| c | ring (11) | 10.000 | 4.268 | 963.6 | 0/11 | - |

What this shows:

- With a liar, or a ring of 5 in 20, the result is never wrong. Liars are slashed every round until they are benched at round 7, and the NEAR taken from them is paid to the honest scouts. Noisy scouts (0.5% noise) are never slashed at a 1% tolerance.
- Lazy scouts are benched too (round 37 and 59). A scout that seals and does not reveal loses 10% of its bond each time, so about one in ten rounds is enough to bench it within a hundred rounds. This is intended, but it is the main cost for an unreliable operator.
- **A majority ring corrupts the result.** In scenario (c) the 11 colluding scouts are the middle value, so the 9 honest scouts count as liars, are slashed and are benched by round 7. After that nobody can disagree. 63 of the 107 results differ from the truth, the ring earns the pot and the scout pay, and ties disappear because the ring always forces a winner. This is the documented limit in `RULES.md`: the middle value is only safe while fewer than half of the revealing scouts collude.

How fast a liar is benched depends on `slash_bps` (same scenarios, liar benched / lazy scout first benched): at 2000 bps round 4 / round 19; at 1000 bps round 7 / round 37; at 500 bps round 14 / round 73 (only one of two lazy scouts benched by round 107).

## Recommended parameters

| Parameter | Value | Reason |
|---|---|---|
| hatch_bps | 300 | A winner gains 3% per round, enough to see supply move in 60 days (about +7% HEN under a mixed crowd) without compounding out of control. |
| fry_bps | 300 | Equal to hatch, so a random crowd stays near its starting supply. 300/500 shrinks supply 37% and 500/300 grows it 55% over the full run for an everyone-on-one-side crowd. |
| tie_bps | 10 | On the real series this gives 46 HEN, 47 EGG, 13 TIE: about one tie in eight, and it is well above the 0.01% rounding of the whole-number prices. |
| scout_pay | 100 coins per winning round | About 0.05% of the 200k starting supply per round, shared by the honest scouts. It pays scouts without being a visible inflation source. |
| slash_bps | 1000 | A liar is benched after 7 rounds. 20% benches a mildly unreliable scout too fast, 5% lets a liar distort 14 rounds. |
| tolerance_bps | 100 | Noisy scouts (0.5%) pass; the 8% liar and the 4% ring fail by a wide margin. |
| min_reveals | 3 | Smallest number where a middle value means something. A higher number would void rounds while we run only a few scouts at launch. Raise it as scouts join. |
| min_bond | half of scout_bond (5 NEAR for a 10 NEAR bond) | A scout can take 7 slashes before it is benched, which is enough room for an honest outage and not enough for a long attack. |

Not decided by the simulation: `scout_bond` in NEAR (see the majority-ring limit above: the cost of an attack is about (N/2 + 1) bonds), `starter_*`, `max_scouts` and the phase lengths. The runs use bond 10 NEAR, starter pack 1,000 + 1,000 coins, fee 0.1 NEAR, storage 0.0025 NEAR and max 32 scouts as placeholders.

## Interpretation notes

The rules are silent in a few places. The engine reads them as follows, and the contract has to match.

1. Void rounds slash only scouts that sealed and did not reveal. Revealed scouts are not judged and no pot is paid.
2. Tie and baseline rounds still run the honest check, slashing and pot payment. Only the scout coin pay (needs a winning coin) is skipped.
3. A scout is benched if its bond is below `min_bond` when the round settles. A slash in this round can bench it from the next round on.
4. The pot also includes slashes from the same settle, so a slashed scout's NEAR can be paid out in the same round.
5. A report with a price of zero is rejected (the engine throws).

## Reproduce every number

Use Node 24 or newer. No packages to install.

```
npm run sim:data     # rebuilds sim/data/daily-index.json
npm run sim:supply   # real-series table, both supply tables, writes sim/out/supply.json
npm run sim:swarm    # swarm tables, writes sim/out/swarm.json
node sim/run-swarm.mjs --slash 2000   # slash_bps sensitivity (also 500, 1000); no file written
npm test             # 15 engine tests
```
