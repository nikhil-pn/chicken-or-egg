//! The coin used by Chicken or Egg.
//!
//! One build of this crate is deployed twice: once as $HEN and once as $EGG.
//! It is a plain NEP-141 token with two extra methods, `mint` and `burn`, that only
//! the coop contract may call. The coop is named once, in `new`, and there is no
//! method that changes it. Supply starts at zero.

use near_contract_standards::fungible_token::events::{FtBurn, FtMint};
use near_contract_standards::fungible_token::metadata::{
    FT_METADATA_SPEC, FungibleTokenMetadata, FungibleTokenMetadataProvider,
};
use near_contract_standards::fungible_token::{
    FungibleToken, FungibleTokenCore, FungibleTokenResolver,
};
use near_contract_standards::storage_management::{
    StorageBalance, StorageBalanceBounds, StorageManagement,
};
use near_sdk::collections::LazyOption;
use near_sdk::json_types::U128;
use near_sdk::{
    AccountId, BorshStorageKey, NearToken, PanicOnDefault, PromiseOrValue, env, near, require,
};

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    token: FungibleToken,
    metadata: LazyOption<FungibleTokenMetadata>,
    /// The coop. The only account that may mint or burn. Set once.
    minter: AccountId,
}

#[near]
#[derive(BorshStorageKey)]
enum StorageKey {
    Accounts,
    Metadata,
}

#[near]
impl Contract {
    /// Creates the coin with a supply of zero.
    #[init]
    pub fn new(
        minter: AccountId,
        name: String,
        symbol: String,
        decimals: u8,
        icon: Option<String>,
    ) -> Self {
        let metadata = FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.to_string(),
            name,
            symbol,
            icon,
            reference: None,
            reference_hash: None,
            decimals,
        };
        metadata.assert_valid();
        Self {
            token: FungibleToken::new(StorageKey::Accounts),
            metadata: LazyOption::new(StorageKey::Metadata, Some(&metadata)),
            minter,
        }
    }

    /// Creates `amount` new coins for `account_id`. Coop only.
    ///
    /// The account is registered on the fly, so a first-time player does not need a
    /// separate `storage_deposit`. The coop attaches the storage cost when it mints
    /// a starter pack.
    #[payable]
    pub fn mint(&mut self, account_id: AccountId, amount: U128, memo: Option<String>) {
        self.assert_minter();
        if !self.token.accounts.contains_key(&account_id) {
            self.token.internal_register_account(&account_id);
        }
        if amount.0 > 0 {
            self.token.internal_deposit(&account_id, amount.0);
            FtMint { owner_id: &account_id, amount, memo: memo.as_deref() }.emit();
        }
    }

    /// Destroys `amount` coins held by the coop itself. Coop only.
    ///
    /// Roosted coins sit in the coop's balance, so frying the losing side is a burn
    /// of the coop's own coins. Nobody's wallet can be burned from outside.
    pub fn burn(&mut self, amount: U128, memo: Option<String>) {
        self.assert_minter();
        if amount.0 > 0 {
            let coop = self.minter.clone();
            self.token.internal_withdraw(&coop, amount.0);
            FtBurn { owner_id: &coop, amount, memo: memo.as_deref() }.emit();
        }
    }

    /// The account allowed to mint and burn.
    pub fn get_minter(&self) -> AccountId {
        self.minter.clone()
    }

    fn assert_minter(&self) {
        require!(
            env::predecessor_account_id() == self.minter,
            "Only the coop may mint or burn"
        );
    }
}

#[near]
impl FungibleTokenCore for Contract {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.token.ft_transfer(receiver_id, amount, memo)
    }

    #[payable]
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }

    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for Contract {
    #[private]
    fn ft_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) -> U128 {
        let (used_amount, burned_amount) =
            self.token.internal_ft_resolve_transfer(&sender_id, receiver_id, amount);
        if burned_amount > 0 {
            FtBurn {
                owner_id: &sender_id,
                amount: U128(burned_amount),
                memo: Some("sender account was closed during the transfer"),
            }
            .emit();
        }
        used_amount.into()
    }
}

#[near]
impl StorageManagement for Contract {
    #[payable]
    fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        // `force` would destroy coins outside the mint/burn rule, so it is refused.
        require!(force != Some(true), "Forced unregister is not allowed");
        self.token.internal_storage_unregister(force).is_some()
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for Contract {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        self.metadata.get().unwrap()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{VMContextBuilder, accounts};
    use near_sdk::testing_env;

    fn coop() -> AccountId {
        accounts(1)
    }

    fn as_caller(caller: AccountId) {
        let mut ctx = VMContextBuilder::new();
        ctx.current_account_id(accounts(0)).predecessor_account_id(caller);
        testing_env!(ctx.build());
    }

    fn new_coin() -> Contract {
        as_caller(accounts(0));
        Contract::new(coop(), "Hen".into(), "HEN".into(), 18, None)
    }

    #[test]
    fn supply_starts_at_zero() {
        let coin = new_coin();
        assert_eq!(coin.ft_total_supply().0, 0);
        assert_eq!(coin.get_minter(), coop());
        assert_eq!(coin.ft_metadata().symbol, "HEN");
    }

    #[test]
    fn coop_mints_and_registers_the_receiver() {
        let mut coin = new_coin();
        as_caller(coop());
        coin.mint(accounts(2), U128(500), Some("starter pack".into()));
        assert_eq!(coin.ft_balance_of(accounts(2)).0, 500);
        assert_eq!(coin.ft_total_supply().0, 500);
        assert!(coin.storage_balance_of(accounts(2)).is_some());
    }

    #[test]
    #[should_panic(expected = "Only the coop may mint or burn")]
    fn a_stranger_cannot_mint() {
        let mut coin = new_coin();
        as_caller(accounts(2));
        coin.mint(accounts(2), U128(500), None);
    }

    #[test]
    fn coop_burns_only_its_own_coins() {
        let mut coin = new_coin();
        as_caller(coop());
        coin.mint(coop(), U128(1_000), None);
        coin.mint(accounts(2), U128(300), None);
        coin.burn(U128(400), Some("fried".into()));
        assert_eq!(coin.ft_balance_of(coop()).0, 600);
        assert_eq!(coin.ft_balance_of(accounts(2)).0, 300);
        assert_eq!(coin.ft_total_supply().0, 900);
    }

    #[test]
    #[should_panic(expected = "Only the coop may mint or burn")]
    fn a_stranger_cannot_burn() {
        let mut coin = new_coin();
        as_caller(coop());
        coin.mint(coop(), U128(1_000), None);
        as_caller(accounts(2));
        coin.burn(U128(1), None);
    }

    #[test]
    #[should_panic(expected = "The account doesn't have enough balance")]
    fn coop_cannot_burn_more_than_it_holds() {
        let mut coin = new_coin();
        as_caller(coop());
        coin.mint(coop(), U128(10), None);
        coin.burn(U128(11), None);
    }
}
