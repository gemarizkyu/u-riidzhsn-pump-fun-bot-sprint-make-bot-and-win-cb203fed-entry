// Second-wind dip buyer for make.fun's "Pump.fun Bot Sprint: Make Bot And Win".
//
// The harness speaks agent-fun/replay/v2: it opens with a hello message, then
// sends one batch of chain events per slot, and the bot answers each batch with
// its orders for that slot. This file is the whole strategy: it watches every
// coin from its CreateEvent, waits for proof that the coin can actually run,
// and only then buys the first deep pullback — the "second wind".
//
// Entry idea, in one line: a coin that ran at least +30% off its create price
// and then gave back at least 12% from its peak is a runner catching its
// breath, not a launch that never moved. Buying the dip of a proven runner
// beats buying every birth: most births never move at all, and the ones that
// do usually dump straight through a launch sniper's stop.
//
// Guardrails shape everything else:
// - The run must round-trip at least 0.01 SOL on each of at least 20 coins,
//   so small paced probe buys fill the book when dip entries run thin.
// - Maximum drawdown is 50%, so stakes stay small and exits stay fast.
// - A prize needs net PnL above 0 SOL, so the bot would rather sit in cash
//   than chase a coin whose tape already looks dead.
//
// Determinism: every decision is a pure function of the hello and the batches
// seen so far. No clock, no environment, no Math.random, no network. The two
// harness executions therefore produce identical action logs.
//
// Cost model used for exits: selling `tokens` against reserves (vq, vt) pays
// tokens*vq/(vt+tokens) before curve fees of 95 + 30 bps, minus one tx fee.
// A position is judged against its cost_lamports as the harness reports it.

import { runBot, LAMPORTS_PER_SOL } from "./vendor/makefun-bot.ts";
import type { Batch, BotState, OrderInput } from "./vendor/makefun-bot.ts";

const SOL = LAMPORTS_PER_SOL;
const BPS = 10_000n;

// --- dip entry -------------------------------------------------------------
const DIP_STAKE = (SOL * 8n) / 100n; // 0.08 SOL per dip buy
const DIP_MIN_AGE = 2; // slots since create before a dip may be bought
const DIP_MAX_AGE = 90; // ... and after this the coin is too old to chase
const DIP_MIN_RUNUP_BPS = 13_000n; // peak must have run +30% over create
const DIP_MIN_ABOVE_CREATE_BPS = 10_500n; // still +5% over create now
const DIP_PULLBACK_BPS = 8_800n; // now at most 88% of the peak (-12%)
const DIP_REAL_MIN = SOL / 2n; // real reserves 0.5 .. 40 SOL
const DIP_REAL_MAX = 40n * SOL;
const DIP_MAX_BIG_SELL_BPS = 2_500n; // no single outsider sell over 25% of real

// --- probe entries (guardrail pacing) --------------------------------------
const PROBE_STAKE = SOL / 50n; // 0.02 SOL per probe
const PROBE_EVERY_SLOTS = 900; // at most one probe per 900 slots
const PROBE_MAX = 30; // ... and thirty probes at most
const PROBE_MAX_AGE = 6; // probes only buy fresh coins
const PROBE_DEV_MAX = 2n * SOL; // creator bought at most 2 SOL at birth
const PROBE_REAL_MIN = SOL / 2n;
const PROBE_REAL_MAX = 30n * SOL;
const PROBE_RUNUP_MIN_BPS = 8_000n; // price now 0.8x .. 2.5x of create
const PROBE_RUNUP_MAX_BPS = 25_000n;

// --- exits -----------------------------------------------------------------
const TAKE_PROFIT_BPS = 11_800n; // sell at +18% over cost
const STOP_LOSS_BPS = 8_800n; // sell at -12% under cost
const MAX_HOLD_SLOTS = 30; // give up after thirty slots
const STALE_SLOTS = 60; // ... or after sixty slots with no trade
const BUY_SLIPPAGE_BPS = 500;
const SELL_SLIPPAGE_BPS = 10_000;
const MAX_ORDERS_PER_BATCH = 8; // comfortably under the harness cap
const PRUNE_AFTER_SLOTS = 120; // drop a dead coin record this old
const SWEEP_EVERY_BATCHES = 20_000;

