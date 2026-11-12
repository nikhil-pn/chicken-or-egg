//! Players: joining, the starter pack, roosting coins, and taking them back.
//!
//! A roost is settled lazily. `settle` only records which side won; the first
//! time a player roosts or claims after that, their old roost is hatched or
//! fried with the arithmetic of RULES.md and moved into their nest.

use crate::coin::{COIN_CALL_GAS, ext_coin};
use crate::round::Phase;
use crate::*;
use near_sdk::{Gas, Promise, PromiseError, PromiseOrValue};

const CALLBACK_GAS: Gas = Gas::from_tgas(5);
const STARTER_MINT_GAS: Gas = Gas::from_tgas(15);

/// What the page shows about one player, with a settled roost already counted.
#[near(serializers = [json])]
pub struct PlayerView {
    pub account_id: AccountId,
    /// Coins locked in the open round, if any.
    pub roost: Option<Roost>,
    /// Coins that `claim` would send right now.
    pub nest_hen: U128,
    pub nest_egg: U128,
    pub wins: u32,
    pub losses: u32,
    pub streak: u32,
    pub best_streak: u32,
    pub has_starter: bool,
}

#[near]
impl Coop {
    /// Opens a player record. The 0.01 NEAR pays for its storage; more is sent back.
    #[payable]
    pub fn join(&mut self) {
        let account = env::predecessor_account_id();
        let paid = env::attached_deposit();
        require!(paid >= PLAYER_STORAGE, "Attach 0.01 NEAR for storage");
        require!(!self.players.contains_key(&account), "Already joined");
        self.players.insert(account.clone(), Player::default());
        self.stats.players += 1;
        let extra = paid.saturating_sub(PLAYER_STORAGE);
        if !extra.is_zero() {
            Promise::new(account).transfer(extra).detach();
        }
    }

    /// Mints the starter pack to the caller: once per account, until `starter_cap`
    /// packs are gone. The fee, less storage, goes to the scouts' pot.
    #[payable]
    pub fn claim_starter(&mut self) {
        let account = env::predecessor_account_id();
        let fee = env::attached_deposit();
        require!(fee >= self.config.starter_fee, "Attach the starter fee");
        require!(self.stats.starters_claimed < self.config.starter_cap, "All starter packs are gone");
        let is_new = !self.players.contains_key(&account);
        let mut player = self.players.get(&account).cloned().unwrap_or_default();
        require!(!player.has_starter, "One starter pack per account");
        player.has_starter = true;
        self.players.insert(account.clone(), player);
        if is_new {
            self.stats.players += 1;
        }
        self.stats.starters_claimed += 1;
        let kept = PLAYER_STORAGE.saturating_add(COIN_STORAGE.saturating_mul(2));
        self.pot += fee.saturating_sub(kept).as_yoctonear();

        let (id, now) = (self.round.id, env::block_timestamp());
        for (coin, amount) in [(Side::Hen, self.config.starter_hen), (Side::Egg, self.config.starter_egg)] {
            if amount.0 == 0 {
                continue;
            }
            match coin {
                Side::Hen => self.stats.minted_hen.0 += amount.0,
                Side::Egg => self.stats.minted_egg.0 += amount.0,
            }
            self.ledger.push(LogEntry {
                round: id,
                kind: LogKind::Starter,
                coin,
                amount,
                account: Some(account.clone()),
                at: now,
            });
            ext_coin::ext(self.token(coin))
                .with_attached_deposit(COIN_STORAGE)
                .with_static_gas(STARTER_MINT_GAS)
                .mint(account.clone(), amount, Some("starter pack".to_string()))
                .detach();
        }
    }

