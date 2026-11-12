# daily-index.json

A chained, same-product price index for chicken and eggs in Kochi, India, one row per day
(27 Jul 2026 to 10 Nov 2026). Aggregate only: no raw shop rows are included.

- `hen`: chicken, paise per kg. Day 0 is `round(median price * 100)`.
- `egg`: eggs, paise per dozen. Day 0 is `round(median price per egg * 12 * 100)`.
- Every later day is the previous day's unrounded level times `(1 + move / 100)`, stored rounded.
- `hen_move_pct`, `egg_move_pct`: that day's same-product move in percent (null on day 0).

Rebuild with `node sim/build-data.mjs`.

## source-index.json

The input of the build script: one row per day with the median shelf price (`ck_med` rupees per kg of
chicken, `eg_med` rupees per egg), how many products were matched (`n_ck`, `n_eg`), and the same-product
move in percent against the day before (`rc` chicken, `re` eggs). It was computed from our own price
archive of three grocery delivery apps in Kochi. The archive itself is not published; this file holds
daily aggregates only.
