// One bot player. Each round it picks a side and roosts a fixed share of its coins there.
import { TGAS, call, view } from '../lib/near.mjs';

const TRIES = 3;

export class Player {
  constructor({ id, account, coop, coins, pick, shareBps, claimEvery = 0, log = console.log }) {
    Object.assign(this, { id, account, coop, coins, pick, shareBps: BigInt(shareBps), claimEvery, log });
    this.name = id.split('.')[0];
    this.busy = false;
    this.at = {};
  }

  /** Called on every poll with the open round. Never runs twice at once. */
  async step(round, ctx) {
    if (this.busy) return;
    this.busy = true;
    try {
      // Pick once per round, so a second try backs the same side.
      if (this.at.round !== round.id) this.at = { round: round.id, side: this.pick(ctx).toLowerCase(), tries: 0 };
      if (round.phase === 'roost') await this.roost(round);
      else if (round.phase === 'commit') await this.claim(round);
    } catch (error) {
      this.log(`${this.name} round ${round.id}: ${error.message}`);
    } finally {
      this.busy = false;
    }
  }

  async roost(round) {
    const at = this.at;
    if (at.done) return;
    const me = await view(this.coop, 'get_player', { account_id: this.id });
    if (me.roost?.round === round.id) {
      at.done = true;
      return this.log(`${this.name} roosted ${Number(BigInt(me.roost.amount) / 10n ** 16n) / 100} on ${me.roost.side.toUpperCase()}`);
    }
    if (at.tries++ >= TRIES) return;
    const coin = this.coins[at.side];
    const nest = BigInt(at.side === 'hen' ? me.nest_hen : me.nest_egg);
    const wallet = BigInt(await view(coin, 'ft_balance_of', { account_id: this.id }));
    const want = ((nest + wallet) * this.shareBps) / 10_000n;
    if (want === 0n) return void (at.done = true);
    if (nest >= want) {
      // Coins that came back from earlier rounds roost again without leaving the coop.
      await call(this.account, this.coop, 'roost', { side: at.side, amount: String(want) }, { gas: 10n * TGAS });
    } else {
      const amount = String(want < wallet ? want : wallet);
      const args = { receiver_id: this.coop, amount, msg: 'roost' };
      await call(this.account, coin, 'ft_transfer_call', args, { gas: 100n * TGAS, deposit: 1n });
    }
  }

  /** Now and then a player takes its winnings home to its wallet. */
  async claim(round) {
    const at = this.at;
    if (!this.claimEvery || at.claimed || round.id % this.claimEvery !== 0) return;
    at.claimed = true;
    const me = await view(this.coop, 'get_player', { account_id: this.id });
    if (me.nest_hen === '0' && me.nest_egg === '0') return;
    await call(this.account, this.coop, 'claim', {}, { gas: 80n * TGAS });
    this.log(`${this.name} claimed its nest`);
  }
}
