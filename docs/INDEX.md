# The price index

The game asks one question a day: did chicken or eggs rise more? This page says where the two numbers come from.

## What the scouts report

Each scout reports two whole numbers per round:

- `hen`: the chicken index, in paise per kg (100 paise = 1 Indian rupee).
- `egg`: the egg index, in paise per dozen.

The contract never compares chicken with eggs directly. It compares each number with **its own value in the last round**, so only the two moves matter. The currency and the unit drop out.

## Where the prices come from

Real shelf prices from three grocery delivery apps in Kochi, India. We have recorded them several times a day since July 2026 with our own price tracker, which existed before the hackathon (see "What is old and what is new" below).

- Chicken: curry-cut chicken packs, price per kg. Between 23 and 46 products a day, 38 on a typical day.
- Eggs: egg packs, price per egg. Between 26 and 54 products a day, 40 on a typical day.

## How one day becomes one number

1. For every product, take the middle (median) of that day's in-stock readings.
2. Keep only the products that were on sale on both days, today and yesterday.
3. For each of those, divide today's price by yesterday's.
4. The day's move is the geometric mean of those ratios, minus one.

This is a matched-basket index (statisticians call it a Jevons index). A product that appears or goes out of stock cannot move the index, because it is not in both days. On a typical day 36 chicken products and 38 egg products are matched.

The published series starts from the median shop price on day one (380 rupees per kg of chicken, 11.33 rupees per egg) and applies each day's move in turn. `sim/build-data.mjs` does this and writes `sim/data/daily-index.json`.

## What is published

Daily aggregates only: `sim/data/source-index.json` (medians, product counts, daily moves) and `sim/data/daily-index.json` (the two index numbers per day). The raw archive of shop prices is not in this repository.

107 days are recorded, 27 Jul to 10 Nov 2026. Under the game's rules they give 46 days for the hen, 47 for the egg and 13 ties.

## What is old and what is new

- **Old (before the hackathon):** the price tracker that reads the three apps, and its archive. It is not in this repository.
- **New (built for the hackathon):** the index method above, both data files, the contracts, the scouts, the simulation, the page.

## Limits

- One city and three shops. This is a real series, not a national statistic.
- In the testnet replay the scouts read the recorded series, each through its own scripted error model, so a judge can check every round against `sim/data/daily-index.json`.
- A scout that reports a number far from the middle of all reports loses part of its bond. That punishes outliers. It cannot stop a majority of scouts that agree on a wrong number. `RULES.md` states this limit.
