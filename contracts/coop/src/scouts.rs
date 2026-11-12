//! Scouts: joining with a bond, sealing a report, opening it, leaving.
//!
//! A scout account calls only `commit`, `reveal` and `settle`. None of them takes
//! a deposit, so a function-call key limited to these three methods is enough.
//! Money moves only through the funder: `register_scout`, `top_up_scout`,
//! `collect_scout` and `retire_scout`.

use crate::round::Phase;
use crate::*;
use near_sdk::Promise;

/// What the page shows about one scout.
#[near(serializers = [json])]
pub struct ScoutView {
    pub scout_id: AccountId,
    pub funder: AccountId,
    pub bond: NearToken,
    /// True when the bond is below `min_bond`: the scout cannot report.
    pub benched: bool,
    pub earned_near: NearToken,
    pub earned_hen: U128,
    pub earned_egg: U128,
    /// Sent a sealed report in the open round.
    pub sealed: bool,
    /// Opened its report in the open round.
    pub revealed: bool,
    pub hen_price: Option<U128>,
    pub egg_price: Option<U128>,
    pub honest_rounds: u32,
    pub slashed_rounds: u32,
}

/// Turns 64 hex characters into the 32 bytes of a sha256.
fn decode_seal(seal: &str) -> [u8; 32] {
    let chars = seal.as_bytes();
    require!(chars.len() == 64, "The seal must be 64 hex characters");
    let mut out = [0u8; 32];
    for (i, byte) in out.iter_mut().enumerate() {
        let hi = (chars[2 * i] as char).to_digit(16);
        let lo = (chars[2 * i + 1] as char).to_digit(16);
        match (hi, lo) {
            (Some(hi), Some(lo)) => *byte = (hi * 16 + lo) as u8,
            _ => env::panic_str("The seal must be 64 hex characters"),
        }
    }
    out
}

#[near]
impl Coop {
    /// Adds a scout. The attached NEAR is its bond and the caller is its funder.
    #[payable]
    pub fn register_scout(&mut self, scout_id: AccountId) {
        let bond = env::attached_deposit();
        require!(bond >= self.config.scout_bond, "Attach at least scout_bond");
        require!(self.scouts.len() < self.config.max_scouts, "The coop has no room for more scouts");
        require!(!self.scouts.contains_key(&scout_id), "This scout is already registered");
        self.scouts.insert(
            scout_id,
            Scout {
                funder: env::predecessor_account_id(),
                bond: bond.as_yoctonear(),
                earned_near: 0,
                earned_hen: 0,
                earned_egg: 0,
                seal: None,
                report: None,
                honest_rounds: 0,
                slashed_rounds: 0,
            },
        );
    }

    /// Adds NEAR to a scout's bond. Anyone may do this.
    #[payable]
    pub fn top_up_scout(&mut self, scout_id: AccountId) {
        let extra = env::attached_deposit();
        require!(!extra.is_zero(), "Attach the NEAR to add");
        let scout = self.scouts.get_mut(&scout_id).unwrap_or_else(|| env::panic_str("No such scout"));
        scout.bond += extra.as_yoctonear();
    }

    /// Sealed report for the open round: the hex sha256 of
    /// `"<hen>:<egg>:<salt>:<scout account>"`. Commit phase only.
    /// Sending again before the phase ends replaces the earlier seal.
    pub fn commit(&mut self, seal: String) {
        require!(self.phase() == Phase::Commit, "Reports are sealed in the commit phase only");
        let hash = decode_seal(&seal);
        let round_id = self.round.id;
        let min_bond = self.config.min_bond.as_yoctonear();
        let scout_id = env::predecessor_account_id();
        let scout = self.scouts.get_mut(&scout_id).unwrap_or_else(|| env::panic_str("Not a scout"));
        require!(scout.bond >= min_bond, "Benched: the bond is below min_bond");
        let first = !matches!(scout.seal, Some((round, _)) if round == round_id);
        scout.seal = Some((round_id, hash));
        if first {
            self.round.commits += 1;
        }
    }

