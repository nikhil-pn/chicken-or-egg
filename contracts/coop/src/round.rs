//! The clock of a round: ROOST, then COMMIT, then REVEAL, then waiting for `settle`.
//!
//! NEAR has no timers. The phase is worked out from the block time each time
//! somebody calls the coop, and a round ends only when `settle` is called.

use crate::*;

const NS_PER_SEC: u64 = 1_000_000_000;

#[near(serializers = [json])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Phase {
    /// Players lock coins. Scouts wait.
    Roost,
    /// Roosting is closed. Scouts read the prices and send sealed reports.
    Commit,
    /// Scouts open their reports.
    Reveal,
    /// All three phases are over. Anyone may call `settle`.
    Settle,
}

/// What the page shows about the open round.
#[near(serializers = [json])]
pub struct RoundView {
    pub id: u64,
    pub phase: Phase,
    /// Seconds until the phase ends. Zero while waiting for `settle`.
    pub seconds_left: u64,
    pub opened_at: u64,
    pub hen_roosted: U128,
    pub egg_roosted: U128,
    pub commits: u32,
    pub reveals: u32,
    pub scouts: u32,
    pub pot: NearToken,
    /// Middle prices of the last good round, the ones this round is compared with.
    pub last_hen_price: Option<U128>,
    pub last_egg_price: Option<U128>,
}

impl Coop {
    /// Phase at block time `now`, and the seconds left in it (rounded up).
    pub(crate) fn phase_at(&self, now: u64) -> (Phase, u64) {
        let c = &self.config;
        let elapsed = now.saturating_sub(self.round.opened_at);
        let roost_end = c.roost_secs as u64 * NS_PER_SEC;
        let commit_end = roost_end + c.commit_secs as u64 * NS_PER_SEC;
        let reveal_end = commit_end + c.reveal_secs as u64 * NS_PER_SEC;
        let left = |end: u64| (end - elapsed).div_ceil(NS_PER_SEC);
        if elapsed < roost_end {
            (Phase::Roost, left(roost_end))
        } else if elapsed < commit_end {
            (Phase::Commit, left(commit_end))
        } else if elapsed < reveal_end {
            (Phase::Reveal, left(reveal_end))
        } else {
            (Phase::Settle, 0)
        }
    }

    pub(crate) fn phase(&self) -> Phase {
        self.phase_at(env::block_timestamp()).0
    }
}

#[near]
impl Coop {
    /// The open round: phase, time left, coins roosted on each side.
    pub fn get_round(&self) -> RoundView {
        let (phase, seconds_left) = self.phase_at(env::block_timestamp());
        RoundView {
            id: self.round.id,
            phase,
            seconds_left,
            opened_at: self.round.opened_at,
            hen_roosted: U128(self.round.hen_roosted),
            egg_roosted: U128(self.round.egg_roosted),
            commits: self.round.commits,
            reveals: self.round.reveals,
            scouts: self.scouts.len(),
            pot: NearToken::from_yoctonear(self.pot),
            last_hen_price: self.last_prices.map(|p| U128(p.0)),
            last_egg_price: self.last_prices.map(|p| U128(p.1)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::*;

    #[test]
    fn phases_follow_the_block_time() {
        let coop = new_coop(); // 60 s roost, 30 s commit, 30 s reveal
        let at = |secs: u64| {
            ctx("anyone.test", ZERO, secs);
            let r = coop.get_round();
            (r.phase, r.seconds_left)
        };
        assert_eq!(at(0), (Phase::Roost, 60));
        assert_eq!(at(59), (Phase::Roost, 1));
        assert_eq!(at(60), (Phase::Commit, 30));
        assert_eq!(at(89), (Phase::Commit, 1));
        assert_eq!(at(90), (Phase::Reveal, 30));
        assert_eq!(at(119), (Phase::Reveal, 1));
        assert_eq!(at(120), (Phase::Settle, 0));
        assert_eq!(at(100_000), (Phase::Settle, 0));
    }

    #[test]
    fn a_new_coop_opens_round_one_with_nothing_in_it() {
        let coop = new_coop();
        let r = coop.get_round();
        assert_eq!(r.id, 1);
        assert_eq!(r.opened_at, T0);
        assert_eq!((r.hen_roosted.0, r.egg_roosted.0, r.commits, r.reveals, r.scouts), (0, 0, 0, 0, 0));
        assert!(r.last_hen_price.is_none() && r.last_egg_price.is_none());
    }
}
