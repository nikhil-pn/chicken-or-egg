// One scout agent. It seals a price report, opens it in the next phase, and takes
// its turn at settling the round. What it reports comes from its `source`.
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { TGAS, call, near, view } from '../lib/near.mjs';

/** The seal the coop checks: sha256 of "<hen>:<egg>:<salt>:<scout account>", in hex. */
export const sealOf = (hen, egg, salt, id) =>
  createHash('sha256').update(`${hen}:${egg}:${salt}:${id}`).digest('hex');

const TRIES = 4;
/** A scout takes its earnings home once in this many rounds. */
const COLLECT_EVERY = 10;
/** Scouts take turns at settling, this far apart. */
const TURN_MS = 6000;

export class Scout {
  constructor({ id, account, coop, source, stateFile, turn = 0, of = 1, log = console.log }) {
    Object.assign(this, { id, account, coop, source, stateFile, turn, of, log });
    this.name = id.split('.')[0];
    this.busy = false;
    // The salt of an open round is on disk, so a restart can still open the report.
    this.state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : {};
  }

  save() {
    mkdirSync(dirname(this.stateFile), { recursive: true });
    writeFileSync(this.stateFile, JSON.stringify(this.state) + '\n');
  }

  /** Called on every poll with the open round. Never runs twice at once. */
  async step(round, ctx) {
    if (this.busy) return;
    this.busy = true;
    try {
      if (this.state.round !== round.id) this.state = { round: round.id };
      if (round.phase === 'roost') await this.collect(round);
      else if (round.phase === 'commit') await this.commit(ctx);
      else if (round.phase === 'reveal') await this.reveal();
      else if (round.phase === 'settle') await this.settle(round);
    } catch (error) {
      this.log(`${this.name} round ${round.id} ${round.phase}: ${error.message}`);
    } finally {
      this.busy = false;
    }
  }

  /** Pays what the scout earned to its funder. The working key may do this and nothing more with money. */
  async collect(round) {
    const s = this.state;
    if (s.collected || round.id % COLLECT_EVERY !== this.turn) return;
    s.collected = true;
    const me = await view(this.coop, 'get_scout', { scout_id: this.id });
    if (!me || (me.earned_near === '0' && me.earned_hen === '0' && me.earned_egg === '0')) return;
    await call(this.account, this.coop, 'collect_scout', { scout_id: this.id }, { gas: 20n * TGAS });
    this.log(`${this.name} collected ${near(me.earned_near)} NEAR and its coins`);
  }

  async commit(ctx) {
    const s = this.state;
    if (s.sealed || s.skipped) return;
    if (!s.salt) {
      // Decide once per round, and write it down before anything is sent.
      const me = await view(this.coop, 'get_scout', { scout_id: this.id });
      const report = me?.benched ? null : await this.source(ctx);
      if (!report) {
        s.skipped = true;
        return this.save();
      }
      s.silent = Boolean(report.sealed); // seals a report and never opens it
      s.hen = String(report.hen ?? 1);
      s.egg = String(report.egg ?? 1);
      s.salt = randomBytes(16).toString('hex');
      this.save();
    }
    if ((s.commitTries = (s.commitTries ?? 0) + 1) > TRIES) return;
    const seal = sealOf(s.hen, s.egg, s.salt, this.id);
    await call(this.account, this.coop, 'commit', { seal }, { gas: 10n * TGAS });
    s.sealed = true;
    this.save();
    this.log(`${this.name} sealed ${seal.slice(0, 12)}`);
  }

  async reveal() {
    const s = this.state;
    if (!s.salt || s.silent || s.opened) return;
    if ((s.revealTries = (s.revealTries ?? 0) + 1) > TRIES) return;
    try {
      const args = { hen: s.hen, egg: s.egg, salt: s.salt };
      await call(this.account, this.coop, 'reveal', args, { gas: 10n * TGAS });
    } catch (error) {
      if (!/already open/.test(error.message)) throw error;
    }
    s.opened = true;
    this.save();
    this.log(`${this.name} opened hen ${s.hen} egg ${s.egg}`);
  }

  async settle(round) {
    const s = this.state;
    const turn = (this.turn + round.id) % this.of;
    s.settleAt ??= Date.now() + turn * TURN_MS;
    if (Date.now() < s.settleAt || (s.settleTries ?? 0) >= TRIES) return;
    s.settleTries = (s.settleTries ?? 0) + 1;
    s.settleAt = Date.now() + this.of * TURN_MS; // if this fails, wait a full circle
    const result = await call(this.account, this.coop, 'settle', {}, { gas: 60n * TGAS });
    const value = JSON.parse(Buffer.from(result.status.SuccessValue, 'base64').toString());
    this.log(`${this.name} settled round ${value.id}: ${value.outcome.toUpperCase()}`
      + ` (${value.reveals} reports, ${value.honest} honest, ${value.slashed.length} slashed)`);
  }
}