    /// Opens the sealed report. Reveal phase only. Prices are whole numbers:
    /// chicken per kilogram and eggs per dozen, in the smallest currency unit.
    pub fn reveal(&mut self, hen: U128, egg: U128, salt: String) {
        require!(self.phase() == Phase::Reveal, "Reports are opened in the reveal phase only");
        require!(
            (1..=MAX_PRICE).contains(&hen.0) && (1..=MAX_PRICE).contains(&egg.0),
            "A price must be between 1 and 10^12"
        );
        require!(salt.len() <= 64, "The salt is too long");
        let round_id = self.round.id;
        let scout_id = env::predecessor_account_id();
        let scout = self.scouts.get_mut(&scout_id).unwrap_or_else(|| env::panic_str("Not a scout"));
        let hash = match scout.seal {
            Some((round, hash)) if round == round_id => hash,
            _ => env::panic_str("No sealed report in this round"),
        };
        require!(
            !matches!(scout.report, Some((round, _, _)) if round == round_id),
            "This report is already open"
        );
        let text = format!("{}:{}:{}:{}", hen.0, egg.0, salt, scout_id);
        require!(env::sha256_array(text.as_bytes()) == hash, "The report does not match the seal");
        scout.report = Some((round_id, hen.0, egg.0));
        self.round.reveals += 1;
    }

    /// Pays the funder the NEAR this scout won from the pot, and moves the coins
    /// it won into the funder's nest (if the funder has joined the coop).
    pub fn collect_scout(&mut self, scout_id: AccountId) -> Promise {
        let funder = env::predecessor_account_id();
        let scout = self.scouts.get_mut(&scout_id).unwrap_or_else(|| env::panic_str("No such scout"));
        require!(scout.funder == funder, "Only the funder can collect");
        let near = std::mem::take(&mut scout.earned_near);
        if let Some(player) = self.players.get_mut(&funder) {
            player.nest_hen += std::mem::take(&mut scout.earned_hen);
            player.nest_egg += std::mem::take(&mut scout.earned_egg);
        }
        Promise::new(funder).transfer(NearToken::from_yoctonear(near))
    }

    /// Removes the scout and returns the bond plus everything it earned.
    /// Roost phase only, so a scout cannot seal a report and then run.
    pub fn retire_scout(&mut self, scout_id: AccountId) -> Promise {
        require!(self.phase() == Phase::Roost, "Scouts can leave in the roost phase only");
        let funder = env::predecessor_account_id();
        let scout = self.scouts.get(&scout_id).unwrap_or_else(|| env::panic_str("No such scout"));
        require!(scout.funder == funder, "Only the funder can retire a scout");
        let scout = self.scouts.remove(&scout_id).unwrap();
        if scout.earned_hen > 0 || scout.earned_egg > 0 {
            let player = self
                .players
                .get_mut(&funder)
                .unwrap_or_else(|| env::panic_str("Join the coop first to receive the scout's coins"));
            player.nest_hen += scout.earned_hen;
            player.nest_egg += scout.earned_egg;
        }
        Promise::new(funder).transfer(NearToken::from_yoctonear(scout.bond + scout.earned_near))
    }

    /// Every scout with its bond and what it did in the open round.
    pub fn get_scouts(&self) -> Vec<ScoutView> {
        self.scouts.iter().map(|(id, scout)| self.scout_view(id, scout)).collect()
    }

    pub fn get_scout(&self, scout_id: AccountId) -> Option<ScoutView> {
        self.scouts.get(&scout_id).map(|scout| self.scout_view(&scout_id, scout))
    }
}

