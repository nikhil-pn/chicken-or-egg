//! The coop: the coordinator contract of Chicken or Egg.
//!
//! It runs the rounds, holds the roosted coins, takes the scouts' sealed price
//! reports, decides which side came first, and is the only account allowed to
//! mint or burn $HEN and $EGG. `RULES.md` in the repository root is the
//! specification; this crate follows it line by line.
//!
//! There is no owner and no admin method. Every parameter is fixed in `new`.

mod coin;
mod math;
mod players;
mod round;
mod scouts;
mod settle;
#[cfg(test)]
mod testing;
mod views;

use near_sdk::json_types::U128;
use near_sdk::store::{IterableMap, LookupMap, Vector};
use near_sdk::{AccountId, BorshStorageKey, NearToken, PanicOnDefault, env, near, require};

/// Basis points in one whole.
pub const BPS: u128 = 10_000;
/// Hard ceiling on scouts, so `settle` always fits in one transaction.
pub const MAX_SCOUTS: u32 = 32;
/// Largest price a scout may report. Keeps every move inside an `i64`.
pub const MAX_PRICE: u128 = 1_000_000_000_000;
/// NEAR kept from a new player to pay for the bytes of their record.
pub const PLAYER_STORAGE: NearToken = NearToken::from_millinear(10);
/// NEAR sent with each starter-pack mint so the coin can register the player.
pub const COIN_STORAGE: NearToken = NearToken::from_yoctonear(1_250_000_000_000_000_000_000);

/// The two sides of the question.
#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Side {
    Hen,
    Egg,
}

/// How a round ended.
#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Outcome {
    /// First round with prices: nothing to compare against.
    Baseline,
    /// Too few scouts revealed.
    Void,
    /// The two moves were closer than `tie_bps`.
    Tie,
    Hen,
    Egg,
}

/// Everything that can be tuned. Set once in `new`, readable with `get_config`.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Config {
    pub hen_token: AccountId,
    pub egg_token: AccountId,
    pub roost_secs: u32,
    pub commit_secs: u32,
    pub reveal_secs: u32,
    pub hatch_bps: u32,
    pub fry_bps: u32,
    pub tie_bps: u32,
    pub scout_pay: U128,
    pub scout_bond: NearToken,
    pub min_bond: NearToken,
    pub slash_bps: u32,
    pub tolerance_bps: u32,
    pub min_reveals: u32,
    pub max_scouts: u32,
    pub starter_hen: U128,
    pub starter_egg: U128,
    pub starter_fee: NearToken,
    pub starter_cap: u32,
}

impl Config {
    fn assert_valid(&self) {
        require!(self.hen_token != self.egg_token, "HEN and EGG must be two different coins");
        require!(
            self.roost_secs > 0 && self.commit_secs > 0 && self.reveal_secs > 0,
            "Every phase needs a length"
        );
        for bps in [self.hatch_bps, self.fry_bps, self.tie_bps, self.slash_bps, self.tolerance_bps] {
            require!(bps as u128 <= BPS, "A share cannot be more than 10000 basis points");
        }
        require!(self.min_reveals >= 1, "min_reveals must be at least 1");
        require!(self.max_scouts >= self.min_reveals, "max_scouts is below min_reveals");
        require!(self.max_scouts <= MAX_SCOUTS, "max_scouts is above the hard ceiling of 32");
        require!(!self.scout_bond.is_zero(), "scout_bond must be more than zero");
        require!(self.min_bond <= self.scout_bond, "min_bond cannot be above scout_bond");
        if self.starter_cap > 0 {
            let needed = PLAYER_STORAGE.saturating_add(COIN_STORAGE.saturating_mul(2));
            require!(self.starter_fee >= needed, "starter_fee does not cover storage");
        }
    }
}

/// The round that is open right now.
#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct Round {
    pub id: u64,
    /// Block time when the round opened, in nanoseconds.
    pub opened_at: u64,
    pub hen_roosted: u128,
    pub egg_roosted: u128,
    pub commits: u32,
    pub reveals: u32,
}

