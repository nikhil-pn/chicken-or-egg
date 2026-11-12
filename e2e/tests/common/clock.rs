//! Moving the sandbox clock from one phase of a round to the next.

use serde_json::{Value, json};
use testresult::TestResult;

use super::{SETTLE_GAS_CEILING, World, ZERO};

impl World {
    /// Finds out how much block time one fast-forwarded block is worth.
    pub(super) async fn measure_clock(&mut self) -> TestResult<()> {
        const PROBE: u64 = 20;
        let before = self.round().await?["seconds_left"].as_u64().unwrap();
        let started = std::time::Instant::now();
        self.sandbox.fast_forward(PROBE).await?;
        let waited = started.elapsed().as_secs_f64();
        let after = self.round().await?["seconds_left"].as_u64().unwrap();
        // Part of the gain is the real time we spent waiting, not the jump.
        let gained = (before.saturating_sub(after) as f64 - waited).max(0.0);
        self.secs_per_block = (gained / PROBE as f64).max(0.05);
        eprintln!(
            "sandbox clock: {PROBE} blocks took {waited:.1}s and moved block time {}s",
            before.saturating_sub(after)
        );
        Ok(())
    }

    /// Fast-forwards until the open round is in `phase`.
    pub async fn wait_for(&self, phase: &str) -> TestResult<()> {
        for _ in 0..40 {
            let round = self.round().await?;
            if round["phase"] == phase {
                return Ok(());
            }
            assert_ne!(round["phase"], "settle", "only settle() can end the settle phase");
            let left = round["seconds_left"].as_u64().unwrap() as f64 + 2.0;
            let blocks = (left / self.secs_per_block).ceil().clamp(1.0, 5_000.0);
            self.sandbox.fast_forward(blocks as u64).await?;
        }
        panic!("the coop never reached the {phase} phase");
    }

    /// The scouts seal and open their reports, then `settler` settles the round.
    /// Each report is (scout, chicken price, egg price).
    pub async fn report_and_settle(
        &self,
        reports: &[(&str, u128, u128)],
        settler: &str,
    ) -> TestResult<Value> {
        self.wait_for("commit").await?;
        for (scout, hen, egg) in reports {
            let args = json!({ "seal": super::seal(*hen, *egg, "pepper", scout) });
            self.ok(scout, &self.coop, "commit", args, ZERO).await?;
        }
        self.wait_for("reveal").await?;
        for (scout, hen, egg) in reports {
            let args = json!({ "hen": hen.to_string(), "egg": egg.to_string(), "salt": "pepper" });
            self.ok(scout, &self.coop, "reveal", args, ZERO).await?;
        }
        self.wait_for("settle").await?;
        let result = self.run(settler, &self.coop, "settle", json!({}), ZERO).await?;
        let gas = result.total_gas_burnt;
        eprintln!("settle with {} reports burned {gas}", reports.len());
        assert!(gas < SETTLE_GAS_CEILING, "settle burned {gas}, a third of the limit is the ceiling");
        Ok(result.json()?)
    }
}
