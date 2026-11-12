# The two tracks

One game, entered in two tracks. `memecoins` is the main one. The line-by-line check of both starter prompts is in [`REQUIREMENTS.md`](REQUIREMENTS.md).

## `memecoins`: Memecoins With Mechanics

The track asks for memecoins "where the meme does something: supply that reacts to the community, treasuries with rules, onchain rituals and challenges", and says the judges score the mechanic and not the price chart.

- **The meme.** The oldest argument there is: which came first, the chicken or the egg? Two coins, two camps, `$HEN` and `$EGG`.
- **What the meme does.** Every round, real shop prices of chicken and eggs settle the argument for that day. Whichever price rose more came first. The winning camp's roosted coins grow by 3% and the losing camp's shrink by 3%.
- **Supply that reacts to the community.** How much is minted and burned depends on how many coins people put on each side. A crowd that guesses well grows the supply, a crowd that chases yesterday's winner shrinks it. `SIMULATION.md` shows this for six kinds of crowd.
- **The ritual.** Pick a side before the scouts go shopping. The contract keeps each player's current and longest winning streak, and how many rounds in a row the same side has won.
- **Rules instead of a team.** Both coins started at zero supply. There is no team allocation and no admin key, and the contract accounts have no access keys at all.
- **No price chart.** The mechanic never reads the market price of either coin. It reads only what chicken and eggs cost in the shop.

## `swarms`: AI Swarms

The track asks for "coordination markets, bidding ... and economies that emerge between agents", built on sub-accounts.

- **Many agents, one contract.** Seven scout agents, each its own sub-account with its own bond. Only the coop contract coordinates them. No server sits between the scouts and no scout is trusted.
- **Sealed reports.** Scouts first send a hash, then open it. A scout cannot copy the others.
- **A small economy between the agents.** Honest scouts earn the winning coin every round. A scout that lies, or seals a report and never opens it, loses 10% of its bond, and that NEAR is paid to the honest scouts of the round. A scout that keeps lying runs out of bond and is benched.
- **It happened on testnet.** `scout-7` is a scripted liar. The swarm outvoted it in seven rounds, the contract slashed it seven times and then stopped taking its reports. When a public RPC node failed during round 11, six scouts could not open their sealed reports and the contract slashed all six, exactly as the rules say.
- **The swarm decides something that matters.** The scouts' middle value is what mints and burns the two coins. The two tracks are one system, not two demos.

What we do not claim: the scouts are scripted programs with no LLM calls, the game does not use NEAR Intents, and a majority of scouts that agree on a wrong price would win. The README states these limits.
