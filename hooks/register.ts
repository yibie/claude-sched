import type { Register } from 'claude-code'
import { formatLocal, lastMatch, nextMatch, parseCron, parseOffset } from './cron.ts'
import { buildNlPrompt, interpretReply, leadingCron, NL_SYSTEM } from './natural.ts'

// Scheduled prompts, kept in the plugin store so they outlive the session.
// A job belongs to the directory it was added in and fires only in an
// interactive session running there. A slot missed while no such session was
// open fires once when one opens, unless the job was added with --no-catchup.

type Job = {
  id: string
  cron: string
  prompt: string
  cwd: string
  createdAt: number
  lastFired?: number
  paused?: boolean
  catchUp: boolean
  /** Fire one time, then remove the job. */
  once?: boolean
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const KEY = 'jobs'
const MINUTE = 60_000
const ON_TIME_MS = 2 * MINUTE

const HELP = [
  'Usage:',
  '  /sched add [--no-catchup] <when> <prompt>                 add a job for this directory',
  '      <when> is plain language ("every weekday at 9am", "tomorrow 3pm", "每天 9:13")',
  '      or a cron expression ("13 9 * * *")',
  '  /sched list                                             jobs for this directory',
  '  /sched list all                                         jobs for every directory',
  '  /sched run <id>                                         fire a job now',
  '  /sched pause <id> | resume <id> | rm <id>',
  'Cron is local time, 5 fields: "13 9 * * *" = every day 09:13.',
].join('\n')

function newId(): string {
  return Math.random().toString(36).slice(2, 8)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    if (!e.isInteractive) return started

    const cwd = e.cwd

    const load = async (): Promise<Job[]> => ((await $.store.get(KEY)) as Job[] | undefined) ?? []
    const save = (jobs: Job[]) => $.store.set(KEY, jobs)
    const offset = async (): Promise<number> => {
      try {
        const { stdout } = await $.process.run(['date', '+%z'])
        return parseOffset(stdout)
      } catch {
        return 0
      }
    }

    const fire = async (job: Job, slot: number | undefined, late: boolean, off: number) => {
      const when = slot === undefined ? 'manual run' : `slot ${formatLocal(slot, off)}${late ? ', catch-up' : ''}`
      $.ui.toast(`sched: firing ${job.id}`)
      await $.prompt.submit({
        text: `[Scheduled prompt ${job.id}, ${when}]\n${job.prompt}`,
        asUser: true,
      })
    }

    const updateStatus = async (off: number) => {
      const now = await $.clock.now()
      const upcoming = (await load())
        .filter(j => j.cwd === cwd && !j.paused)
        .map(j => ({ j, at: nextMatch(parseCron(j.cron), now, off) }))
        .filter((x): x is { j: Job; at: number } => x.at !== undefined)
        .sort((a, b) => a.at - b.at)[0]
      $.ui.status(upcoming ? `sched: next ${formatLocal(upcoming.at, off).slice(5)} (${upcoming.j.id})` : undefined)
    }

    let busy = false
    const tick = async () => {
      if (busy) return
      busy = true
      try {
        const off = await offset()
        const now = await $.clock.now()
        for (const job of await load()) {
          if (job.cwd !== cwd || job.paused) continue
          let cron
          try {
            cron = parseCron(job.cron)
          } catch {
            continue
          }
          const slot = lastMatch(cron, now, off)
          if (slot === undefined || slot <= (job.lastFired ?? job.createdAt)) continue

          // Claim the slot: re-read so a second open session in the same
          // directory sees it taken and does not fire it again.
          const fresh = await load()
          const mine = fresh.find(j => j.id === job.id)
          if (!mine || slot <= (mine.lastFired ?? mine.createdAt)) continue
          mine.lastFired = slot
          await save(mine.once ? fresh.filter(j => j !== mine) : fresh)

          const late = now - slot > ON_TIME_MS
          if (late && !job.catchUp) continue
          await fire(job, slot, late, off)
        }
        await updateStatus(off)
      } finally {
        busy = false
      }
    }

    await $.command.register({
      name: 'sched',
      description: 'Scheduled prompts: add, list, run, pause, resume, rm',
      argumentHint: 'add "<cron>" <prompt> | list | run|pause|resume|rm <id>',
    })

    void tick()
    $.clock.every(MINUTE, () => void tick())
    return started
  })

  on('command.run', { command: 'sched' }, async ($, e) => {
    const cwd = await $.session.cwd()
    const raw = e.args.trim()
    const [sub = 'list', ...restParts] = raw.split(/\s+/)
    const rest = raw.slice(sub.length).trim()
    const jobs = ((await $.store.get(KEY)) as Job[] | undefined) ?? []
    let off = 0
    try {
      off = parseOffset((await $.process.run(['date', '+%z'])).stdout)
    } catch {}
    const now = await $.clock.now()

    const describe = (j: Job) => {
      let next = 'invalid cron'
      try {
        const at = nextMatch(parseCron(j.cron), now, off)
        next = at === undefined ? 'never' : formatLocal(at, off)
      } catch {}
      const last = j.lastFired ? formatLocal(j.lastFired, off) : '-'
      const flags = [j.paused ? 'paused' : '', j.catchUp ? '' : 'no-catchup', j.once ? 'once' : '']
        .filter(Boolean)
        .join(',')
      return `${j.id}  "${j.cron}"  next ${next}  last ${last}${flags ? `  [${flags}]` : ''}\n    ${j.cwd}\n    ${j.prompt.length > 120 ? j.prompt.slice(0, 117) + '...' : j.prompt}`
    }
    const find = (id: string | undefined) => jobs.find(j => j.id === id)

    switch (sub) {
      case 'add': {
        let body = rest
        let catchUp = true
        if (body.startsWith('--no-catchup')) {
          catchUp = false
          body = body.slice('--no-catchup'.length).trim()
        }
        if (!body) return { text: HELP }

        const direct = leadingCron(body)
        if (direct) {
          if (!direct.prompt) return { text: `Missing prompt.\n\n${HELP}` }
          const job: Job = { id: newId(), cron: direct.cron, prompt: direct.prompt, cwd, createdAt: now, catchUp }
          await $.store.set(KEY, [...jobs, job])
          return { text: `Added:\n${describe(job)}` }
        }

        // Not a cron expression: let a small model read the time phrase.
        const local = new Date(now + off * MINUTE)
        const reply = await $.model.complete({
          model: 'haiku',
          system: NL_SYSTEM,
          prompt: buildNlPrompt(body, formatLocal(now, off), WEEKDAYS[local.getUTCDay()] ?? ''),
          maxTokens: 300,
          effort: 'low',
        })
        if (!reply.isAnswered) {
          return { text: `Could not read the schedule (model call failed: ${reply.reason}). Use a cron expression instead.\n\n${HELP}` }
        }
        const parsed = interpretReply(reply.text, body)
        if (!parsed.ok) return { text: `Could not read the schedule: ${parsed.error}.\n\n${HELP}` }

        const job: Job = {
          id: newId(),
          cron: parsed.cron,
          prompt: parsed.prompt,
          cwd,
          createdAt: now,
          catchUp,
          ...(parsed.once ? { once: true } : {}),
        }
        await $.store.set(KEY, [...jobs, job])
        return {
          text: `Read "${parsed.schedule}" as ${parsed.summary || parsed.cron} (cron "${parsed.cron}"${parsed.once ? ', once' : ''}).\nAdded:\n${describe(job)}\nWrong? /sched rm ${job.id} and add it again.`,
        }
      }
      case 'list': {
        const all = restParts[0] === 'all'
        const shown = all ? jobs : jobs.filter(j => j.cwd === cwd)
        if (shown.length === 0) return { text: all ? 'No scheduled prompts.' : `No scheduled prompts for ${cwd}. Use "/sched list all" to see every directory.` }
        return { text: shown.map(describe).join('\n') }
      }
      case 'rm': {
        const job = find(restParts[0])
        if (!job) return { text: `No job "${restParts[0] ?? ''}".` }
        await $.store.set(KEY, jobs.filter(j => j !== job))
        return { text: `Removed ${job.id}.` }
      }
      case 'pause':
      case 'resume': {
        const job = find(restParts[0])
        if (!job) return { text: `No job "${restParts[0] ?? ''}".` }
        job.paused = sub === 'pause'
        // Resuming should not replay slots missed while paused.
        if (!job.paused) job.lastFired = now
        await $.store.set(KEY, jobs)
        return { text: `${sub === 'pause' ? 'Paused' : 'Resumed'} ${job.id}.` }
      }
      case 'run': {
        const job = find(restParts[0])
        if (!job) return { text: `No job "${restParts[0] ?? ''}".` }
        await $.prompt.submit({ text: `[Scheduled prompt ${job.id}, manual run]\n${job.prompt}`, asUser: true })
        return { text: `Queued ${job.id}.` }
      }
      default:
        return { text: HELP }
    }
  })
}
