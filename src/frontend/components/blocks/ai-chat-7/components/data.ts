export type ModelRecord = {
  id: string
  name: string
  provider: string
  /** Context window in tokens. The view formats it and the header meter
      measures the prompt against it, so the number is the only truth. */
  contextTokens: number
  /** List price in dollars per million tokens. */
  priceIn: number
  priceOut: number
  /** True while the workspace is over its per minute quota on this provider. */
  rateLimited?: boolean
}

export const MODELS: ModelRecord[] = [
  {
    id: "claude-opus-5",
    name: "Claude Opus 5",
    provider: "Anthropic",
    contextTokens: 200_000,
    priceIn: 15,
    priceOut: 75,
  },
  {
    id: "claude-sonnet-5",
    name: "Claude Sonnet 5",
    provider: "Anthropic",
    contextTokens: 200_000,
    priceIn: 3,
    priceOut: 15,
  },
  {
    id: "claude-haiku-4-5",
    name: "Claude Haiku 4.5",
    provider: "Anthropic",
    contextTokens: 200_000,
    priceIn: 1,
    priceOut: 5,
  },
  {
    id: "gpt-5-1",
    name: "GPT-5.1",
    provider: "OpenAI",
    contextTokens: 256_000,
    priceIn: 1.25,
    priceOut: 10,
  },
  {
    id: "gemini-3-pro",
    name: "Gemini 3 Pro",
    provider: "Google",
    contextTokens: 1_000_000,
    priceIn: 2,
    priceOut: 12,
    rateLimited: true,
  },
  {
    id: "mistral-large",
    name: "Mistral Large",
    provider: "Mistral",
    contextTokens: 128_000,
    priceIn: 2,
    priceOut: 6,
  },
]

/** 200000 reads as "200K", 1000000 as "1M". */
export function formatContext(tokens: number) {
  if (tokens >= 1_000_000) return `${tokens / 1_000_000}M`
  return `${Math.round(tokens / 1000)}K`
}

/** Provider groups for the picker, derived so adding a model needs no second
    list to keep in step. */
export function modelsByProvider() {
  const groups: { provider: string; models: ModelRecord[] }[] = []
  for (const model of MODELS) {
    const group = groups.find((item) => item.provider === model.provider)
    if (group) group.models.push(model)
    else groups.push({ provider: model.provider, models: [model] })
  }
  return groups
}

export function modelById(id: string) {
  return MODELS.find((model) => model.id === id) ?? MODELS[0]
}

/** The pair the comparison opens on. These two answer the same question
    differently, which is the whole point of the screen. */
export const LEFT_MODEL_ID = "claude-sonnet-5"
export const RIGHT_MODEL_ID = "gpt-5-1"

export const VIEWER_NAME = "Priya Nair"

/** Shown beside the prompt: both panes read the same file. */
export const CONTEXT_FILE = "churn-aug.csv"
export const CONTEXT_ROWS = "18,402 rows"

/** What a rate limited provider returns before any tokens arrive. */
export const RATE_LIMIT = {
  code: "429",
  title: "Rate limited",
  detail:
    "This workspace is over 60 requests per minute on Google. The quota resets at 11:04.",
  /** Milliseconds before the gateway gives up and returns the error. */
  afterMs: 900,
}

export type TableColumn = {
  key: string
  label: string
  /** Right aligns the column and puts its digits on tabular-nums. */
  numeric?: boolean
  /** Summed into the footer. A median or a rate must never be totalled. */
  total?: boolean
}

export type TableRowRecord = Record<string, string | number>

export type MessagePart =
  | { kind: "text"; text: string }
  | { kind: "code"; language: string; code: string; filename?: string }
  | {
      kind: "table"
      /** Names what one row counts, so the footer total has a unit. */
      caption: string
      columns: TableColumn[]
      rows: TableRowRecord[]
    }

export type AnswerRecord = {
  parts: MessagePart[]
  /** Milliseconds to the first token and to the last one. */
  firstTokenMs: number
  latencyMs: number
  /** Prompt tokens, which grow by the previous turn on every follow up. */
  tokensIn: number
  tokensOut: number
  /** Named by the thinking row while the model is still reading. */
  activityLabel: string
  /** Reactions already on the answer when the thread loads. Your own like
      merges into these rather than replacing them. */
  reactions?: string[]
}

