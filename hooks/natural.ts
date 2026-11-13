import { parseCron } from './cron.ts'

// Natural-language schedules ("every weekday at 9am check the build",
// "每天早上 9 点 13 分 跑游戏监控") are turned into a cron expression by one
// small model call. The model only names which characters of the input are
// the time phrase; the prompt is whatever is left, taken from the input
// verbatim, so the model can never reword the task.

export const NL_SYSTEM = `You turn a scheduling request, written in any language, into a 5-field cron expression in the user's local time.
The request is a time phrase plus a task. Reply with one JSON object and nothing else:
{"schedule": "<the characters of the request that say when, copied exactly>", "cron": "<minute hour day-of-month month day-of-week>", "once": <true only for a single occurrence such as "tomorrow at 3pm" or "on Nov 20 at 10:00", else false>, "summary": "<when, in a few English words>"}
If the request says no recognizable time, reply {"error": "<why, in a few words>"}.
Rules: day-of-week 0 is Sunday. A time with no minute means minute 0. "morning" with no hour is 9:00, "noon" 12:00, "afternoon" 15:00, "evening" 18:00, "night" 21:00. "every N hours" is "0 */N * * *". For a one-time date fill day-of-month and month. "schedule" never includes the task.`

export function buildNlPrompt(input: string, nowLocal: string, weekday: string): string {
  return `Now (local time): ${nowLocal}, ${weekday}.\nRequest:\n<<<\n${input}\n>>>`
}

export type NlParse =
  | { ok: true; cron: string; prompt: string; once: boolean; summary: string; schedule: string }
  | { ok: false; error: string }

const SEPARATORS = /[\s,，:：;；、]+/

/** Checks the model's reply against the input and splits off the prompt. */
export function interpretReply(reply: string, input: string): NlParse {
  const start = reply.indexOf('{')
  const end = reply.lastIndexOf('}')
  if (start < 0 || end <= start) return { ok: false, error: 'the model did not reply with JSON' }
  let data: Record<string, unknown>
  try {
    data = JSON.parse(reply.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    return { ok: false, error: 'the model replied with invalid JSON' }
  }
  if (typeof data.error === 'string') return { ok: false, error: data.error }

  const schedule = typeof data.schedule === 'string' ? data.schedule.trim() : ''
  const cron = typeof data.cron === 'string' ? data.cron.trim() : ''
  if (!schedule || !cron) return { ok: false, error: 'the model left out the time phrase or the cron' }
  const at = input.indexOf(schedule)
  if (at < 0) return { ok: false, error: `the model named a time phrase that is not in the input: "${schedule}"` }
  try {
    parseCron(cron)
  } catch (err) {
    return { ok: false, error: `the model produced a bad cron "${cron}": ${(err as Error).message}` }
  }

  const before = input.slice(0, at).replace(new RegExp(`${SEPARATORS.source}$`), '')
  const after = input.slice(at + schedule.length).replace(new RegExp(`^${SEPARATORS.source}`), '')
  const prompt = [before, after].filter(Boolean).join(' ').trim()
  if (!prompt) return { ok: false, error: 'no task left after the time phrase' }

  return {
    ok: true,
    cron,
    prompt,
    once: data.once === true,
    summary: typeof data.summary === 'string' ? data.summary : '',
    schedule,
  }
}

/** A leading cron expression, quoted or as the first five words, if there is one. */
export function leadingCron(body: string): { cron: string; prompt: string } | undefined {
  const quoted = /^(["'])(.+?)\1\s+([\s\S]+)$/.exec(body)
  if (quoted) {
    const cron = quoted[2] ?? ''
    try {
      parseCron(cron)
      return { cron, prompt: (quoted[3] ?? '').trim() }
    } catch {
      return undefined
    }
  }
  const tokens = body.split(/\s+/)
  if (tokens.length < 6) return undefined
  const cron = tokens.slice(0, 5).join(' ')
  try {
    parseCron(cron)
  } catch {
    return undefined
  }
  return { cron, prompt: tokens.slice(5).join(' ').trim() }
}
