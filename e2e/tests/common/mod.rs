//! Shared helpers: a local NEAR sandbox with both coins and the coop deployed.
//!
//! Build the contracts first with `./scripts/build.sh`.

#![allow(dead_code)]

use std::sync::Arc;

use near_api::types::transaction::result::ExecutionFinalResult;
use near_api::{AccountId, Contract, NearGas, NearToken, NetworkConfig, Signer};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use testresult::TestResult;

mod clock;

/// One whole coin. Both coins have 18 decimals.
pub const COIN: u128 = 1_000_000_000_000_000_000;
/// Seconds in each phase of a round.
pub const PHASE_SECS: u64 = 120;
/// `settle` must stay far below the 300 Tgas one transaction may burn.
pub const SETTLE_GAS_CEILING: NearGas = NearGas::from_tgas(100);
pub const ZERO: NearToken = NearToken::from_yoctonear(0);
pub const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);

/// Account `name` on the sandbox.
pub fn id(name: &str) -> AccountId {
    format!("{name}.sandbox").parse().unwrap()
}

/// The sealed report a scout sends in the commit phase.
pub fn seal(hen: u128, egg: u128, salt: &str, scout: &str) -> String {
    let text = format!("{hen}:{egg}:{salt}:{}", id(scout));
    Sha256::digest(text.as_bytes()).iter().map(|byte| format!("{byte:02x}")).collect()
}

fn wasm(name: &str) -> Vec<u8> {
    let path = format!("{}/../target/near/{name}/{name}.wasm", env!("CARGO_MANIFEST_DIR"));
    std::fs::read(&path)
        .unwrap_or_else(|_| panic!("{path} is missing. Build the contracts first: ./scripts/build.sh"))
}

pub struct World {
    pub sandbox: near_sandbox::Sandbox,
    pub net: NetworkConfig,
    signer: Arc<Signer>,
    pub hen: Contract,
    pub egg: Contract,
    pub coop: Contract,
    /// Block time gained by one fast-forwarded block, in seconds.
    secs_per_block: f64,
}