export type AttachmentRecord = {
  id: string
  name: string
  meta: string
}

/**
 * customize: what your file picker would return. These are the exports the
 * models themselves ask for when a question outruns churn-aug.csv.
 */
export const EXTRA_FILES: AttachmentRecord[] = [
  {
    id: "events",
    name: "product-events-aug.parquet",
    meta: "Parquet, 2.1M rows",
  },
  { id: "exit", name: "exit-survey-q3.csv", meta: "CSV, 118 responses" },
  { id: "renewals", name: "renewals-board.json", meta: "JSON, 64 records" },
]

export type TurnRecord = {
  id: string
  prompt: string
  at: string
  /** Attached alongside the pinned file, so a turn records what it could read. */
  files?: AttachmentRecord[]
  /** A line lifted out of one model's answer that this turn is asking about. */
  quote?: { text: string; from: string }
}

/** The conversation both panes answer. New sends append to it. */
export const SEED_TURNS: TurnRecord[] = [
  {
    id: "turn_1",
    at: "10:52",
    prompt:
      "attached churn-aug.csv, 18402 rows. team plan churn reads 4.1% for august vs 2.6 in july. confirm the number before we dig",
  },
  {
    id: "turn_2",
    at: "10:56",
    prompt:
      "ok, what's driving it? ranked drivers, not a summary. i present this thursday",
  },
]

/** Labels the top of the visible scrollback in both panes. */
export const SEPARATOR = "Today"

const COHORT_SQL = `select
  case
    when promo_code = 'SPRING40'   then 'promo_renewal'
    when seats_at_cancel < 5       then 'seat_floor'
    when exit_reason ilike '%sso%' then 'sso_gap'
    else 'no_signal'
  end as driver,
  count(*) as accounts,
  round(avg(days_since_seat_change), 1) as days
from churn_aug
where plan_tier = 'team'
  and cancelled_at >= date '2026-08-01'
group by 1
order by accounts desc;`

/**
 * Answers keyed on the terms a prompt carries, so a re-asked or edited prompt
 * still lands on a real answer instead of a placeholder.
 */
