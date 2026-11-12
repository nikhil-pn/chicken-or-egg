//! The smallest possible check: the three contracts deploy and round 1 is open.

mod common;

use common::*;
use serde_json::json;

#[tokio::test]
async fn the_coop_opens_round_one_with_no_coins_in_existence() -> testresult::TestResult<()> {
    let world = World::start().await?;

    let round = world.round().await?;
    assert_eq!((round["id"].as_u64(), round["phase"].as_str()), (Some(1), Some("roost")));
    assert_eq!(world.supply(&world.hen).await?, 0);
    assert_eq!(world.supply(&world.egg).await?, 0);
    // The coop is the only account that can mint.
    let minter = world.view(&world.hen, "get_minter", json!({})).await?;
    assert_eq!(minter, json!(id("coop")));

    // The clock helper walks the round through its phases.
    for phase in ["commit", "reveal", "settle"] {
        world.wait_for(phase).await?;
        assert_eq!(world.round().await?["phase"], phase);
    }
    Ok(())
}