impl Coop {
    fn scout_view(&self, id: &AccountId, scout: &Scout) -> ScoutView {
        let round_id = self.round.id;
        let report = scout.report.filter(|(round, _, _)| *round == round_id);
        ScoutView {
            scout_id: id.clone(),
            funder: scout.funder.clone(),
            bond: NearToken::from_yoctonear(scout.bond),
            benched: scout.bond < self.config.min_bond.as_yoctonear(),
            earned_near: NearToken::from_yoctonear(scout.earned_near),
            earned_hen: U128(scout.earned_hen),
            earned_egg: U128(scout.earned_egg),
            sealed: matches!(scout.seal, Some((round, _)) if round == round_id),
            revealed: report.is_some(),
            hen_price: report.map(|(_, hen, _)| U128(hen)),
            egg_price: report.map(|(_, _, egg)| U128(egg)),
            honest_rounds: scout.honest_rounds,
            slashed_rounds: scout.slashed_rounds,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::*;

    const S1: &str = "scout-1.test";

    #[test]
    fn a_scout_seals_then_opens_a_report() {
        let mut coop = new_coop();
        add_scout(&mut coop, S1);

        ctx(S1, ZERO, 60); // commit phase
        coop.commit(seal_for(1, 1, "first try", S1));
        coop.commit(seal_for(38_000, 13_596, "salt", S1)); // replaces the first seal
        assert_eq!(coop.get_round().commits, 1);
        let view = coop.get_scout(acc(S1)).unwrap();
        assert!(view.sealed && !view.revealed && view.hen_price.is_none());

        ctx(S1, ZERO, 90); // reveal phase
        coop.reveal(U128(38_000), U128(13_596), "salt".to_string());
        assert_eq!(coop.get_round().reveals, 1);
        let view = coop.get_scout(acc(S1)).unwrap();
        assert!(view.revealed);
        assert_eq!((view.hen_price.unwrap().0, view.egg_price.unwrap().0), (38_000, 13_596));
    }

    #[test]
    #[should_panic(expected = "The report does not match the seal")]
    fn a_report_that_differs_from_the_seal_is_refused() {
        let mut coop = new_coop();
        add_scout(&mut coop, S1);
        ctx(S1, ZERO, 60);
        coop.commit(seal_for(38_000, 13_596, "salt", S1));
        ctx(S1, ZERO, 90);
        coop.reveal(U128(38_001), U128(13_596), "salt".to_string());
    }

    #[test]
    #[should_panic(expected = "The report does not match the seal")]
    fn a_copied_seal_does_not_open_for_another_scout() {
        let mut coop = new_coop();
        add_scout(&mut coop, S1);
        add_scout(&mut coop, "copycat.test");
        ctx("copycat.test", ZERO, 60);
        coop.commit(seal_for(38_000, 13_596, "salt", S1)); // seal lifted from scout-1
        ctx("copycat.test", ZERO, 90);
        coop.reveal(U128(38_000), U128(13_596), "salt".to_string());
    }

    #[test]
    #[should_panic(expected = "This report is already open")]
    fn a_report_opens_once() {
        let mut coop = new_coop();
        add_scout(&mut coop, S1);
        ctx(S1, ZERO, 60);
        coop.commit(seal_for(38_000, 13_596, "salt", S1));
        ctx(S1, ZERO, 90);
        coop.reveal(U128(38_000), U128(13_596), "salt".to_string());
        coop.reveal(U128(38_000), U128(13_596), "salt".to_string());
    }

    #[test]
    #[should_panic(expected = "Reports are sealed in the commit phase only")]
    fn no_seal_while_players_can_still_roost() {
        let mut coop = new_coop();
        add_scout(&mut coop, S1);
        ctx(S1, ZERO, 59);
        coop.commit(seal_for(38_000, 13_596, "salt", S1));
    }

    #[test]
    #[should_panic(expected = "No sealed report in this round")]
    fn no_report_without_a_seal() {
        let mut coop = new_coop();
        add_scout(&mut coop, S1);
        ctx(S1, ZERO, 90);
        coop.reveal(U128(38_000), U128(13_596), "salt".to_string());
    }

    #[test]
    #[should_panic(expected = "Not a scout")]
    fn strangers_cannot_report() {
        let mut coop = new_coop();
        ctx("stranger.test", ZERO, 60);
        coop.commit(seal_for(38_000, 13_596, "salt", "stranger.test"));
    }

    #[test]
    #[should_panic(expected = "Attach at least scout_bond")]
    fn a_scout_needs_the_full_bond() {
        let mut coop = new_coop();
        ctx("funder.test", NearToken::from_millinear(999), 0);
        coop.register_scout(acc(S1));
    }

    #[test]
    #[should_panic(expected = "The coop has no room for more scouts")]
    fn the_scout_limit_holds() {
        let mut coop = new_coop(); // max_scouts is 5 in the test config
        for i in 0..6 {
            add_scout(&mut coop, &format!("scout-{i}.test"));
        }
    }

    #[test]
    #[should_panic(expected = "Only the funder can retire a scout")]
    fn only_the_funder_takes_the_bond_back() {
        let mut coop = new_coop();
        add_scout(&mut coop, S1);
        ctx("thief.test", ZERO, 10);
        coop.retire_scout(acc(S1));
    }

    #[test]
    fn the_funder_retires_a_scout_and_a_top_up_adds_to_the_bond() {
        let mut coop = new_coop();
        add_scout(&mut coop, S1);
        ctx("friend.test", NearToken::from_near(2), 5);
        coop.top_up_scout(acc(S1));
        assert_eq!(coop.get_scout(acc(S1)).unwrap().bond, NearToken::from_near(3));
        ctx("funder.test", ZERO, 10);
        coop.retire_scout(acc(S1));
        assert!(coop.get_scout(acc(S1)).is_none());
        assert_eq!(coop.get_round().scouts, 0);
    }
}
