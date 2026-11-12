//! Settling a round: the one place where coins are created or destroyed.
//!
//! Order, the same as in RULES.md and in the simulation:
//! count the reports, take the middle prices, mark the honest scouts, slash
//! the rest, share the pot, decide the result, mint and burn, open the next round.

use crate::coin::{COIN_CALL_GAS, emit, ext_coin};
use crate::round::Phase;
use crate::*;

#[near]
impl Coop {
    /// Closes the open round and opens the next one. Anyone may call it once
    /// the reveal phase is over. It takes no arguments, so the caller cannot
    /// influence the result.
    pub fn settle(&mut self) -> RoundResult {
        require!(self.phase() == Phase::Settle, "The reveal phase is not over yet");
        let now = env::block_timestamp();
        let id = self.round.id;
        let tolerance = self.config.tolerance_bps;

        // Scouts that opened a report, and scouts that sealed one and went silent.
        let mut revealed: Vec<(AccountId, u128, u128)> = Vec::new();
        let mut silent: Vec<AccountId> = Vec::new();
        for (scout_id, scout) in self.scouts.iter() {
            if let Some((_, hen, egg)) = scout.report.filter(|report| report.0 == id) {
                revealed.push((scout_id.clone(), hen, egg));
            } else if matches!(scout.seal, Some((round, _)) if round == id) {
                silent.push(scout_id.clone());
            }
        }

        let mut result = RoundResult {
            id,
            opened_at: self.round.opened_at,
            settled_at: now,
            outcome: Outcome::Void,
            hen_price: U128(0),
            egg_price: U128(0),
            hen_move_ppm: 0,
            egg_move_ppm: 0,
            hen_roosted: U128(self.round.hen_roosted),
            egg_roosted: U128(self.round.egg_roosted),
            minted_hen: U128(0),
            minted_egg: U128(0),
            burned_hen: U128(0),
            burned_egg: U128(0),
            reveals: revealed.len() as u32,
            honest: 0,
            slashed: Vec::new(),
            pot_paid: NearToken::from_yoctonear(0),
            settled_by: env::predecessor_account_id(),
        };

        // With too few reports the round is void and nobody is judged.
        let mut honest: Vec<AccountId> = Vec::new();
        let mut middle: Option<(u128, u128)> = None;
        if revealed.len() as u32 >= self.config.min_reveals {
            let hen_mid = math::median(&revealed.iter().map(|r| r.1).collect::<Vec<_>>());
            let egg_mid = math::median(&revealed.iter().map(|r| r.2).collect::<Vec<_>>());
            for (scout_id, hen, egg) in &revealed {
                let close = math::within_tolerance(*hen, hen_mid, tolerance)
                    && math::within_tolerance(*egg, egg_mid, tolerance);
                if close {
                    self.scouts.get_mut(scout_id).unwrap().honest_rounds += 1;
                    honest.push(scout_id.clone());
                } else {
                    self.slash(scout_id, &mut result.slashed);
                }
            }
            middle = Some((hen_mid, egg_mid));
        }
        // Sealing a report and not opening it is slashed in every kind of round.
        for scout_id in &silent {
            self.slash(scout_id, &mut result.slashed);
        }

        if let Some((hen_mid, egg_mid)) = middle {
            result.hen_price = U128(hen_mid);
            result.egg_price = U128(egg_mid);
            result.honest = honest.len() as u32;
            // The pot, with the slashes just made, goes to the honest scouts.
            if !honest.is_empty() {
                let each = self.pot / honest.len() as u128;
                for scout_id in &honest {
                    self.scouts.get_mut(scout_id).unwrap().earned_near += each;
                }
                let paid = each * honest.len() as u128;
                self.pot -= paid;
                result.pot_paid = NearToken::from_yoctonear(paid);
            }
            result.outcome = match self.last_prices {
                None => Outcome::Baseline,
                Some((last_hen, last_egg)) => {
                    result.hen_move_ppm = math::move_ppm(hen_mid, last_hen);
                    result.egg_move_ppm = math::move_ppm(egg_mid, last_egg);
                    if math::is_tie(result.hen_move_ppm, result.egg_move_ppm, self.config.tie_bps) {
                        Outcome::Tie
                    } else if result.hen_move_ppm > result.egg_move_ppm {
                        Outcome::Hen
                    } else {
                        Outcome::Egg
                    }
                }
            };
            self.last_prices = Some((hen_mid, egg_mid));
        }

        match result.outcome {
            Outcome::Hen => self.hatch_and_fry(Side::Hen, &honest, &mut result),
            Outcome::Egg => self.hatch_and_fry(Side::Egg, &honest, &mut result),
            Outcome::Tie => self.stats.ties += 1,
            Outcome::Void => self.stats.voids += 1,
            Outcome::Baseline => {}
        }

        self.history.push(result.clone());
        self.round =
            Round { id: id + 1, opened_at: now, hen_roosted: 0, egg_roosted: 0, commits: 0, reveals: 0 };
        emit("round_settled", &result);
        result
    }
}

