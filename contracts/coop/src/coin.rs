//! The three methods the coop calls on the $HEN and $EGG contracts.

use crate::*;
use near_sdk::{Gas, ext_contract};

/// Gas kept for each call to a coin contract.
pub const COIN_CALL_GAS: Gas = Gas::from_tgas(10);

#[ext_contract(ext_coin)]
pub trait Coin {
    fn mint(&mut self, account_id: AccountId, amount: U128, memo: Option<String>);
    fn burn(&mut self, amount: U128, memo: Option<String>);
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

impl Side {
    pub fn other(self) -> Side {
        match self {
            Side::Hen => Side::Egg,
            Side::Egg => Side::Hen,
        }
    }
}

impl Coop {
    /// The coin contract of one side.
    pub(crate) fn token(&self, side: Side) -> AccountId {
        match side {
            Side::Hen => self.config.hen_token.clone(),
            Side::Egg => self.config.egg_token.clone(),
        }
    }
}

/// Writes a NEP-297 event to the transaction log, for indexers and explorers.
pub(crate) fn emit<T: near_sdk::serde::Serialize>(event: &str, data: &T) {
    let json = near_sdk::serde_json::json!({
        "standard": "chicken-or-egg",
        "version": "1.0.0",
        "event": event,
        "data": [data],
    });
    env::log_str(&format!("EVENT_JSON:{json}"));
}