/// One scout agent.
#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct Scout {
    /// Who paid the bond. Only this account can collect, top up is open to anyone.
    pub funder: AccountId,
    pub bond: u128,
    /// NEAR won from the pot, not yet collected.
    pub earned_near: u128,
    /// Coins won as scout pay, not yet collected.
    pub earned_hen: u128,
    pub earned_egg: u128,
    /// Sealed report: (round id, sha256).
    pub seal: Option<(u64, [u8; 32])>,
    /// Opened report: (round id, hen price, egg price).
    pub report: Option<(u64, u128, u128)>,
    pub honest_rounds: u32,
    pub slashed_rounds: u32,
}

/// Coins locked on one side for one round.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Roost {
    pub round: u64,
    pub side: Side,
    pub amount: U128,
}

/// One player.
#[near(serializers = [borsh])]
#[derive(Clone, Debug, Default)]
pub struct Player {
    pub roost: Option<Roost>,
    /// Coins that came back from settled rounds and wait for `claim`.
    pub nest_hen: u128,
    pub nest_egg: u128,
    pub wins: u32,
    pub losses: u32,
    pub streak: u32,
    pub best_streak: u32,
    pub has_starter: bool,
}

/// The public record of one settled round.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct RoundResult {
    pub id: u64,
    pub opened_at: u64,
    pub settled_at: u64,
    pub outcome: Outcome,
    pub hen_price: U128,
    pub egg_price: U128,
    pub hen_move_ppm: i64,
    pub egg_move_ppm: i64,
    pub hen_roosted: U128,
    pub egg_roosted: U128,
    pub minted_hen: U128,
    pub minted_egg: U128,
    pub burned_hen: U128,
    pub burned_egg: U128,
    pub reveals: u32,
    pub honest: u32,
    pub slashed: Vec<AccountId>,
    pub pot_paid: NearToken,
    pub settled_by: AccountId,
}

/// Why coins were created or destroyed.
#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum LogKind {
    Starter,
    Hatch,
    ScoutPay,
    Fry,
}

/// One line of the mint and burn log.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct LogEntry {
    pub round: u64,
    pub kind: LogKind,
    pub coin: Side,
    pub amount: U128,
    pub account: Option<AccountId>,
    pub at: u64,
}

/// Running totals for the page.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, Default)]
pub struct Stats {
    pub minted_hen: U128,
    pub minted_egg: U128,
    pub burned_hen: U128,
    pub burned_egg: U128,
    pub hen_wins: u32,
    pub egg_wins: u32,
    pub ties: u32,
    pub voids: u32,
    /// Side that won the last decided round, and how many in a row.
    pub streak_side: Option<Side>,
    pub streak: u32,
    pub best_streak: u32,
    pub starters_claimed: u32,
    pub players: u32,
}

#[near]
#[derive(BorshStorageKey)]
enum StorageKey {
    Scouts,
    Players,
    History,
    Ledger,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Coop {
    config: Config,
    round: Round,
    /// Middle prices of the last round that had enough reports: (hen, egg).
    last_prices: Option<(u128, u128)>,
    scouts: IterableMap<AccountId, Scout>,
    players: LookupMap<AccountId, Player>,
    history: Vector<RoundResult>,
    ledger: Vector<LogEntry>,
    /// NEAR waiting to be shared by honest scouts.
    pot: u128,
    stats: Stats,
}

#[near]
impl Coop {
    /// Creates the coop and opens round 1. Nothing here can be changed later.
    #[init]
    pub fn new(config: Config) -> Self {
        config.assert_valid();
        Self {
            config,
            round: Round {
                id: 1,
                opened_at: env::block_timestamp(),
                hen_roosted: 0,
                egg_roosted: 0,
                commits: 0,
                reveals: 0,
            },
            last_prices: None,
            scouts: IterableMap::new(StorageKey::Scouts),
            players: LookupMap::new(StorageKey::Players),
            history: Vector::new(StorageKey::History),
            ledger: Vector::new(StorageKey::Ledger),
            pot: 0,
            stats: Stats::default(),
        }
    }

    /// Every parameter of the game.
    pub fn get_config(&self) -> Config {
        self.config.clone()
    }
}