    /// NEP-141 hook. `ft_transfer_call` on a coin with `msg` set to `roost` locks
    /// the coins on that coin's side: $HEN backs the hen, $EGG backs the egg.
    /// A refused roost panics, and the coin contract then returns the coins.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        let coin = env::predecessor_account_id();
        let side = if coin == self.config.hen_token {
            Side::Hen
        } else if coin == self.config.egg_token {
            Side::Egg
        } else {
            env::panic_str("Only $HEN and $EGG can roost")
        };
        require!(msg == "roost", "Send the coins with msg set to roost");
        self.add_roost(&sender_id, side, amount.0, false);
        PromiseOrValue::Value(U128(0))
    }

    /// Roosts coins that are already in the caller's nest, without a withdrawal.
    pub fn roost(&mut self, side: Side, amount: U128) {
        self.add_roost(&env::predecessor_account_id(), side, amount.0, true);
    }

    /// Sends the caller every coin in their nest. A roost in the open round stays locked.
    pub fn claim(&mut self) {
        let account = env::predecessor_account_id();
        let mut player =
            self.players.get(&account).cloned().unwrap_or_else(|| env::panic_str("Not a player"));
        self.roll(&mut player);
        let hen = std::mem::take(&mut player.nest_hen);
        let egg = std::mem::take(&mut player.nest_egg);
        require!(hen > 0 || egg > 0, "Nothing to claim");
        self.players.insert(account.clone(), player);
        for (coin, amount) in [(Side::Hen, hen), (Side::Egg, egg)] {
            if amount == 0 {
                continue;
            }
            ext_coin::ext(self.token(coin))
                .with_attached_deposit(NearToken::from_yoctonear(1))
                .with_static_gas(COIN_CALL_GAS)
                .ft_transfer(account.clone(), U128(amount), Some("claim".to_string()))
                .then(
                    Self::ext(env::current_account_id())
                        .with_static_gas(CALLBACK_GAS)
                        .on_coins_sent(account.clone(), coin, U128(amount)),
                )
                .detach();
        }
    }

    /// Puts the coins back in the nest when a `claim` transfer failed, for example
    /// because the player is not registered on that coin.
    #[private]
    pub fn on_coins_sent(
        &mut self,
        account_id: AccountId,
        coin: Side,
        amount: U128,
        #[callback_result] sent: Result<(), PromiseError>,
    ) {
        if sent.is_ok() {
            return;
        }
        if let Some(player) = self.players.get_mut(&account_id) {
            match coin {
                Side::Hen => player.nest_hen += amount.0,
                Side::Egg => player.nest_egg += amount.0,
            }
        }
        env::log_str("The transfer failed. The coins are back in the nest.");
    }

    pub fn get_player(&self, account_id: AccountId) -> Option<PlayerView> {
        let mut player = self.players.get(&account_id)?.clone();
        self.roll(&mut player);
        Some(PlayerView {
            account_id,
            roost: player.roost,
            nest_hen: U128(player.nest_hen),
            nest_egg: U128(player.nest_egg),
            wins: player.wins,
            losses: player.losses,
            streak: player.streak,
            best_streak: player.best_streak,
            has_starter: player.has_starter,
        })
    }
}

impl Coop {
    /// Moves a roost from a settled round into the nest: hatched if its side won,
    /// fried if it lost, unchanged after a tie, a void round or the baseline round.
    fn roll(&self, player: &mut Player) {
        let Some(roost) = player.roost.clone() else { return };
        if roost.round >= self.round.id {
            return;
        }
        let outcome = self.history.get((roost.round - 1) as u32).unwrap().outcome;
        let winner = match outcome {
            Outcome::Hen => Some(Side::Hen),
            Outcome::Egg => Some(Side::Egg),
            _ => None,
        };
        let amount = match winner {
            Some(side) if side == roost.side => {
                player.wins += 1;
                player.streak += 1;
                player.best_streak = player.best_streak.max(player.streak);
                math::hatched(roost.amount.0, self.config.hatch_bps)
            }
            Some(_) => {
                player.losses += 1;
                player.streak = 0;
                math::fried(roost.amount.0, self.config.fry_bps)
            }
            None => roost.amount.0,
        };
        match roost.side {
            Side::Hen => player.nest_hen += amount,
            Side::Egg => player.nest_egg += amount,
        }
        player.roost = None;
    }

