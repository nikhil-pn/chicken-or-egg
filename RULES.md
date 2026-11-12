# The rules of Chicken or Egg

Written before the contracts. If the code and this file ever disagree, that is a bug in the code.

## The game in four lines

1. There are two coins, **$HEN** and **$EGG**. Every round asks one question: *which came first?*
2. Before the round closes, you **roost**: lock some $HEN or some $EGG in the coop.
3. Scout agents report the real price of chicken and of eggs. Whichever price **rose more** since the last round came first.
4. Winners **hatch** (their roosted coins grow). Losers get **fried** (a share of their roosted coins burns). A tie changes nothing.

Coins you do not roost are never touched.

## Words

| Word | Meaning |
|---|---|
| Coop | The coordinator contract. It runs the rounds and is the only account allowed to mint or burn either coin. |
| Roost | Lock coins on your side for the current round. |
| Hatch | The mint that winners receive. |
| Fry | The burn that losers take. |
| Scout | An agent with its own NEAR account that reports prices. |
| Bond | NEAR locked for a scout. Part of it is taken when the scout lies or goes silent. |
| Pot | NEAR taken from bad scouts and from starter-pack fees. It is paid to honest scouts. |

## One round

A round has three timed phases, then anyone may settle it.

```
Player            Scout (x N)            Coop contract                 HEN / EGG token
  |                   |                        |                              |
  |== ROOST phase =============================|                              |
  |-- ft_transfer_call(coop, amount, "roost") ------------------------------->|
  |                   |                        |<-- ft_on_transfer(player) ---|
  |                   |                        |  record roost (side, amount) |
  |                   |                        |                              |
  |== COMMIT phase (roosting is closed) =======|                              |
  |                   |  read the shop prices  |                              |
  |                   |-- commit(sha256) ----->|  store sealed report         |
  |                   |                        |                              |
  |== REVEAL phase ============================|                              |
  |                   |-- reveal(hen, egg, salt) ->|  check against the seal  |
  |                   |                        |                              |
  |== after the reveal phase: anyone ==========|                              |
  |-- settle() ------------------------------->|  middle value of each price  |
  |                   |                        |  pay honest scouts, slash bad|
  |                   |                        |  decide HEN / EGG / TIE      |
  |                   |                        |-- mint(coop, hatch + pay) -->|  winner coin
  |                   |                        |-- burn(fry) ---------------->|  loser coin
  |                   |                        |  open the next round         |
  |-- claim() -------------------------------->|-- ft_transfer(player) ------>|
```

**Why roosting closes before scouts look.** Shop prices are public. If you could roost after the prices
were visible you would always pick the winner. So the roost phase ends first, and scouts read prices only
in the commit phase. You are calling the *next* price move, not reading the current one.

**Why reports are sealed.** A scout that could see the others' numbers would just copy them. Each scout
first sends `sha256("<hen>:<egg>:<salt>:<scout account>")`, and shows the numbers only after every seal is in.

## How the winner is decided

For each price the coop takes the **middle value** (median) of the revealed reports.
With an even number of reports it is the average of the two middle values.

```
hen_move = (hen_now - hen_last) * 10000 / hen_last      (basis points, can be negative)
egg_move = (egg_now - egg_last) * 10000 / egg_last

|hen_move - egg_move| <  tie_bps   ->  TIE
hen_move > egg_move                ->  HEN came first
otherwise                          ->  EGG came first
```

Only the *change* matters, so the currency and the pack size cancel out. Scouts report whole numbers
(price per kilogram of chicken and price per dozen eggs, in the smallest currency unit).

Special rounds:

- **Baseline**: the first round with prices has nothing to compare against. It records the prices; nobody wins or loses.
- **Void**: fewer than `min_reveals` scouts revealed. Nothing is minted or burned; roosts come back untouched; the last good prices stay.

## What happens to the coins

| Result | Your roost on the winning side | Your roost on the losing side | Honest scouts |
|---|---|---|---|
| HEN or EGG wins | grows by `hatch_bps` (new mint) | shrinks by `fry_bps` (burned) | share `scout_pay` of the winning coin (new mint) |
| Tie, baseline, void | unchanged | unchanged | nothing minted |

After a round settles, `claim()` sends your roost (grown, shrunk or unchanged) back to your wallet.
Roosting again also collects any earlier roost for you.

Both coins start with a **supply of zero**. There is no team allocation and no presale. Coins exist only through:

- the **starter pack**: once per account, `starter_hen` + `starter_egg`, for a fee of `starter_fee` NEAR, until `starter_cap` packs are gone;
- **hatches** and **scout pay**.

