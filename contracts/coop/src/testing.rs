//! Helpers shared by the unit tests.

use crate::*;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::testing_env;

pub const SEC: u64 = 1_000_000_000;
/// Block time at which the test coop opens round 1.
pub const T0: u64 = 1_700_000_000 * SEC;
pub const ZERO: NearToken = NearToken::from_near(0);
/// One whole coin (18 decimals).
pub const COIN: u128 = 1_000_000_000_000_000_000;

pub fn acc(name: &str) -> AccountId {
    name.parse().unwrap()
}

/// Sets the caller, the attached NEAR and the block time in seconds after `T0`.
pub fn ctx(caller: &str, deposit: NearToken, secs: u64) {
    testing_env!(
        VMContextBuilder::new()
            .current_account_id(acc("coop.test"))
            .predecessor_account_id(acc(caller))
            .signer_account_id(acc(caller))
            .attached_deposit(deposit)
            .block_timestamp(T0 + secs * SEC)
            .build()
    );
}

/// Phases of 60 + 30 + 30 seconds, so one round is two minutes.
pub fn config() -> Config {
    Config {
        hen_token: acc("hen.test"),
        egg_token: acc("egg.test"),
        roost_secs: 60,
        commit_secs: 30,
        reveal_secs: 30,
        hatch_bps: 300,
        fry_bps: 300,
        tie_bps: 10,
        scout_pay: U128(100 * COIN),
        scout_bond: NearToken::from_near(1),
        min_bond: NearToken::from_millinear(500),
        slash_bps: 1000,
        tolerance_bps: 100,
        min_reveals: 3,
        max_scouts: 5,
        starter_hen: U128(1000 * COIN),
        starter_egg: U128(1000 * COIN),
        starter_fee: NearToken::from_millinear(100),
        starter_cap: 3,
    }
}

pub fn new_coop() -> Coop {
    ctx("deployer.test", ZERO, 0);
    Coop::new(config())
}
