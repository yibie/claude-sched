# sched

Scheduled prompts for Claude Code. Add a prompt with a time in plain language or a cron expression, and it is submitted to Claude at that time in any interactive session open in the same directory. Jobs are kept in the plugin store, so they survive restarts and have no expiry.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install sched --marketplace yibie/claude-sched
```

Answer `y` to add the marketplace, then pick a scope (user scope loads it in every session).

From a shell:

```
claude plugin install sched --marketplace yibie/claude-sched
```

In the desktop app: click + next to the prompt box, then Plugins, Add marketplace with `yibie/claude-sched`, then Add plugin.

## Usage

Say when in plain language, in any language, or give a cron expression:

```
/sched add every weekday at 9am check the build status
/sched add 每天早上 9 点 13 分 跑游戏监控并汇报
/sched add tomorrow at 3pm retry the failed upload
/sched add "13 9 * * *" summarize yesterday's error log
/sched add --no-catchup every 2 hours check the queue
/sched list            # jobs for this directory
/sched list all        # jobs for every directory
/sched run <id>        # fire a job now
/sched pause <id> | resume <id> | rm <id>
```

A plain-language time is read by one small model call (Haiku) through your own Claude Code session, so it uses a little of your usage. The model only picks out the time phrase and turns it into cron; the task is the rest of what you typed, kept word for word. The reply shows how the time was read and the next run, so a misreading is easy to spot: `/sched rm <id>` and add it again. A one-time time ("tomorrow at 3pm") fires once and then removes the job.

Cron has 5 fields (minute hour day-of-month month day-of-week) in local time. It supports `*`, lists (`1,15`), ranges (`1-5`) and steps (`*/10`). Day-of-week 0 and 7 are both Sunday. A cron expression is used as is, with no model call.

## How it behaves

- **Per directory.** A job fires only in a session whose working directory is the one it was added in.
- **Needs an open session.** Nothing runs while Claude Code is closed. A slot missed while no session was open fires once when you next open one in that directory, however many slots were missed. Add `--no-catchup` to skip missed slots instead.
- **Once per slot.** With several sessions open in the same directory, the first one to see a slot claims it; the others skip it.
- **Queued, not interrupting.** The prompt is submitted as you, prefixed with `[Scheduled prompt <id>, slot ...]`. If Claude is busy, it waits for the current turn to end.
- **Status line** shows the next upcoming job for the directory.

A scheduled prompt runs with the same permissions as anything you type, so only schedule prompts you would be comfortable running unattended.

## License

MIT