const ANSWER_LIBRARY: {
  match: string[]
  answers: Record<string, AnswerRecord>
}[] = [
  {
    match: ["confirm the number", "4.1%", "vs 2.6"],
    answers: {
      "claude-opus-5": {
        firstTokenMs: 900,
        latencyMs: 4200,
        tokensIn: 986,
        tokensOut: 268,
        activityLabel: "Reading churn-aug.csv",
        parts: [
          {
            kind: "text",
            text: "Confirmed, and there are two corrections to make before Thursday rather than one.\n\nThree of the 21 rows are workspaces under one parent account, `acct_4f19c2`, which cancelled once. Counted by customer that is 19 of 517, or 3.7 percent.\n\nSeparately, `cancelled_at` is stored in UTC while billing rolls at 17:00 Pacific. Two cancellations stamped Aug 1 belong to July and one stamped Sep 1 belongs to August.\n\nApply both and August is 18 of 517, or 3.48 percent, against July at 15 of 494, or 3.04 percent. The rise is real and it is roughly a third of the jump the dashboard is showing.",
          },
        ],
      },
      "claude-haiku-4-5": {
        firstTokenMs: 260,
        latencyMs: 900,
        tokensIn: 986,
        tokensOut: 74,
        activityLabel: "Reading churn-aug.csv",
        parts: [
          {
            kind: "text",
            text: "August is 21 of 517, or 4.06 percent. July is 13 of 494, or 2.63 percent. Both match the file.\n\nThree rows share one parent account, so by customer August is 19 of 517, or 3.7 percent.",
          },
        ],
      },
      "claude-sonnet-5": {
        firstTokenMs: 520,
        latencyMs: 2100,
        tokensIn: 986,
        tokensOut: 148,
        activityLabel: "Reading churn-aug.csv",
        reactions: ["\u{1F525}"],
        parts: [
          {
            kind: "text",
            text: "Confirmed at the account level: 21 cancellations against 517 team accounts active on Aug 1, so 4.06 percent.\n\nOne thing to fix before Thursday. Three of the 21 rows are workspaces under one parent account, `acct_4f19c2`, which cancelled once. Counted by customer it is 19 of 517, or 3.7 percent. July has no duplicates, so 2.63 percent stands.",
          },
        ],
      },
      "gpt-5-1": {
        firstTokenMs: 780,
        latencyMs: 2900,
        tokensIn: 998,
        tokensOut: 172,
        activityLabel: "Reading churn-aug.csv",
        parts: [
          {
            kind: "text",
            text: "4.1 percent is right for the definition the file uses and wrong for the one the dashboard uses.\n\nThe file counts accounts active on Aug 1, which is 517, giving 21 of 517 or 4.06 percent. The dashboard divides by the average account count across the month, which is 526, giving 3.99 percent. Both are defensible. They are not the same metric, so the slide should name which one it carries.\n\nSeparately, 17 rows have a null `plan_tier` and sit outside both. If four of those are team accounts the headline moves to 4.75 percent.",
          },
        ],
      },
      "gemini-3-pro": {
        firstTokenMs: 610,
        latencyMs: 2400,
        tokensIn: 972,
        tokensOut: 166,
        activityLabel: "Reading churn-aug.csv",
        parts: [
          {
            kind: "text",
            text: "The arithmetic holds. August is 21 of 517, or 4.06 percent. July is 13 of 494, or 2.63 percent.\n\nThe comparison does not. At 21 events the 95 percent interval on August runs from 2.4 to 5.8 percent, and July sits inside it. The honest line on Thursday is that August is not measurably different from July, not that churn rose 1.5 points.",
          },
        ],
      },
      "mistral-large": {
        firstTokenMs: 430,
        latencyMs: 1500,
        tokensIn: 990,
        tokensOut: 96,
        activityLabel: "Reading churn-aug.csv",
        parts: [
          {
            kind: "text",
            text: "Confirmed. August: 21 of 517, 4.06 percent. July: 13 of 494, 2.63 percent.\n\nThe delta is eight extra cancellations. Everything after this explains eight accounts, so keep the sample size on the slide.",
          },
        ],
      },
    },
  },
  {
    match: ["driving", "drivers", "why"],
    answers: {
      "claude-opus-5": {
        firstTokenMs: 1100,
        latencyMs: 6200,
        tokensIn: 1165,
        tokensOut: 934,
        activityLabel: "Grouping 21 cancellations",
        parts: [
          {
            kind: "text",
            text: "Ranked, with a column the other cuts leave out: how many of each group were still reachable when they cancelled.",
          },
          {
            kind: "table",
            caption: "August cancellations by driver, with reachable accounts",
            columns: [
              { key: "driver", label: "Driver" },
              {
                key: "accounts",
                label: "Accounts",
                numeric: true,
                total: true,
              },
              { key: "days", label: "Median days", numeric: true },
              {
                key: "reachable",
                label: "Reachable",
                numeric: true,
                total: true,
              },
            ],
            rows: [
              { driver: "Promo renewal", accounts: 9, days: 6, reachable: 9 },
              { driver: "Seat floor", accounts: 5, days: 11, reachable: 5 },
              { driver: "Missing SSO", accounts: 4, days: 19, reachable: 0 },
              { driver: "No signal", accounts: 3, days: 14, reachable: 0 },
            ],
          },
          {
            kind: "text",
            text: "Reachable means the invoice or the seat change gave you a dated warning before the cancellation. Fourteen of the 21 did, and all fourteen sit in the two billing driven groups.\n\nThe two also interact. Four of the five seat floor accounts were on SPRING40, so they took the discount, shed seats to stay under the new invoice, then fell through the floor. Counting them as separate causes double counts the same decision.\n\nFor Thursday I would lead with the fourteen, because that is the number you can act on before Q4.",
          },
        ],
      },
      "claude-haiku-4-5": {
        firstTokenMs: 300,
        latencyMs: 1400,
        tokensIn: 1117,
        tokensOut: 206,
        activityLabel: "Grouping 21 cancellations",
        parts: [
          {
            kind: "text",
            text: "Promo renewals 9, seat floor 5, missing SSO 4, no signal 3. That is the 21.\n\nThe promo group is the only one with a date you can get ahead of: the remaining SPRING40 renewals run through October.",
          },
        ],
      },
      "claude-sonnet-5": {
        firstTokenMs: 640,
        latencyMs: 3100,
        tokensIn: 1165,
        tokensOut: 612,
        activityLabel: "Grouping 21 cancellations",
        parts: [
          {
            kind: "text",
            text: "Ranked by share of the 21 cancellations.",
          },
          {
            kind: "table",
            caption: "August team plan cancellations by driver",
            columns: [
              { key: "driver", label: "Driver" },
              {
                key: "accounts",
                label: "Accounts",
                numeric: true,
                total: true,
              },
              { key: "days", label: "Median days", numeric: true },
            ],
            rows: [
              { driver: "Promo renewal", accounts: 9, days: 6 },
              { driver: "Seat floor", accounts: 5, days: 11 },
              { driver: "Missing SSO", accounts: 4, days: 19 },
              { driver: "No signal", accounts: 3, days: 14 },
            ],
          },
          {
            kind: "text",
            text: "All nine promo accounts signed in March on the six month discount and cancelled within days of the first full price invoice. The seat floor group dropped under five seats first, so the plan cancelled them rather than downgrading. Three of the four SSO accounts had opened a ticket in Q2.",
          },
          {
            kind: "code",
            language: "sql",
            filename: "churn-cohorts.sql",
            code: COHORT_SQL,
          },
          {
            kind: "text",
            text: "Run it against the same file and you should get 9, 5, 4 and 3. The promo cohort is the only one you can act on before Q4.",
          },
        ],
      },
      "gpt-5-1": {
        firstTokenMs: 910,
        latencyMs: 4600,
        tokensIn: 1202,
        tokensOut: 848,
        activityLabel: "Comparing against July",
        parts: [
          {
            kind: "text",
            text: "Ranking raw counts puts the promo cohort on top, and I think that is the wrong lead. July already carried six SPRING40 cancellations, the February signups hitting the same six month renewal. August has nine, the March signups. The cohort is arriving in two waves, not failing at a new rate.\n\nMeasured as excess over July, which is the only number that explains 2.6 becoming 4.1:",
          },
          {
            kind: "table",
            caption: "Cancellations by driver, July against August",
            columns: [
              { key: "driver", label: "Driver" },
              { key: "july", label: "July", numeric: true, total: true },
              { key: "august", label: "August", numeric: true, total: true },
              { key: "change", label: "Change", numeric: true, total: true },
            ],
            rows: [
              { driver: "Seat reductions", july: 1, august: 5, change: 4 },
              { driver: "Promo renewals", july: 6, august: 9, change: 3 },
              { driver: "Missing SSO", july: 3, august: 4, change: 1 },
              { driver: "No signal", july: 3, august: 3, change: 0 },
            ],
          },
          {
            kind: "text",
            text: "Seat reductions are the actual change, and every one of the five fell below five seats first. The promo delta shrinks as the cohort empties in October, and plus one on SSO is noise at this sample size whatever the exit survey says.\n\nOne caveat: the 17 null `plan_tier` rows are in none of these buckets. Worth resolving before the deck, because four team accounts in there move the headline past 4.7 percent.\n\nIf the seat floor is the driver, the fix is a packaging change rather than a save play, and that is a longer conversation than Thursday.",
          },
        ],
      },
      "gemini-3-pro": {
        firstTokenMs: 700,
        latencyMs: 3700,
        tokensIn: 1168,
        tokensOut: 501,
        activityLabel: "Bucketing 21 cancellations",
        parts: [
          {
            kind: "text",
            text: "I would not rank four buckets built on 21 events. Three of the four counts are single digit, and the order flips if two accounts move.\n\nTwo groups hold up at this sample size.\n\nPrice and packaging, 14 accounts. Nine promo renewals plus five seat floor cancellations. Both are invoice driven and both are yours to change.\n\nProduct gap, 4 accounts. SSO, named in the exit survey.\n\nUnknown, 3 accounts.\n\nThat is the 21, split 67 percent packaging against 19 percent product. The ratio survives two accounts moving between buckets, which is the strongest claim this file supports.\n\nFor Thursday: one slide, two bars, sample size in the subtitle.",
          },
        ],
      },
      "mistral-large": {
        firstTokenMs: 480,
        latencyMs: 2400,
        tokensIn: 1117,
        tokensOut: 388,
        activityLabel: "Grouping 21 cancellations",
        parts: [
          {
            kind: "text",
            text: "Four drivers, ranked, with counts.\n\nPromo renewals, 9. SPRING40 signups from March, gone within six days of the first full price invoice.\n\nSeat floor, 5. Below five seats, cancelled a median of 11 days later.\n\nMissing SSO, 4. Named in the exit survey.\n\nNo signal, 3.\n\nTwo of those are billing events you can see coming: the remaining SPRING40 renewals run through October, and 31 team accounts are sitting at five or six seats today.\n\nThat second list is the query worth running before Thursday.",
          },
        ],
      },
    },
  },
  {
    match: ["sso", "saml", "enterprise"],
    answers: {
      "claude-sonnet-5": {
        firstTokenMs: 500,
        latencyMs: 1900,
        tokensIn: 1810,
        tokensOut: 132,
        activityLabel: "Reading the exit survey",
        parts: [
          {
            kind: "text",
            text: "Four of the 21 named it, and three of those four opened an SSO ticket in Q2, so the intent predates the invoice.\n\nAll four sit between 8 and 14 seats, which is the band where SSO turns from a preference into a procurement requirement.",
          },
        ],
      },
      "gpt-5-1": {
        firstTokenMs: 820,
        latencyMs: 2600,
        tokensIn: 2074,
        tokensOut: 164,
        activityLabel: "Reading the exit survey",
        parts: [
          {
            kind: "text",
            text: "Careful with this one. Four of 21 named SSO and July had three, so month over month it is flat, and the exit survey only offers seven options to pick from.\n\nIt belongs on the roadmap slide rather than the churn slide. Putting it on the churn slide invites the question of why the fix did not ship in Q2.",
          },
        ],
      },
      "gemini-3-pro": {
        firstTokenMs: 660,
        latencyMs: 2200,
        tokensIn: 1852,
        tokensOut: 148,
        activityLabel: "Reading the exit survey",
        parts: [
          {
            kind: "text",
            text: "Four accounts, 19 percent of the cancellations, and the interval on that share runs from 5 to 42 percent.\n\nSo it is a real product gap and it is not a measurable driver of the August move. Both statements are true and the slide has room for both.",
          },
        ],
      },
      "mistral-large": {
        firstTokenMs: 450,
        latencyMs: 1700,
        tokensIn: 1552,
        tokensOut: 104,
        activityLabel: "Reading the exit survey",
        parts: [
          {
            kind: "text",
            text: "Four accounts, all between 8 and 14 seats. SSO ships in 3.5 per the roadmap.\n\nThe useful question is how many of the 31 accounts at the seat floor also asked for it. That query I can run.",
          },
        ],
      },
    },
  },
]

