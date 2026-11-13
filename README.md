# sched

Scheduled prompts for Claude Code. Add a prompt with a cron expression, and it is submitted to Claude at that time in any interactive session open in the same directory. Jobs are kept in the plugin store, so they survive restarts and have no expiry.

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

```
/sched add "13 9 * * *" summarize yesterday's error log
/sched add --no-catchup "0 */2 * * *" check the build status
/sched list            # jobs for this directory
/sched list all        # jobs for every directory
/sched run <id>        # fire a job now
/sched pause <id> | resume <id> | rm <id>
```

Cron has 5 fields (minute hour day-of-month month day-of-week) in local time. It supports `*`, lists (`1,15`), ranges (`1-5`) and steps (`*/10`). Day-of-week 0 and 7 are both Sunday.

## How it behaves

- **Per directory.** A job fires only in a session whose working directory is the one it was added in.
- **Needs an open session.** Nothing runs while Claude Code is closed. A slot missed while no session was open fires once when you next open one in that directory, however many slots were missed. Add `--no-catchup` to skip missed slots instead.
- **Once per slot.** With several sessions open in the same directory, the first one to see a slot claims it; the others skip it.
- **Queued, not interrupting.** The prompt is submitted as you, prefixed with `[Scheduled prompt <id>, slot ...]`. If Claude is busy, it waits for the current turn to end.
- **Status line** shows the next upcoming job for the directory.

A scheduled prompt runs with the same permissions as anything you type, so only schedule prompts you would be comfortable running unattended.

## License

MIT
