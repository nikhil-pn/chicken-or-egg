//! Whole-number arithmetic from the "Exact arithmetic" section of RULES.md.
//!
//! Pure functions, no chain access, so they are easy to test and easy to
//! compare with the JavaScript model in `sim/`.

use crate::BPS;

/// Middle value of the reports. Even counts take the two middle ones, rounded down.
pub fn median(values: &[u128]) -> u128 {
    let mut sorted = values.to_vec();
    sorted.sort_unstable();
    let n = sorted.len();
    assert!(n > 0, "median of nothing");
    if n % 2 == 1 { sorted[n / 2] } else { (sorted[n / 2 - 1] + sorted[n / 2]) / 2 }
}

/// `|price - middle| * 10000 <= tolerance_bps * middle`
pub fn within_tolerance(price: u128, middle: u128, tolerance_bps: u32) -> bool {
    price.abs_diff(middle) * BPS <= tolerance_bps as u128 * middle
}

/// Price change in parts per million, rounded toward zero. Negative when it fell.
pub fn move_ppm(now: u128, last: u128) -> i64 {
    let ppm = (now as i128 - last as i128) * 1_000_000 / last as i128;
    ppm as i64
}

/// A tie is `|hen_move - egg_move| < tie_bps * 100`.
pub fn is_tie(hen_move: i64, egg_move: i64, tie_bps: u32) -> bool {
    (hen_move as i128 - egg_move as i128).abs() < tie_bps as i128 * 100
}

/// `amount * bps / 10000`, rounded down.
pub fn share(amount: u128, bps: u32) -> u128 {
    amount * bps as u128 / BPS
}

/// A winning roost after the hatch: `a * (10000 + hatch_bps) / 10000`, rounded down.
pub fn hatched(amount: u128, hatch_bps: u32) -> u128 {
    amount * (BPS + hatch_bps as u128) / BPS
}

/// A losing roost after the fry: `a * (10000 - fry_bps) / 10000`, rounded down.
pub fn fried(amount: u128, fry_bps: u32) -> u128 {
    amount * (BPS - fry_bps as u128) / BPS
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn median_of_odd_and_even_counts() {
        assert_eq!(median(&[5]), 5);
        assert_eq!(median(&[9, 1, 5]), 5);
        assert_eq!(median(&[1, 2, 3, 10]), 2); // (2 + 3) / 2 rounds down
        assert_eq!(median(&[42_000, 42_100, 41_900, 90_000, 42_050]), 42_050);
    }

    #[test]
    fn tolerance_is_inclusive_at_the_edge() {
        // 2% of 10000 is 200.
        assert!(within_tolerance(10_200, 10_000, 200));
        assert!(within_tolerance(9_800, 10_000, 200));
        assert!(!within_tolerance(10_201, 10_000, 200));
        assert!(!within_tolerance(9_799, 10_000, 200));
    }

    #[test]
    fn moves_round_toward_zero() {
        assert_eq!(move_ppm(42_000, 42_000), 0);
        assert_eq!(move_ppm(42_100, 42_000), 2_380); // 2380.95 -> 2380
        assert_eq!(move_ppm(41_900, 42_000), -2_380); // -2380.95 -> -2380, not -2381
        assert_eq!(move_ppm(2, 3), -333_333);
    }

    #[test]
    fn tie_threshold_is_strict() {
        // tie_bps = 5 means the gap must be at least 500 ppm to count as a win.
        assert!(is_tie(1_000, 1_499, 5));
        assert!(!is_tie(1_000, 1_500, 5));
        assert!(is_tie(-200, 200, 5));
        assert!(!is_tie(-300, 200, 5));
    }

    #[test]
    fn rounding_always_favours_the_coop() {
        // Three roosts of 333 on the winning side, hatch 3%.
        let each = hatched(333, 300); // 342.99 -> 342
        assert_eq!(each, 342);
        let minted = share(999, 300); // 29.97 -> 29
        assert!(3 * each <= 999 + minted);
        // Three roosts of 333 on the losing side, fry 3%.
        let each = fried(333, 300); // 323.01 -> 323
        assert_eq!(each, 323);
        let burned = share(999, 300);
        assert!(3 * each <= 999 - burned);
    }
}