// Curve fees on a sell: protocol 95 bps + creator 30 bps.
const CURVE_FEE_BPS = 125n;

type CoinNote = {
  creator: string;
  createdSlot: number;
  createVq: bigint; // virtual quote reserves at creation
  createVt: bigint; // virtual token reserves at creation
  peakBps: bigint; // best price vs create, in bps (10_000 = create price)
  devBuy: bigint; // creator buys in the create slot, lamports
  devSold: boolean;
  bigSellBps: bigint; // largest single outsider sell, bps of real reserves
  lastTradeSlot: number;
  bought: boolean; // the bot already bought this coin once
  done: boolean; // never consider it again
};

type OpenNote = {
  openedSlot: number;
  cost: bigint; // cost_lamports as last reported by the harness
  txPaid: bigint; // tx fees paid on fills for this position
};

const coins = new Map<string, CoinNote>();
const opened = new Map<string, OpenNote>();
const selling = new Set<string>(); // mints with a sell order in flight
let probeCount = 0;
let lastProbeSlot = -1_000_000;
let batchesSeen = 0;
let nextSweep = SWEEP_EVERY_BATCHES;

// Price now, in bps of the create price, from bigint cross-multiplication:
// (vq / vt) / (vq0 / vt0) * 10_000. No floats ever enter a decision.
function priceVsCreateBps(vq: bigint, vt: bigint, vq0: bigint, vt0: bigint): bigint {
  if (vt <= 0n || vq0 <= 0n || vt0 <= 0n) return 0n;
  return (vq * vt0 * BPS) / (vt * vq0);
}

// What selling `tokens` against (vq, vt) would pay, after curve fees.
function sellProceeds(tokens: bigint, vq: bigint, vt: bigint): bigint {
  if (tokens <= 0n || vt <= 0n) return 0n;
  const gross = (tokens * vq) / (vt + tokens);
  return gross - (gross * CURVE_FEE_BPS + BPS - 1n) / BPS;
}

// Fold one batch of events into the per-coin notes. Only the batch's own
// events are touched, so the work per slot stays proportional to that slot.
function absorbEvents(batch: Batch, slot: number): void {
  for (const event of batch.events) {
    if (event.event === "CreateEvent") {
      coins.set(event.mint, {
        creator: event.creator,
        createdSlot: event.slot,
        createVq: BigInt(event.virtual_quote_reserves),
        createVt: BigInt(event.virtual_token_reserves),
        peakBps: BPS,
        devBuy: 0n,
        devSold: false,
        bigSellBps: 0n,
        lastTradeSlot: event.slot,
        bought: false,
        done: false,
      });
      continue;
    }
    if (event.event === "TradeEvent") {
      const note = coins.get(event.mint);
      if (note === undefined) continue;
      note.lastTradeSlot = event.slot;
      const sol = BigInt(event.sol_amount);
      if (event.user === note.creator) {
        if (event.is_buy) {
          if (event.slot === note.createdSlot) note.devBuy += sol;
        } else {
          note.devSold = true;
        }
      } else if (!event.is_buy) {
        // A single outsider dumping hard is a rug signal: remember the worst.
        const before = BigInt(event.real_quote_reserves) + sol;
        if (before > 0n) {
          const bps = (sol * BPS) / before;
          if (bps > note.bigSellBps) note.bigSellBps = bps;
        }
      }
      continue;
    }
    // CompleteEvent: the curve migrated, the coin is done.
    const note = coins.get(event.mint);
    if (note !== undefined) note.done = true;
  }
}

