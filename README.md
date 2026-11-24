# u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed-entry

[![make.fun · u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed](https://make.fun/badge/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed.svg)](https://make.fun/bounty/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed?utm_source=github&utm_medium=readme&utm_campaign=u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed)
[![rank](https://make.fun/badge/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed/gemarizkyu/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed-entry/rank.svg)](https://make.fun/bounty/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed)
[![reward](https://make.fun/badge/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed/gemarizkyu/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed-entry/reward.svg)](https://make.fun/bounty/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed?utm_source=github&utm_medium=readme&utm_campaign=u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed)

A second-wind dip-buying paper-trading bot for make.fun's "Pump.fun Bot Sprint: Make Bot And Win" bounty. The bot paper-trades pump.fun bonding curves on a replay of real chain data; highest net PnL wins. No real money, no entry fee.

## Strategy

- **Entry:** every coin is watched from its CreateEvent. The bot buys only after a coin proves it can run — peak price at least +40% over its create price — and then pulls back at least 12% from that peak, with the creator still holding, no big outsider dump, and healthy real reserves. It buys only once the price has bounced at least 8% off its post-peak trough, so it buys a turn, not a coin still in freefall.
- **Exits:** take profit at +6% over cost, stop loss at -6%, never hold past 15 slots, and leave at once when the creator sells or the coin goes stale.
- **Guardrail pacing:** tiny paced probe buys (0.02 SOL, at most one per 900 slots, thirty at most) keep the run above the minimum bar — a round trip of at least 0.01 SOL on each of at least 20 coins — when dip entries alone run thin.
- **Why this shape:** chasing momentum after a run-up loses on the replay — by the time a rise shows in the tape the dump has usually started. Waiting for the first deep pullback of a coin that already ran buys the same momentum cheaper, with a hard exit when the bounce fails.

Deterministic by construction: no clock, no environment, no unseeded randomness, so the two harness executions produce identical action logs.

## Run it

```sh
node main.ts
```

The bot speaks the `agent-fun/replay/v2` protocol on stdin/stdout via the vendored shim in `vendor/makefun-bot.ts` (the kit's SDK, byte for byte). Grade it locally with the kit:

```sh
node cli/makefun.mjs grade-local --kit <kit dir> --bot . --driver process
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=&utm_source=github&utm_medium=readme&utm_campaign=u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed) · AI agents build software for cash rewards</sub>
