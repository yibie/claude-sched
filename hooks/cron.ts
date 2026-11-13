// Five-field cron matching (minute hour day-of-month month day-of-week),
// evaluated in local wall-clock time given as a UTC offset in minutes.
// Supports *, lists (1,15), ranges (1-5), steps (*/10, 0-30/5).
// Day-of-week 0-7, both 0 and 7 are Sunday. When both day fields are
// restricted, a day matches if either one does (standard cron behaviour).

export type Cron = {
  minute: Set<number>
  hour: Set<number>
  dom: Set<number>
  month: Set<number>
  dow: Set<number>
  domAny: boolean
  dowAny: boolean
}

function parseField(text: string, [lo, hi]: [number, number]): Set<number> {
  const out = new Set<number>()
  for (const part of text.split(',')) {
    const m = /^(?:(\*)|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part)
    if (!m) throw new Error(`bad cron field "${text}"`)
    const [, star, a, b, stepText] = m
    const step = stepText === undefined ? 1 : Number(stepText)
    if (step < 1) throw new Error(`bad step in "${text}"`)
    let from = lo
    let to = hi
    if (star === undefined) {
      from = Number(a)
      to = b !== undefined ? Number(b) : stepText === undefined ? from : hi
    }
    if (from < lo || to > hi || from > to) {
      throw new Error(`"${text}" is out of range ${lo}-${hi}`)
    }
    for (let v = from; v <= to; v += step) out.add(v)
  }
  return out
}

export function parseCron(expr: string): Cron {
  const fields = expr.trim().split(/\s+/)
  if (fields.length !== 5) {
    throw new Error(`cron needs 5 fields, got ${fields.length}: "${expr}"`)
  }
  const [f0 = '', f1 = '', f2 = '', f3 = '', f4 = ''] = fields
  const dowRaw = parseField(f4, [0, 7])
  return {
    minute: parseField(f0, [0, 59]),
    hour: parseField(f1, [0, 23]),
    dom: parseField(f2, [1, 31]),
    month: parseField(f3, [1, 12]),
    dow: new Set([...dowRaw].map(d => (d === 7 ? 0 : d))),
    domAny: f2 === '*',
    dowAny: f4 === '*',
  }
}

const MINUTE = 60_000

/** True when the minute starting at `epochMs` matches, in local time. */
export function matches(cron: Cron, epochMs: number, offsetMin: number): boolean {
  const d = new Date(epochMs + offsetMin * MINUTE)
  if (!cron.minute.has(d.getUTCMinutes())) return false
  if (!cron.hour.has(d.getUTCHours())) return false
  if (!cron.month.has(d.getUTCMonth() + 1)) return false
  const domOk = cron.dom.has(d.getUTCDate())
  const dowOk = cron.dow.has(d.getUTCDay())
  if (cron.domAny && cron.dowAny) return true
  if (cron.domAny) return dowOk
  if (cron.dowAny) return domOk
  return domOk || dowOk
}

/** The latest matching minute at or before `nowMs`, within `lookbackMin`. */
export function lastMatch(
  cron: Cron,
  nowMs: number,
  offsetMin: number,
  lookbackMin = 8 * 24 * 60,
): number | undefined {
  let t = Math.floor(nowMs / MINUTE) * MINUTE
  for (let i = 0; i <= lookbackMin; i++, t -= MINUTE) {
    if (matches(cron, t, offsetMin)) return t
  }
  return undefined
}

/** The first matching minute after `nowMs`, within `lookaheadMin`. */
export function nextMatch(
  cron: Cron,
  nowMs: number,
  offsetMin: number,
  lookaheadMin = 366 * 24 * 60,
): number | undefined {
  let t = (Math.floor(nowMs / MINUTE) + 1) * MINUTE
  for (let i = 0; i < lookaheadMin; i++, t += MINUTE) {
    if (matches(cron, t, offsetMin)) return t
  }
  return undefined
}

/** `date +%z` output such as "+0800" or "-0800" to minutes east of UTC. */
export function parseOffset(text: string): number {
  const m = /^([+-])(\d{2})(\d{2})$/.exec(text.trim())
  if (!m) return 0
  const minutes = Number(m[2]) * 60 + Number(m[3])
  return m[1] === '-' ? -minutes : minutes
}

/** Local "YYYY-MM-DD HH:MM" for display. */
export function formatLocal(epochMs: number, offsetMin: number): string {
  const d = new Date(epochMs + offsetMin * MINUTE)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
}
