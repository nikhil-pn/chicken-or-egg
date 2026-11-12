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

## Licence

MIT. See `LICENSE`.