/**
 * Rotated when a prompt matches nothing in the library, so an unscripted send
 * still answers in each model's own voice.
 */
const FALLBACK_ANSWERS: Record<string, AnswerRecord[]> = {
  "claude-opus-5": [
    {
      firstTokenMs: 880,
      latencyMs: 3400,
      tokensIn: 1290,
      tokensOut: 214,
      activityLabel: "Checking the file",
      parts: [
        {
          kind: "text",
          text: "I can cut that, but the answer changes with the denominator and with the timezone, and this file carries a problem on both. Name whether you want accounts active on the first or the monthly average, and I will hold the UTC correction constant either way so the two cuts stay comparable.",
        },
      ],
    },
    {
      firstTokenMs: 920,
      latencyMs: 3600,
      tokensIn: 1412,
      tokensOut: 228,
      activityLabel: "Checking the file",
      parts: [
        {
          kind: "text",
          text: "Not in churn-aug.csv. It carries `cancelled_at`, `seats_at_cancel`, `plan_tier`, `promo_code` and `exit_reason`, so this needs the events export beside it.\n\nWorth saying before you go and pull it: joining events to this file on account id will drop the three workspaces under `acct_4f19c2`, which is the same duplicate that moves the headline number.",
        },
      ],
    },
  ],
  "claude-haiku-4-5": [
    {
      firstTokenMs: 240,
      latencyMs: 800,
      tokensIn: 1240,
      tokensOut: 58,
      activityLabel: "Checking the file",
      parts: [
        {
          kind: "text",
          text: "Name the denominator and I will run it. Accounts active on the first, or the monthly average. They differ by about a tenth of a point.",
        },
      ],
    },
    {
      firstTokenMs: 250,
      latencyMs: 850,
      tokensIn: 1348,
      tokensOut: 52,
      activityLabel: "Checking the file",
      parts: [
        {
          kind: "text",
          text: "Not in this file. Five columns only: `cancelled_at`, `seats_at_cancel`, `plan_tier`, `promo_code`, `exit_reason`.",
        },
      ],
    },
  ],
  "claude-sonnet-5": [
    {
      firstTokenMs: 480,
      latencyMs: 1800,
      tokensIn: 1290,
      tokensOut: 118,
      activityLabel: "Checking the file",
      parts: [
        {
          kind: "text",
          text: "I can cut that from the file, but name the denominator first: accounts active on the first of the month, or the monthly average. The two answers differ by about a tenth of a point, and the deck should only carry one of them.",
        },
      ],
    },
    {
      firstTokenMs: 520,
      latencyMs: 2000,
      tokensIn: 1412,
      tokensOut: 126,
      activityLabel: "Checking the file",
      parts: [
        {
          kind: "text",
          text: "Not in churn-aug.csv. It carries `cancelled_at`, `seats_at_cancel`, `plan_tier`, `promo_code` and `exit_reason`, so if the answer lives in product usage I need the events export beside it.",
        },
      ],
    },
  ],
  "gpt-5-1": [
    {
      firstTokenMs: 760,
      latencyMs: 2500,
      tokensIn: 1330,
      tokensOut: 152,
      activityLabel: "Checking the file",
      parts: [
        {
          kind: "text",
          text: "Give me the cut and I will run it: by cohort month, by seat band, or by exit reason.\n\nWithout one I would be picking the slice that looks best, which is how a deck gets argued with in the room.",
        },
      ],
    },
    {
      firstTokenMs: 800,
      latencyMs: 2700,
      tokensIn: 1466,
      tokensOut: 158,
      activityLabel: "Checking the file",
      parts: [
        {
          kind: "text",
          text: "That is not in the 18,402 rows. I can approximate it from seats and plan tier, though an approximation in a board deck tends to become a fact by the second meeting.",
        },
      ],
    },
  ],
  "gemini-3-pro": [
    {
      firstTokenMs: 640,
      latencyMs: 2100,
      tokensIn: 1304,
      tokensOut: 134,
      activityLabel: "Checking the file",
      parts: [
        {
          kind: "text",
          text: "Possible, with the caveat I keep repeating: any cut of 21 events lands in single digits, and single digit differences are not measurable here.\n\nName the cut and you get the number with its interval attached.",
        },
      ],
    },
    {
      firstTokenMs: 680,
      latencyMs: 2300,
      tokensIn: 1428,
      tokensOut: 140,
      activityLabel: "Checking the file",
      parts: [
        {
          kind: "text",
          text: "The file does not carry that field. The nearest usable proxy is seats at cancellation, which correlates but is not the same thing, so it would have to be labelled a proxy on the slide.",
        },
      ],
    },
  ],
  "mistral-large": [
    {
      firstTokenMs: 440,
      latencyMs: 1600,
      tokensIn: 1240,
      tokensOut: 88,
      activityLabel: "Checking the file",
      parts: [
        {
          kind: "text",
          text: "Name the column and the window and I will run it. The file has `cancelled_at`, `seats_at_cancel`, `plan_tier`, `promo_code` and `exit_reason`.",
        },
      ],
    },
    {
      firstTokenMs: 460,
      latencyMs: 1700,
      tokensIn: 1348,
      tokensOut: 92,
      activityLabel: "Checking the file",
      parts: [
        {
          kind: "text",
          text: "Not in this export. Ask the data team for the events table and this becomes a two minute query.",
        },
      ],
    },
  ],
}

/**
 * The answer a model gives to a prompt. `turn` rotates the fallback, so two
 * unscripted sends never come back word for word the same.
 */
export function answerFor(
  prompt: string,
  modelId: string,
  turn = 0
): AnswerRecord {
  const needle = prompt.toLowerCase()
  const hit = ANSWER_LIBRARY.find((entry) =>
    entry.match.some((term) => needle.includes(term))
  )
  const scripted = hit?.answers[modelId]
  if (scripted) return scripted

  const pool = FALLBACK_ANSWERS[modelId] ?? FALLBACK_ANSWERS["claude-sonnet-5"]
  return pool[turn % pool.length]
}

/** The zero state's way back in: the transcript's own prompts, labelled as
    recent rather than saved because they are scrollback, not templates. */
export const RECENT_PROMPTS = SEED_TURNS.map((turn) => turn.prompt)