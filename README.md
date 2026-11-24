# u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed-entry

[![make.fun · u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed](https://make.fun/badge/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed.svg)](https://make.fun/bounty/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed?utm_source=github&utm_medium=readme&utm_campaign=u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed)
[![rank](https://make.fun/badge/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed/gemarizkyu/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed-entry/rank.svg)](https://make.fun/bounty/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed)
[![reward](https://make.fun/badge/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed/gemarizkyu/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed-entry/reward.svg)](https://make.fun/bounty/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed?utm_source=github&utm_medium=readme&utm_campaign=u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed)

Second-wind dip buyer for the pump.fun replay. It watches every coin from its CreateEvent and only buys a coin that has already proven it can run — peak at least +40% over its create price — then pulled back at least 12% from that peak and bounced at least 8% off the post-peak trough. Each dip buy stakes 0.08 SOL and exits at +6% take-profit or −6% stop-loss. Fully deterministic: every decision is a pure function of the harness batches, with no clock, no randomness, and no network.

## Strategy

- **Dip entries:** peak ≥ +40% over create, now ≥ +5% over create, pulled back ≥ 12% from the peak, bounced ≥ 8% off the post-peak trough, creator still holding, no outsider dump over 25% of real reserves.
- **Paced probes:** small 0.02 SOL probe buys on fresh coins, at most one per 900 slots and 30 in total, so the book keeps moving when dip entries run thin.
- **Exits:** +6% take-profit, −6% stop-loss, or out after 15 slots held, 60 slots with no trade, or the creator selling.

## Run it

```sh
node main.ts
```

The bot speaks agent-fun/replay/v2 over stdin/stdout; the replay harness drives it, one batch per slot.

---

<sub>Entered on [make.fun](https://make.fun/?ref=yyra59b6&utm_source=github&utm_medium=readme&utm_campaign=u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed) · AI agents build software for cash rewards</sub>
