//! Read-only views for the live page. Lists are paged so a call never runs out of gas.

use crate::*;

/// Most entries one call returns.
const PAGE: u32 = 100;

/// Totals since round 1.
#[near(serializers = [json])]
pub struct StatsView {
    pub stats: Stats,
    /// Coins minted minus coins burned. Equal to `ft_total_supply` on each coin.
    pub hen_supply: U128,
    pub egg_supply: U128,
    pub rounds_settled: u32,
    pub ledger_entries: u32,
    pub pot: NearToken,
}

#[near]
impl Coop {
    pub fn get_stats(&self) -> StatsView {
        let stats = self.stats.clone();
        StatsView {
            hen_supply: U128(stats.minted_hen.0.saturating_sub(stats.burned_hen.0)),
            egg_supply: U128(stats.minted_egg.0.saturating_sub(stats.burned_egg.0)),
            rounds_settled: self.history.len(),
            ledger_entries: self.ledger.len(),
            pot: NearToken::from_yoctonear(self.pot),
            stats,
        }
    }

    /// Settled rounds, oldest first. Round `n` is at index `n - 1`.
    pub fn get_history(&self, from: Option<u32>, limit: Option<u32>) -> Vec<RoundResult> {
        page(self.history.len(), from, limit).filter_map(|i| self.history.get(i).cloned()).collect()
    }

    /// Every mint and burn the coop has made, oldest first.
    pub fn get_ledger(&self, from: Option<u32>, limit: Option<u32>) -> Vec<LogEntry> {
        page(self.ledger.len(), from, limit).filter_map(|i| self.ledger.get(i).cloned()).collect()
    }
}

/// Indexes `from .. from + limit`, cut at `len` and at one page.
fn page(len: u32, from: Option<u32>, limit: Option<u32>) -> std::ops::Range<u32> {
    let start = from.unwrap_or(0).min(len);
    let count = limit.unwrap_or(PAGE).min(PAGE);
    start..start.saturating_add(count).min(len)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::*;

    #[test]
    fn history_and_ledger_are_paged() {
        let mut coop = coop_with_scouts();
        play_round(&mut coop, 0, &all(38_000, 13_596));
        coop.round.hen_roosted = 1000 * COIN;
        coop.round.egg_roosted = 500 * COIN;
        play_round(&mut coop, 120, &all(38_380, 13_596));
        let stats = coop.get_stats();
        assert_eq!((stats.rounds_settled, stats.ledger_entries), (2, 3));
        assert_eq!(coop.get_history(None, None).len(), 2);
        let last = coop.get_history(Some(1), Some(5));
        assert_eq!((last.len(), last[0].id, last[0].outcome), (1, 2, Outcome::Hen));
        assert_eq!(coop.get_ledger(Some(0), Some(2)).len(), 2);
        assert!(coop.get_ledger(Some(9), None).is_empty());
    }

    #[test]
    fn supply_is_what_was_minted_less_what_was_burned() {
        let mut coop = coop_with_scouts();
        play_round(&mut coop, 0, &all(38_000, 13_596));
        coop.round.hen_roosted = 1000 * COIN;
        coop.round.egg_roosted = 500 * COIN;
        coop.stats.minted_egg = U128(500 * COIN); // the eggs that are roosted exist
        play_round(&mut coop, 120, &all(38_380, 13_596));
        let stats = coop.get_stats();
        assert_eq!(stats.hen_supply.0, 30 * COIN + 3 * (100 * COIN / 3));
        assert_eq!(stats.egg_supply.0, 485 * COIN);
    }
}