// Refresh each tracked coin's peak price from the latest known reserves.
// Marks only cover held or pending mints, so fall back to the curve table.
function refreshPeaks(state: BotState): void {
  for (const [mint, note] of coins) {
    if (note.done) continue;
    const curve = state.curves.get(mint);
    if (curve === undefined || curve.complete) continue;
    const now = priceVsCreateBps(
      curve.virtual_quote_reserves,
      curve.virtual_token_reserves,
      note.createVq,
      note.createVt,
    );
    if (now > note.peakBps) note.peakBps = now;
  }
}

function hasPendingBuy(state: BotState, mint: string): boolean {
  for (const p of state.pending.values()) {
    if (p.order.mint === mint && p.order.side === "buy") return true;
  }
  return false;
}

function hasPendingSell(state: BotState, mint: string): boolean {
  for (const p of state.pending.values()) {
    if (p.order.mint === mint && p.order.side === "sell") return true;
  }
  return false;
}

// Drop coin records that can never be bought again: old, unheld, unbought.
function pruneStale(slot: number, held: (mint: string) => boolean): void {
  for (const [mint, note] of coins) {
    if (slot - note.createdSlot > PRUNE_AFTER_SLOTS && !held(mint) && !note.bought) {
      coins.delete(mint);
    }
  }
}