    fn add_roost(&mut self, account: &AccountId, side: Side, amount: u128, from_nest: bool) {
        require!(self.phase() == Phase::Roost, "Roosting is closed for this round");
        require!(amount > 0, "Roost more than zero");
        let mut player = self
            .players
            .get(account)
            .cloned()
            .unwrap_or_else(|| env::panic_str("Join the coop first: call join or claim_starter"));
        self.roll(&mut player);
        if from_nest {
            let nest = match side {
                Side::Hen => &mut player.nest_hen,
                Side::Egg => &mut player.nest_egg,
            };
            require!(*nest >= amount, "Not enough coins in the nest");
            *nest -= amount;
        }
        match &mut player.roost {
            Some(roost) => {
                require!(roost.side == side, "One side per round");
                roost.amount.0 += amount;
            }
            None => player.roost = Some(Roost { round: self.round.id, side, amount: U128(amount) }),
        }
        match side {
            Side::Hen => self.round.hen_roosted += amount,
            Side::Egg => self.round.egg_roosted += amount,
        }
        self.players.insert(account.clone(), player);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::*;

    const ALICE: &str = "alice.test";
    const BOB: &str = "bob.test";

    fn join(coop: &mut Coop, who: &str) {
        ctx(who, PLAYER_STORAGE, 0);
        coop.join();
    }

    /// `who` sends whole coins to the coop through the coin contract of `side`.
    fn send(coop: &mut Coop, who: &str, side: Side, coins: u128, secs: u64) {
        let coin = match side {
            Side::Hen => "hen.test",
            Side::Egg => "egg.test",
        };
        ctx(coin, ZERO, secs);
        let _ = coop.ft_on_transfer(acc(who), U128(coins * COIN), "roost".to_string());
    }

    fn player(coop: &Coop, who: &str) -> PlayerView {
        coop.get_player(acc(who)).unwrap()
    }

    /// Round 1 sets the first prices. In round 2 Alice backs the hen and Bob the egg.
    fn two_players_in_round_two() -> Coop {
        let mut coop = coop_with_scouts();
        join(&mut coop, ALICE);
        join(&mut coop, BOB);
        play_round(&mut coop, 0, &all(38_000, 13_596));
        send(&mut coop, ALICE, Side::Hen, 100, 130);
        send(&mut coop, BOB, Side::Egg, 100, 130);
        coop
    }

    #[test]
    #[should_panic(expected = "Attach 0.01 NEAR for storage")]
    fn joining_pays_for_the_storage_of_one_record() {
        let mut coop = new_coop();
        ctx(ALICE, ZERO, 0);
        coop.join();
    }

    #[test]
    fn coins_sent_with_the_word_roost_are_locked_on_their_side() {
        let mut coop = new_coop();
        join(&mut coop, ALICE);
        send(&mut coop, ALICE, Side::Hen, 100, 10);
        send(&mut coop, ALICE, Side::Hen, 50, 20);
        assert_eq!(coop.get_round().hen_roosted.0, 150 * COIN);
        let roost = player(&coop, ALICE).roost.unwrap();
        assert_eq!((roost.round, roost.side, roost.amount.0), (1, Side::Hen, 150 * COIN));
        assert_eq!(coop.stats.players, 1);
    }

    #[test]
    #[should_panic(expected = "One side per round")]
    fn nobody_backs_both_sides_in_one_round() {
        let mut coop = new_coop();
        join(&mut coop, ALICE);
        send(&mut coop, ALICE, Side::Hen, 100, 10);
        send(&mut coop, ALICE, Side::Egg, 100, 20);
    }

    #[test]
    #[should_panic(expected = "Only $HEN and $EGG can roost")]
    fn other_coins_are_refused() {
        let mut coop = new_coop();
        join(&mut coop, ALICE);
        ctx("fake.test", ZERO, 10);
        let _ = coop.ft_on_transfer(acc(ALICE), U128(COIN), "roost".to_string());
    }

    #[test]
    #[should_panic(expected = "Send the coins with msg set to roost")]
    fn the_message_must_say_roost() {
        let mut coop = new_coop();
        join(&mut coop, ALICE);
        ctx("hen.test", ZERO, 10);
        let _ = coop.ft_on_transfer(acc(ALICE), U128(COIN), String::new());
    }

    #[test]
    #[should_panic(expected = "Roosting is closed for this round")]
    fn roosting_closes_when_the_scouts_start() {
        let mut coop = new_coop();
        join(&mut coop, ALICE);
        send(&mut coop, ALICE, Side::Hen, 100, 60);
    }

    #[test]
    #[should_panic(expected = "Join the coop first")]
    fn a_stranger_cannot_roost() {
        let mut coop = new_coop();
        send(&mut coop, ALICE, Side::Hen, 100, 10);
    }

    #[test]
    fn winners_hatch_and_losers_fry() {
        let mut coop = two_players_in_round_two();
        // Chicken up 1%, eggs flat: the hen came first.
        let result = play_round(&mut coop, 120, &all(38_380, 13_596));
        assert_eq!(result.outcome, Outcome::Hen);
        assert_eq!((result.hen_roosted.0, result.egg_roosted.0), (100 * COIN, 100 * COIN));
        let alice = player(&coop, ALICE);
        assert_eq!((alice.nest_hen.0, alice.wins, alice.streak), (103 * COIN, 1, 1));
        assert!(alice.roost.is_none());
        let bob = player(&coop, BOB);
        assert_eq!((bob.nest_egg.0, bob.losses, bob.streak), (97 * COIN, 1, 0));
        // What the players gained and lost is what the coop minted and burned.
        let scout_pay = 3 * (100 * COIN / 3);
        assert_eq!(result.minted_hen.0 - scout_pay, 3 * COIN);
        assert_eq!(result.burned_egg.0, 3 * COIN);
    }

    #[test]
    fn a_tie_gives_every_coin_back() {
        let mut coop = two_players_in_round_two();
        let result = play_round(&mut coop, 120, &all(38_000, 13_596));
        assert_eq!(result.outcome, Outcome::Tie);
        let (alice, bob) = (player(&coop, ALICE), player(&coop, BOB));
        assert_eq!((alice.nest_hen.0, bob.nest_egg.0), (100 * COIN, 100 * COIN));
        assert_eq!((alice.wins, alice.losses, bob.wins, bob.losses), (0, 0, 0, 0));
    }

    #[test]
    fn nest_coins_roost_again_without_a_withdrawal() {
        let mut coop = two_players_in_round_two();
        play_round(&mut coop, 120, &all(38_380, 13_596));
        ctx(ALICE, ZERO, 250);
        coop.roost(Side::Hen, U128(103 * COIN));
        let alice = player(&coop, ALICE);
        assert_eq!(alice.nest_hen.0, 0);
        assert_eq!((alice.roost.unwrap().round, coop.get_round().hen_roosted.0), (3, 103 * COIN));
    }

    #[test]
    #[should_panic(expected = "Not enough coins in the nest")]
    fn the_nest_cannot_be_overdrawn() {
        let mut coop = two_players_in_round_two();
        play_round(&mut coop, 120, &all(38_380, 13_596));
        ctx(ALICE, ZERO, 250);
        coop.roost(Side::Hen, U128(104 * COIN));
    }

    #[test]
    fn claim_empties_the_nest_and_leaves_the_open_roost_locked() {
        let mut coop = two_players_in_round_two();
        play_round(&mut coop, 120, &all(38_380, 13_596));
        send(&mut coop, ALICE, Side::Egg, 40, 250);
        ctx(ALICE, ZERO, 260);
        coop.claim();
        let alice = player(&coop, ALICE);
        assert_eq!((alice.nest_hen.0, alice.nest_egg.0), (0, 0));
        assert_eq!(alice.roost.unwrap().amount.0, 40 * COIN);
        // One transfer on the $HEN contract, followed by the coop's own callback.
        let receipts = near_sdk::test_utils::get_created_receipts();
        assert!(receipts.iter().any(|receipt| receipt.receiver_id == acc("hen.test")));
        assert!(!receipts.iter().any(|receipt| receipt.receiver_id == acc("egg.test")));
    }

    #[test]
    #[should_panic(expected = "Nothing to claim")]
    fn an_empty_nest_has_nothing_to_claim() {
        let mut coop = new_coop();
        join(&mut coop, ALICE);
        ctx(ALICE, ZERO, 10);
        coop.claim();
    }

    #[test]
    fn a_failed_transfer_puts_the_coins_back_in_the_nest() {
        let mut coop = two_players_in_round_two();
        play_round(&mut coop, 120, &all(38_380, 13_596));
        ctx(ALICE, ZERO, 250);
        coop.claim();
        assert_eq!(player(&coop, ALICE).nest_hen.0, 0);
        ctx("coop.test", ZERO, 251);
        coop.on_coins_sent(acc(ALICE), Side::Hen, U128(103 * COIN), Err(PromiseError::Failed));
        assert_eq!(player(&coop, ALICE).nest_hen.0, 103 * COIN);
        // A transfer that went through changes nothing.
        coop.on_coins_sent(acc(ALICE), Side::Hen, U128(103 * COIN), Ok(()));
        assert_eq!(player(&coop, ALICE).nest_hen.0, 103 * COIN);
    }

    fn starter(coop: &mut Coop, who: &str) {
        ctx(who, NearToken::from_millinear(100), 5);
        coop.claim_starter();
    }

    #[test]
    fn the_starter_pack_mints_both_coins_and_feeds_the_pot() {
        let mut coop = new_coop();
        starter(&mut coop, ALICE);
        assert_eq!((coop.stats.minted_hen.0, coop.stats.minted_egg.0), (1000 * COIN, 1000 * COIN));
        assert_eq!((coop.stats.starters_claimed, coop.stats.players), (1, 1));
        assert_eq!(coop.ledger.len(), 2);
        // 0.1 NEAR fee, less 0.01 for the record and 2 x 0.00125 for the two coin accounts.
        assert_eq!(coop.pot, NearToken::from_micronear(87_500).as_yoctonear());
        assert!(player(&coop, ALICE).has_starter);
        // The coins go straight to the player's wallet, not to the nest.
        assert_eq!(player(&coop, ALICE).nest_hen.0, 0);
    }

    #[test]
    fn a_player_who_joined_first_still_gets_one_pack() {
        let mut coop = new_coop();
        join(&mut coop, ALICE);
        starter(&mut coop, ALICE);
        assert_eq!((coop.stats.starters_claimed, coop.stats.players), (1, 1));
    }

    #[test]
    #[should_panic(expected = "One starter pack per account")]
    fn one_starter_pack_per_account() {
        let mut coop = new_coop();
        starter(&mut coop, ALICE);
        starter(&mut coop, ALICE);
    }

    #[test]
    #[should_panic(expected = "All starter packs are gone")]
    fn the_starter_packs_run_out() {
        let mut coop = new_coop();
        for who in [ALICE, BOB, "carol.test", "dave.test"] {
            starter(&mut coop, who);
        }
    }

    #[test]
    #[should_panic(expected = "Attach the starter fee")]
    fn the_starter_pack_has_a_fee() {
        let mut coop = new_coop();
        ctx(ALICE, NearToken::from_millinear(99), 5);
        coop.claim_starter();
    }
}