impl World {
    /// Starts a sandbox, deploys the two coins and the coop, and opens round 1.
    pub async fn start() -> TestResult<Self> {
        let sandbox = near_sandbox::Sandbox::start_sandbox().await?;
        let net = NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse()?);
        let key = near_sandbox::config::DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY;
        let signer = Signer::from_secret_key(key.parse().unwrap())?;
        let mut world = Self {
            sandbox,
            net,
            signer,
            hen: Contract(id("hen")),
            egg: Contract(id("egg")),
            coop: Contract(id("coop")),
            secs_per_block: 1.0,
        };
        for name in ["hen", "egg", "coop"] {
            world.account(name, 20).await?;
        }
        for (coin, name, symbol) in [(&world.hen, "Hen", "HEN"), (&world.egg, "Egg", "EGG")] {
            let args = json!({
                "minter": id("coop"), "name": name, "symbol": symbol, "decimals": 18, "icon": null,
            });
            world.deploy(coin, "coe_token", args).await?;
        }
        world.deploy(&world.coop, "coe_coop", json!({ "config": config() })).await?;
        // The coop must be able to hold both coins before anyone roosts.
        for coin in [&world.hen, &world.egg] {
            let args = json!({ "account_id": id("coop") });
            world.ok("coop", coin, "storage_deposit", args, NearToken::from_millinear(10)).await?;
        }
        world.measure_clock().await?;
        Ok(world)
    }

    /// Creates `<name>.sandbox` with `near` NEAR.
    pub async fn account(&self, name: &str, near: u128) -> TestResult<()> {
        self.sandbox
            .create_account(id(name).as_str().parse()?)
            .initial_balance(NearToken::from_near(near))
            .send()
            .await?;
        Ok(())
    }

    async fn deploy(&self, contract: &Contract, code: &str, args: Value) -> TestResult<()> {
        Contract::deploy(contract.account_id().clone())
            .use_code(wasm(code))
            .with_init_call("new", args)?
            .with_signer(self.signer.clone())
            .send_to(&self.net)
            .await?
            .assert_success();
        Ok(())
    }

    /// Sends one transaction and returns whatever happened.
    pub async fn call(
        &self,
        who: &str,
        contract: &Contract,
        method: &str,
        args: Value,
        deposit: NearToken,
    ) -> TestResult<ExecutionFinalResult> {
        let result = contract
            .call_function(method, args)
            .transaction()
            .deposit(deposit)
            .gas(NearGas::from_tgas(300))
            .with_signer(id(who), self.signer.clone())
            .send_to(&self.net)
            .await?;
        Ok(result.into_full().expect("the sandbox waits for the final result"))
    }

    /// A call that must go through, in every receipt it starts.
    pub async fn ok(
        &self,
        who: &str,
        contract: &Contract,
        method: &str,
        args: Value,
        deposit: NearToken,
    ) -> TestResult<()> {
        self.run(who, contract, method, args, deposit).await.map(drop)
    }

    /// Like `ok`, and hands back the result: its return value, logs and gas.
    pub async fn run(
        &self,
        who: &str,
        contract: &Contract,
        method: &str,
        args: Value,
        deposit: NearToken,
    ) -> TestResult<ExecutionFinalResult> {
        let result = self.call(who, contract, method, args, deposit).await?;
        assert!(
            result.is_success() && result.failures().is_empty(),
            "{who} calling {method} should work: {result:?}"
        );
        Ok(result)
    }

    /// A call that must be refused with `reason`.
    pub async fn refused(
        &self,
        who: &str,
        contract: &Contract,
        method: &str,
        args: Value,
        deposit: NearToken,
        reason: &str,
    ) -> TestResult<()> {
        let result = self.call(who, contract, method, args, deposit).await?;
        let shown = format!("{result:?}");
        assert!(result.is_failure(), "{who} calling {method} should be refused: {shown}");
        assert!(shown.contains(reason), "expected the reason {reason:?} in {shown}");
        Ok(())
    }

    pub async fn view(&self, contract: &Contract, method: &str, args: Value) -> TestResult<Value> {
        Ok(contract.call_function(method, args).read_only().fetch_from(&self.net).await?.data)
    }

    /// Coins of `coin` in the wallet of `who`.
    pub async fn coins(&self, coin: &Contract, who: &str) -> TestResult<u128> {
        let balance = self.view(coin, "ft_balance_of", json!({ "account_id": id(who) })).await?;
        Ok(amount(&balance))
    }

    pub async fn supply(&self, coin: &Contract) -> TestResult<u128> {
        Ok(amount(&self.view(coin, "ft_total_supply", json!({})).await?))
    }

    pub async fn round(&self) -> TestResult<Value> {
        self.view(&self.coop, "get_round", json!({})).await
    }
}

/// Reads a `U128` that came back as a JSON string.
pub fn amount(value: &Value) -> u128 {
    value.as_str().unwrap_or_else(|| panic!("not an amount: {value}")).parse().unwrap()
}

/// The parameters of the test coop. Same shares as the live game, shorter phases.
pub fn config() -> Value {
    json!({
        "hen_token": id("hen"),
        "egg_token": id("egg"),
        "roost_secs": PHASE_SECS,
        "commit_secs": PHASE_SECS,
        "reveal_secs": PHASE_SECS,
        "hatch_bps": 300,
        "fry_bps": 300,
        "tie_bps": 10,
        "scout_pay": (100 * COIN).to_string(),
        "scout_bond": NearToken::from_near(1),
        "min_bond": NearToken::from_millinear(500),
        "slash_bps": 1000,
        "tolerance_bps": 100,
        "min_reveals": 3,
        "max_scouts": 32,
        "starter_hen": (1000 * COIN).to_string(),
        "starter_egg": (1000 * COIN).to_string(),
        "starter_fee": NearToken::from_millinear(100),
        "starter_cap": 100,
    })
}