// One batch, one reply: exits first, then dip entries, then a paced probe.
// The reply's orders are decided on this slot's data and fill two slots
// later, so every exit uses the latest reserves the batch carried.
function decideOrders(state: BotState, batch: Batch): OrderInput[] {
  absorbEvents(batch, state.slot);
  refreshPeaks(state);
  const orders: OrderInput[] = [];
  const txFee = state.txFeeLamports();
  const cap = state.hello.caps.max_orders_per_batch;
  const room = Math.min(cap, MAX_ORDERS_PER_BATCH);

  // Keep the open-position notes in step with the harness account.
  for (const fill of batch.fills) {
    if (fill.client_id.startsWith("_")) {
      opened.delete(fill.mint);
      selling.delete(fill.mint);
      continue;
    }
    const note = opened.get(fill.mint);
    if (fill.status === "filled" && fill.side === "buy" && note === undefined) {
      opened.set(fill.mint, {
        openedSlot: fill.slot,
        cost: 0n, // filled in below from the account snapshot
        txPaid: BigInt(fill.tx_fee_lamports),
      });
    } else if (note !== undefined) {
      note.txPaid += BigInt(fill.tx_fee_lamports);
    }
  }
  for (const [mint, pos] of state.positions) {
    const note = opened.get(mint);
    if (note === undefined) {
      opened.set(mint, { openedSlot: state.slot, cost: BigInt(pos.cost_lamports), txPaid: txFee });
    } else {
      note.cost = BigInt(pos.cost_lamports);
    }
  }
  for (const mint of [...opened.keys()]) {
    if (!state.positions.has(mint) && !selling.has(mint) && !hasPendingBuy(state, mint)) {
      opened.delete(mint);
    }
  }
  for (const mint of [...selling]) {
    if (!hasPendingSell(state, mint)) selling.delete(mint);
  }

  // --- exits ---------------------------------------------------------------
  for (const [mint, pos] of state.positions) {
    if (orders.length >= room) break;
    if (selling.has(mint)) continue;
    const curve = state.curves.get(mint);
    if (curve === undefined || curve.complete) continue;
    const note = opened.get(mint);
    if (note === undefined) continue;
    const value = sellProceeds(pos.token_amount, curve.virtual_quote_reserves, curve.virtual_token_reserves) - txFee;
    const basis = note.cost + note.txPaid;
    if (basis <= 0n) continue;
    const coin = coins.get(mint);
    let leave = false;
    if (value * BPS >= basis * TAKE_PROFIT_BPS) leave = true;
    if (value * BPS <= basis * STOP_LOSS_BPS) leave = true;
    if (state.slot - note.openedSlot >= MAX_HOLD_SLOTS) leave = true;
    if (coin !== undefined) {
      if (coin.devSold) leave = true;
      if (state.slot - coin.lastTradeSlot >= STALE_SLOTS) leave = true;
    }
    if (!leave) continue;
    orders.push({ side: "sell", mint, token_amount: pos.token_amount, max_slippage_bps: SELL_SLIPPAGE_BPS });
    selling.add(mint);
    if (coin !== undefined) coin.done = true;
  }

  // --- entries -------------------------------------------------------------
  let free = state.freeCashLamports();
  let open = state.committedPositionCount();
  const maxOpen = state.hello.caps.max_open_positions;
  for (const [mint, coin] of coins) {
    if (orders.length >= room) break;
    if (coin.done || coin.bought) continue;
    const curve = state.curves.get(mint);
    if (curve === undefined || curve.complete) continue;
    const age = state.slot - coin.createdSlot;
    const nowBps = priceVsCreateBps(
      curve.virtual_quote_reserves,
      curve.virtual_token_reserves,
      coin.createVq,
      coin.createVt,
    );

    // Dip buy: proven runner, pulled back from its peak, creator still in.
    if (age >= DIP_MIN_AGE && age <= DIP_MAX_AGE && open < maxOpen) {
      const realSol = curve.real_quote_reserves;
      const dipReady =
        coin.peakBps >= DIP_MIN_RUNUP_BPS &&
        nowBps >= DIP_MIN_ABOVE_CREATE_BPS &&
        nowBps * BPS <= coin.peakBps * DIP_PULLBACK_BPS &&
        !coin.devSold &&
        coin.bigSellBps <= DIP_MAX_BIG_SELL_BPS &&
        realSol >= DIP_REAL_MIN &&
        realSol <= DIP_REAL_MAX;
      if (dipReady) {
        const capBuy = state.maxBuyLamports(mint);
        const amount = DIP_STAKE < capBuy ? DIP_STAKE : capBuy;
        if (amount >= SOL / 100n && free >= amount + txFee) {
          orders.push({ side: "buy", mint, quote_lamports: amount, max_slippage_bps: BUY_SLIPPAGE_BPS });
          free -= amount + txFee;
          coin.bought = true;
          open += 1;
          continue;
        }
      }
    }

    // Probe buy: a fresh coin on a loose screen, paced so probes stay a
    // minority of the book and the 20-coin guardrail is still met.
    if (
      probeCount < PROBE_MAX &&
      state.slot - lastProbeSlot >= PROBE_EVERY_SLOTS &&
      age <= PROBE_MAX_AGE &&
      open < maxOpen
    ) {
      const realSol = curve.real_quote_reserves;
      const probeReady =
        !coin.devSold &&
        coin.devBuy <= PROBE_DEV_MAX &&
        realSol >= PROBE_REAL_MIN &&
        realSol <= PROBE_REAL_MAX &&
        nowBps >= PROBE_RUNUP_MIN_BPS &&
        nowBps <= PROBE_RUNUP_MAX_BPS;
      if (probeReady) {
        const capBuy = state.maxBuyLamports(mint);
        const amount = PROBE_STAKE < capBuy ? PROBE_STAKE : capBuy;
        if (amount >= SOL / 100n && free >= amount + txFee) {
          orders.push({ side: "buy", mint, quote_lamports: amount, max_slippage_bps: BUY_SLIPPAGE_BPS });
          free -= amount + txFee;
          coin.bought = true;
          probeCount += 1;
          lastProbeSlot = state.slot;
          open += 1;
        }
      }
    }
  }

  batchesSeen += 1;
  if (batchesSeen >= nextSweep) {
    nextSweep = batchesSeen + SWEEP_EVERY_BATCHES;
    pruneStale(state.slot, (mint) => state.positions.has(mint));
  }
  return orders;
}

await runBot({
  onBatch: (state, batch) => decideOrders(state, batch),
});