impl Coop {
    /// Moves `slash_bps` of a scout's bond into the pot.
    fn slash(&mut self, scout_id: &AccountId, slashed: &mut Vec<AccountId>) {
        let slash_bps = self.config.slash_bps;
        let scout = self.scouts.get_mut(scout_id).unwrap();
        let cut = math::share(scout.bond, slash_bps);
        scout.bond -= cut;
        scout.slashed_rounds += 1;
        self.pot += cut;
        slashed.push(scout_id.clone());
    }

    /// A coin won: mint the hatch and the scout pay in it, burn the fry in the other.
    ///
    /// The roosts themselves are not touched here. Each player's roost is worked
    /// out from the round result when that player next roosts or claims, so the
    /// cost of `settle` does not grow with the number of players.
    fn hatch_and_fry(&mut self, winner: Side, honest: &[AccountId], result: &mut RoundResult) {
        let loser = winner.other();
        let (id, now) = (result.id, result.settled_at);
        let (won, lost) = match winner {
            Side::Hen => (self.round.hen_roosted, self.round.egg_roosted),
            Side::Egg => (self.round.egg_roosted, self.round.hen_roosted),
        };
        let hatch = math::share(won, self.config.hatch_bps);
        let fry = math::share(lost, self.config.fry_bps);

        let pay_each =
            if honest.is_empty() { 0 } else { self.config.scout_pay.0 / honest.len() as u128 };
        for scout_id in honest {
            let scout = self.scouts.get_mut(scout_id).unwrap();
            match winner {
                Side::Hen => scout.earned_hen += pay_each,
                Side::Egg => scout.earned_egg += pay_each,
            }
        }
        let pay = pay_each * honest.len() as u128;
        let minted = hatch + pay;

        for (kind, coin, amount) in
            [(LogKind::Hatch, winner, hatch), (LogKind::ScoutPay, winner, pay), (LogKind::Fry, loser, fry)]
        {
            if amount > 0 {
                self.ledger.push(LogEntry { round: id, kind, coin, amount: U128(amount), account: None, at: now });
            }
        }

        let stats = &mut self.stats;
        match winner {
            Side::Hen => {
                stats.hen_wins += 1;
                stats.minted_hen.0 += minted;
                stats.burned_egg.0 += fry;
                result.minted_hen = U128(minted);
                result.burned_egg = U128(fry);
            }
            Side::Egg => {
                stats.egg_wins += 1;
                stats.minted_egg.0 += minted;
                stats.burned_hen.0 += fry;
                result.minted_egg = U128(minted);
                result.burned_hen = U128(fry);
            }
        }
        // The streak counts rounds won in a row by one side. Ties and void rounds do not break it.
        if stats.streak_side == Some(winner) {
            stats.streak += 1;
        } else {
            stats.streak_side = Some(winner);
            stats.streak = 1;
        }
        stats.best_streak = stats.best_streak.max(stats.streak);

        if minted > 0 {
            ext_coin::ext(self.token(winner))
                .with_static_gas(COIN_CALL_GAS)
                .mint(env::current_account_id(), U128(minted), Some(format!("round {id}: hatch and scout pay")))
                .detach();
        }
        if fry > 0 {
            ext_coin::ext(self.token(loser))
                .with_static_gas(COIN_CALL_GAS)
                .burn(U128(fry), Some(format!("round {id}: fry")))
                .detach();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::*;

    const S: [&str; 3] = ["scout-1.test", "scout-2.test", "scout-3.test"];
    const LIAR: &str = "liar.test";

    fn coop_with_scouts() -> Coop {
        let mut coop = new_coop();
        for scout in S {
            add_scout(&mut coop, scout);
        }
        coop
    }

    /// The same prices from the three honest scouts.
    fn all(hen: u128, egg: u128) -> Vec<(&'static str, u128, u128)> {
        S.iter().map(|scout| (*scout, hen, egg)).collect()
    }

    #[test]
    fn the_first_round_is_a_baseline() {
        let mut coop = coop_with_scouts();
        let result = play_round(&mut coop, 0, &all(38_000, 13_596));
        assert_eq!(result.outcome, Outcome::Baseline);
        assert_eq!((result.reveals, result.honest), (3, 3));
        assert_eq!((result.minted_hen.0, result.minted_egg.0), (0, 0));
        let round = coop.get_round();
        assert_eq!((round.id, round.opened_at), (2, T0 + 120 * SEC));
        assert_eq!(round.last_hen_price.unwrap().0, 38_000);
        assert_eq!(round.last_egg_price.unwrap().0, 13_596);
    }

    #[test]
    fn the_bigger_riser_wins_and_coins_are_minted_and_burned() {
        let mut coop = coop_with_scouts();
        play_round(&mut coop, 0, &all(38_000, 13_596));
        coop.round.hen_roosted = 1000 * COIN;
        coop.round.egg_roosted = 500 * COIN;
        // Chicken up 1%, eggs flat.
        let result = play_round(&mut coop, 120, &all(38_380, 13_596));
        assert_eq!(result.outcome, Outcome::Hen);
        assert_eq!((result.hen_move_ppm, result.egg_move_ppm), (10_000, 0));
        let pay_each = 100 * COIN / 3; // rounded down, the dust is never minted
        assert_eq!(result.minted_hen.0, 30 * COIN + 3 * pay_each);
        assert_eq!(result.burned_egg.0, 15 * COIN);
        assert_eq!((result.minted_egg.0, result.burned_hen.0), (0, 0));
        for scout in S {
            assert_eq!(coop.get_scout(acc(scout)).unwrap().earned_hen.0, pay_each);
        }
        assert_eq!((coop.stats.hen_wins, coop.stats.streak, coop.stats.streak_side), (1, 1, Some(Side::Hen)));
        assert_eq!(coop.ledger.len(), 3); // hatch, scout pay, fry
    }

    #[test]
    fn a_liar_is_slashed_and_the_honest_scouts_share_the_pot() {
        let mut coop = coop_with_scouts();
        add_scout(&mut coop, LIAR);
        let mut reports = all(38_000, 13_596);
        reports.push((LIAR, 50_000, 13_596));
        let result = play_round(&mut coop, 0, &reports);
        // The middle of 38000, 38000, 38000, 50000 is still 38000.
        assert_eq!(result.hen_price.0, 38_000);
        assert_eq!((result.reveals, result.honest), (4, 3));
        assert_eq!(result.slashed, vec![acc(LIAR)]);
        let cut = NearToken::from_millinear(100).as_yoctonear(); // 10% of a 1 NEAR bond
        let each = cut / 3;
        assert_eq!(result.pot_paid.as_yoctonear(), 3 * each);
        assert_eq!(coop.pot, cut - 3 * each); // one yoctoNEAR of dust stays in the pot
        let liar = coop.get_scout(acc(LIAR)).unwrap();
        assert_eq!((liar.bond, liar.slashed_rounds), (NearToken::from_millinear(900), 1));
        let honest = coop.get_scout(acc(S[0])).unwrap();
        assert_eq!((honest.earned_near.as_yoctonear(), honest.honest_rounds), (each, 1));
    }

    #[test]
    fn a_liar_is_benched_after_seven_slashes() {
        let mut coop = coop_with_scouts();
        add_scout(&mut coop, LIAR);
        let mut reports = all(38_000, 13_596);
        reports.push((LIAR, 50_000, 13_596));
        for round in 0..7 {
            assert!(!coop.get_scout(acc(LIAR)).unwrap().benched);
            play_round(&mut coop, round * 120, &reports);
        }
        // 1 NEAR * 0.9^7 is 0.478 NEAR, below the 0.5 NEAR min_bond.
        assert!(coop.get_scout(acc(LIAR)).unwrap().benched);
    }

    #[test]
    fn too_few_reports_make_a_void_round() {
        let mut coop = coop_with_scouts();
        play_round(&mut coop, 0, &all(38_000, 13_596));
        // Round 2: three seals, but scout-3 never opens its report.
        for scout in S {
            ctx(scout, ZERO, 120 + 60);
            coop.commit(seal_for(40_000, 13_596, "salt", scout));
        }
        for scout in &S[..2] {
            ctx(scout, ZERO, 120 + 90);
            coop.reveal(U128(40_000), U128(13_596), "salt".to_string());
        }
        ctx("settler.test", ZERO, 240);
        let result = coop.settle();
        assert_eq!(result.outcome, Outcome::Void);
        assert_eq!((result.reveals, result.honest), (2, 0));
        assert_eq!(result.slashed, vec![acc(S[2])]);
        assert!(result.pot_paid.is_zero());
        assert_eq!(coop.pot, NearToken::from_millinear(100).as_yoctonear());
        // The prices to compare with are still those of round 1.
        assert_eq!(coop.last_prices, Some((38_000, 13_596)));
        assert_eq!(coop.stats.voids, 1);
        assert_eq!(coop.get_round().id, 3);
    }

    #[test]
    fn ties_do_not_break_a_streak() {
        let mut coop = coop_with_scouts();
        let rounds = [
            (38_000, 13_596, Outcome::Baseline),
            (38_380, 13_596, Outcome::Hen),
            (38_380, 13_596, Outcome::Tie),
            (38_764, 13_596, Outcome::Hen),
            (38_764, 13_800, Outcome::Egg),
        ];
        for (i, (hen, egg, expected)) in rounds.into_iter().enumerate() {
            let result = play_round(&mut coop, i as u64 * 120, &all(hen, egg));
            assert_eq!(result.outcome, expected, "round {}", i + 1);
            if i == 3 {
                assert_eq!((coop.stats.streak, coop.stats.streak_side), (2, Some(Side::Hen)));
            }
        }
        let stats = &coop.stats;
        assert_eq!((stats.hen_wins, stats.egg_wins, stats.ties, stats.voids), (2, 1, 1, 0));
        assert_eq!((stats.streak, stats.streak_side, stats.best_streak), (1, Some(Side::Egg), 2));
        assert_eq!(coop.history.len(), 5);
    }

    #[test]
    #[should_panic(expected = "The reveal phase is not over yet")]
    fn nobody_settles_early() {
        let mut coop = coop_with_scouts();
        ctx("settler.test", ZERO, 119);
        coop.settle();
    }
}