Coins leave only by being **fried**.

## Scouts

- **Anyone may add a scout**: `register_scout(scout_id)` with at least `scout_bond` NEAR attached. The payer is recorded as the scout's funder. At most `max_scouts` scouts.
- A scout account needs only a **function-call key** that may call `commit`, `reveal` and `settle` on the coop and nothing else. That key cannot move money. If it leaks, the worst outcome is that the scout's own bond is slashed.
- A scout is **honest** in a round when both of its prices are within `tolerance_bps` of the middle values.
- A scout is **slashed** `slash_bps` of its bond when it reveals a price outside the tolerance, or seals a report and never reveals it.
- Slashed NEAR goes to the **pot**. When a round settles with at least one honest scout, the whole pot is split equally between that round's honest scouts.
- A scout whose bond has fallen below `min_bond` is **benched**: it cannot commit until someone tops it up with `top_up_scout`.
- The funder may `retire_scout` during a roost phase and receives the remaining bond plus the scout's unpaid earnings.

All scouts compute the **same published index** from the same public shop shelves (see `docs/INDEX.md`), so honest scouts land close together. A scout far from the middle is wrong or lying.

## Exact arithmetic

The contract and the simulation in `sim/` follow the same whole-number rules, so they give identical results.

- Prices are whole numbers. Coin amounts and NEAR amounts are whole numbers of their smallest unit.
- **Middle value**: sort the revealed prices; odd count takes the middle one; even count takes `(a + b) / 2` of the two middle ones, rounded down.
- **Honest**: `|price - middle| * 10000 <= tolerance_bps * middle`, for the hen price and for the egg price.
- **Move**: `(now - last) * 1000000 / last`, in parts per million, rounded toward zero. A tie is `|hen_move - egg_move| < tie_bps * 100`.
- **Hatch**: a winning roost `a` becomes `a * (10000 + hatch_bps) / 10000`, rounded down. The coop mints `side_total * hatch_bps / 10000`, rounded down.
- **Fry**: a losing roost `a` becomes `a * (10000 - fry_bps) / 10000`, rounded down. The coop burns `side_total * fry_bps / 10000`, rounded down.
- **Scout pay**: each honest scout gets `scout_pay / honest_count`, rounded down. The coop mints exactly that times `honest_count`.
- **Slash**: `bond * slash_bps / 10000`, rounded down, moved from the bond to the pot.
- **Pot**: each honest scout gets `pot / honest_count`, rounded down. The remainder stays in the pot.
- Rounding always favours the coop, so it can never owe more coins than it holds. The leftover dust stays in the coop for good.

Order inside `settle`: count reveals, find the middle values, mark honest scouts, slash, pay the pot, decide the result, mint and burn, open the next round.

## Parameters

Every number below is fixed when the coop is created and can be read with `get_config()`. There is no method that changes them, and the contract accounts keep no access keys after launch.

| Name | Meaning |
|---|---|
| `roost_secs`, `commit_secs`, `reveal_secs` | length of the three phases |
| `hatch_bps` | growth of a winning roost |
| `fry_bps` | burn of a losing roost |
| `tie_bps` | smallest gap between the two moves that counts as a win |
| `scout_pay` | winning coins shared by honest scouts per round |
| `scout_bond`, `min_bond`, `slash_bps` | bond needed to join, bond needed to keep reporting, share taken per offence |
| `tolerance_bps` | how far from the middle value still counts as honest |
| `min_reveals`, `max_scouts` | fewest reveals for a valid round, most scouts allowed |
| `starter_hen`, `starter_egg`, `starter_fee`, `starter_cap` | the starter pack |

The values are chosen from the supply simulation in `sim/` and recorded in the README.

## Limits, stated plainly

- **Scout majority.** The middle value is safe only while fewer than half of the revealing scouts collude. Joining needs only a bond, so the cost of an attack is about `(N/2 + 1) x scout_bond`. For real money the bond must be far larger than what a round can move.
- **We run the first scouts.** At launch they run on our machine. Registration is open, but until others join the result rests on us reading the shelves honestly.
- **Sybil accounts.** Hatches and fries are proportional to the coins roosted, so splitting coins across many accounts gains nothing. The starter pack is per account: one person with many accounts can take many packs, limited only by the fee and the cap.
- **Shop prices are sticky.** Someone who watches the shelves closely will guess better than a coin flip. That is the game.
- **No timer on NEAR.** A round moves on only when somebody calls `settle`. Scouts are allowed to, and so is anyone else.
