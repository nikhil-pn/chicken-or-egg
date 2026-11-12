//! A full house: the most scouts the coop allows, all reporting in one round.
//!
//! `settle` walks every scout in a single transaction, so this is the proof that
//! the ceiling of 32 scouts fits well inside NEAR's limit of 300 Tgas.
//! Measured on the sandbox: 16.5 Tgas with 32 reports, 8 of them slashed.

mod common;

use common::*;
use near_api::NearToken;
use serde_json::json;
use testresult::TestResult;

const HOUSE: usize = 32;
/// A quarter of the house lies in the second round.
const LIARS: usize = 8;
const FEE: NearToken = NearToken::from_millinear(100);

#[tokio::test]
async fn settle_with_a_full_house_fits_in_one_transaction() -> TestResult<()> {
    let world = World::start().await?;
    let (hen, egg, coop) = (&world.hen, &world.egg, &world.coop);
    world.account("alice", 20).await?;
    world.account("bob", 20).await?;
    world.account("funder", 60).await?;

    // Roost first: the roost phase is short and registering scouts takes a while.
    for (who, coin) in [("alice", hen), ("bob", egg)] {
        world.ok(who, coop, "claim_starter", json!({}), FEE).await?;
        let args = json!({ "receiver_id": id("coop"), "amount": (100 * COIN).to_string(), "msg": "roost" });
        world.ok(who, coin, "ft_transfer_call", args, ONE_YOCTO).await?;
    }

    let names: Vec<String> = (1..=HOUSE).map(|n| format!("scout-{n}")).collect();
    for name in &names {
        world.account(name, 5).await?;
        let args = json!({ "scout_id": id(name) });
        world.ok("funder", coop, "register_scout", args, NearToken::from_near(1)).await?;
    }
    let extra = json!({ "scout_id": id("scout-33") });
    world.refused("funder", coop, "register_scout", extra, NearToken::from_near(1), "no room").await?;

    // Round 1: everyone agrees, the first prices are set.
    let first: Vec<_> = names.iter().map(|name| (name.as_str(), 38_000, 13_596)).collect();
    assert_eq!(world.report_and_settle(&first, "alice").await?["outcome"], "baseline");

    // Round 2: chicken is up 1%. Eight scouts lie and are slashed.
    for (who, side) in [("alice", "hen"), ("bob", "egg")] {
        let args = json!({ "side": side, "amount": (100 * COIN).to_string() });
        world.ok(who, coop, "roost", args, ZERO).await?;
    }
    let second: Vec<_> = names
        .iter()
        .enumerate()
        .map(|(n, name)| (name.as_str(), if n < LIARS { 50_000 } else { 38_380 }, 13_596))
        .collect();
    let result = world.report_and_settle(&second, "alice").await?;
    assert_eq!(result["outcome"], "hen");
    assert_eq!(result["reveals"], HOUSE);
    assert_eq!(result["honest"], HOUSE - LIARS);
    assert_eq!(result["slashed"].as_array().unwrap().len(), LIARS);
    Ok(())
}
