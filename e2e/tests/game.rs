//! The whole game on a local NEAR sandbox: real coins, real cross-contract calls.
//!
//! Round 1 sets the first prices, round 2 has a winner and a lying scout,
//! round 3 is void because every scout stays silent.

mod common;

use common::*;
use near_api::{Contract, NearToken};
use serde_json::{Value, json};
use testresult::TestResult;

const SCOUTS: [&str; 4] = ["scout-1", "scout-2", "scout-3", "scout-4"];
const FEE: NearToken = NearToken::from_millinear(100);

/// Every scout reports the same two prices.
fn all(hen: u128, egg: u128) -> Vec<(&'static str, u128, u128)> {
    SCOUTS.iter().map(|scout| (*scout, hen, egg)).collect()
}

/// `who` sends whole coins from the wallet to the coop, with or without the word "roost".
async fn send(world: &World, who: &str, coin: &Contract, coins: u128, msg: &str) -> TestResult<()> {
    let args = json!({ "receiver_id": id("coop"), "amount": (coins * COIN).to_string(), "msg": msg });
    let _ = world.call(who, coin, "ft_transfer_call", args, ONE_YOCTO).await?;
    Ok(())
}

async fn player(world: &World, who: &str) -> TestResult<Value> {
    world.view(&world.coop, "get_player", json!({ "account_id": id(who) })).await
}

#[tokio::test]
async fn three_rounds_of_the_whole_game() -> TestResult<()> {
    let world = World::start().await?;
    let (hen, egg, coop) = (&world.hen, &world.egg, &world.coop);
    for name in ["alice", "bob", "funder"].into_iter().chain(SCOUTS) {
        world.account(name, 20).await?;
    }

    // Round 1. Starter packs are the first coins in existence.
    for who in ["alice", "bob"] {
        world.ok(who, coop, "claim_starter", json!({}), FEE).await?;
    }
    assert_eq!(world.coins(hen, "alice").await?, 1000 * COIN);
    assert_eq!(world.coins(egg, "alice").await?, 1000 * COIN);
    world.refused("alice", coop, "claim_starter", json!({}), FEE, "One starter pack per account").await?;
    // Nobody but the coop can mint.
    let args = json!({ "account_id": id("alice"), "amount": COIN.to_string(), "memo": null });
    world.refused("alice", hen, "mint", args, ZERO, "Only the coop").await?;

    for scout in SCOUTS {
        let args = json!({ "scout_id": id(scout) });
        world.ok("funder", coop, "register_scout", args, NearToken::from_near(1)).await?;
    }
    send(&world, "alice", hen, 100, "roost").await?;
    send(&world, "bob", egg, 100, "roost").await?;
    // Coins sent without the word "roost" come straight back.
    send(&world, "alice", hen, 50, "").await?;
    assert_eq!(world.coins(hen, "alice").await?, 900 * COIN);
    assert_eq!(amount(&world.round().await?["hen_roosted"]), 100 * COIN);

    let result = world.report_and_settle(&all(38_000, 13_596), "alice").await?;
    assert_eq!(result["outcome"], "baseline");
    assert_eq!(amount(&player(&world, "alice").await?["nest_hen"]), 100 * COIN);

    // Round 2. Both roost again from the nest. Chicken rises 1%, eggs stay flat,
    // and scout 4 lies about the chicken.
    for (who, side) in [("alice", "hen"), ("bob", "egg")] {
        let args = json!({ "side": side, "amount": (100 * COIN).to_string() });
        world.ok(who, coop, "roost", args, ZERO).await?;
    }
    let mut reports = all(38_380, 13_596);
    reports[3] = ("scout-4", 50_000, 13_596);
    let result = world.report_and_settle(&reports, "bob").await?;
    assert_eq!(result["outcome"], "hen");
    assert_eq!(result["hen_move_ppm"], 10_000);
    assert_eq!(result["slashed"], json!([id("scout-4")]));

    world.ok("alice", coop, "claim", json!({}), ZERO).await?;
    assert_eq!(world.coins(hen, "alice").await?, 1003 * COIN);
    assert_eq!(amount(&player(&world, "bob").await?["nest_egg"]), 97 * COIN);

    // The coin contracts hold exactly what the coop says it minted and burned.
    let scout_pay = 3 * (100 * COIN / 3);
    assert_eq!(world.supply(hen).await?, 2003 * COIN + scout_pay);
    assert_eq!(world.supply(egg).await?, 1997 * COIN);
    let stats = world.view(coop, "get_stats", json!({})).await?;
    assert_eq!(amount(&stats["hen_supply"]), world.supply(hen).await?);
    assert_eq!(amount(&stats["egg_supply"]), world.supply(egg).await?);
    // And the coop holds exactly what it owes: the scouts' pay and Bob's nest.
    assert_eq!(world.coins(hen, "coop").await?, scout_pay);
    assert_eq!(world.coins(egg, "coop").await?, 97 * COIN);

    // The liar lost a tenth of its bond. The honest three shared it, on top of
    // the starter fees they shared with scout 4 in round 1.
    let scout = |name: &'static str| world.view(coop, "get_scout", json!({ "scout_id": id(name) }));
    let liar = scout("scout-4").await?;
    assert_eq!(liar["bond"], json!(NearToken::from_millinear(900)));
    let from_fees = NearToken::from_millinear(175).as_yoctonear() / 4;
    let from_slash = NearToken::from_millinear(100).as_yoctonear() / 3;
    assert_eq!(amount(&liar["earned_near"]), from_fees);
    assert_eq!(amount(&scout("scout-1").await?["earned_near"]), from_fees + from_slash);

    // Round 3. No scout reports, so the round is void and nothing moves.
    send(&world, "alice", egg, 10, "roost").await?;
    world.wait_for("settle").await?;
    let result: Value = world.run("funder", coop, "settle", json!({}), ZERO).await?.json()?;
    assert_eq!(result["outcome"], "void");
    assert_eq!(amount(&player(&world, "alice").await?["nest_egg"]), 10 * COIN);
    assert_eq!(world.supply(egg).await?, 1997 * COIN);
    assert_eq!(world.round().await?["id"], 4);

    // The funder joins and collects what scout 1 earned.
    world.ok("funder", coop, "join", json!({}), NearToken::from_millinear(10)).await?;
    world.ok("funder", coop, "collect_scout", json!({ "scout_id": id("scout-1") }), ZERO).await?;
    assert_eq!(amount(&scout("scout-1").await?["earned_near"]), 0);
    assert_eq!(amount(&player(&world, "funder").await?["nest_hen"]), 100 * COIN / 3);
    Ok(())
}
