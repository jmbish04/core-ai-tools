import { HERO_VIEWBOX } from "./data"

/** Runs of the dissolve, [x, y, width]; every run is one 12px row tall. */
const DISSOLVE: ReadonlyArray<readonly [number, number, number]> = [
  [108, 336, 12],
  [384, 336, 12],
  [648, 336, 12],
  [888, 336, 12],
  [1008, 336, 12],
  [1152, 336, 12],
  [1428, 336, 12],
  [144, 348, 12],
  [300, 348, 12],
  [480, 348, 12],
  [540, 348, 12],
  [684, 348, 12],
  [851, 348, 12],
  [948, 348, 12],
  [1068, 348, 12],
  [1164, 348, 12],
  [1320, 348, 12],
  [1368, 348, 12],
  [84, 360, 12],
  [192, 360, 12],
  [240, 360, 12],
  [420, 360, 12],
  [504, 360, 12],
  [612, 360, 12],
  [696, 360, 12],
  [780, 360, 12],
  [840, 360, 12],
  [876, 360, 12],
  [984, 360, 12],
  [1116, 360, 12],
  [1284, 360, 12],
  [1416, 360, 12],
  [48, 372, 12],
  [108, 372, 12],
  [216, 372, 12],
  [288, 372, 12],
  [372, 372, 12],
  [492, 372, 12],
  [600, 372, 12],
  [672, 372, 12],
  [768, 372, 12],
  [864, 372, 12],
  [972, 372, 12],
  [1032, 372, 12],
  [1140, 372, 12],
  [1224, 372, 12],
  [1272, 372, 12],
  [1308, 372, 12],
  [1380, 372, 12],
  [60, 384, 12],
  [108, 384, 24],
  [180, 384, 12],
  [204, 384, 12],
  [240, 384, 24],
  [312, 384, 12],
  [336, 384, 24],
  [396, 384, 12],
  [456, 384, 12],
  [504, 384, 12],
  [552, 384, 24],
  [588, 384, 24],
  [636, 384, 12],
  [684, 384, 12],
  [732, 384, 24],
  [816, 384, 12],
  [876, 384, 12],
  [936, 384, 24],
  [1020, 384, 12],
  [1104, 384, 12],
  [1164, 384, 24],
  [1212, 384, 12],
  [1284, 384, 12],
  [1356, 384, 24],
  [1428, 384, 12],
  [84, 396, 12],
  [132, 396, 12],
  [168, 396, 36],
  [252, 396, 12],
  [288, 396, 36],
  [372, 396, 12],
  [420, 396, 24],
  [492, 396, 12],
  [528, 396, 36],
  [600, 396, 24],
  [660, 396, 24],
  [696, 396, 12],
  [756, 396, 12],
  [792, 396, 24],
  [840, 396, 12],
  [888, 396, 36],
  [960, 396, 12],
  [996, 396, 12],
  [1044, 396, 36],
  [1092, 396, 12],
  [1140, 396, 24],
  [1200, 396, 12],
  [1248, 396, 36],
  [1332, 396, 12],
  [1368, 396, 24],
  [1416, 396, 12],
  [0, 408, 24],
  [12, 408, 48],
  [72, 408, 24],
  [108, 408, 12],
  [144, 408, 24],
  [204, 408, 12],
  [240, 408, 36],
  [312, 408, 24],
  [348, 408, 12],
  [384, 408, 36],
  [456, 408, 12],
  [480, 408, 48],
  [540, 408, 36],
  [612, 408, 24],
  [648, 408, 24],
  [708, 408, 24],
  [744, 408, 12],
  [780, 408, 24],
  [828, 408, 60],
  [912, 408, 24],
  [948, 408, 12],
  [972, 408, 36],
  [1020, 408, 12],
  [1068, 408, 36],
  [1116, 408, 12],
  [1164, 408, 48],
  [1236, 408, 12],
  [1272, 408, 48],
  [1356, 408, 24],
  [1392, 408, 12],
  [1428, 408, 12],
  [12, 420, 60],
  [96, 420, 48],
  [156, 420, 36],
  [204, 420, 60],
  [288, 420, 24],
  [324, 420, 72],
  [408, 420, 36],
  [468, 420, 36],
  [516, 420, 36],
  [576, 420, 12],
  [600, 420, 60],
  [684, 420, 24],
  [720, 420, 24],
  [768, 420, 48],
  [828, 420, 24],
  [864, 420, 48],
  [924, 420, 24],
  [972, 420, 12],
  [996, 420, 36],
  [1044, 420, 36],
  [1104, 420, 36],
  [1152, 420, 72],
  [1248, 420, 48],
  [1308, 420, 36],
  [1368, 420, 48],
  [13, 432, 143],
  [168, 432, 84],
  [264, 432, 216],
  [492, 432, 48],
  [552, 432, 84],
  [648, 432, 72],
  [732, 432, 132],
  [876, 432, 48],
  [936, 432, 84],
  [1032, 432, 36],
  [1080, 432, 72],
  [1164, 432, 48],
  [1224, 432, 96],
  [1332, 432, 36],
  [1380, 432, 48],
]

/** Loose 12px squares of white over the photograph, [x, y], from its middle
    down to the dissolve; the top stays clear. */
const SPARKLE: ReadonlyArray<readonly [number, number]> = [
  [72, 216],
  [288, 216],
  [480, 216],
  [756, 216],
  [972, 216],
  [36, 228],
  [120, 228],
  [516, 228],
  [780, 228],
  [1008, 228],
  [1416, 228],
  [192, 240],
  [348, 240],
  [552, 240],
  [876, 240],
  [1080, 240],
  [1368, 240],
  [228, 252],
  [600, 252],
  [696, 252],
  [1164, 252],
  [1272, 252],
  [84, 264],
  [432, 264],
  [624, 264],
  [804, 264],
  [996, 264],
  [1296, 264],
  [276, 276],
  [360, 276],
  [852, 276],
  [948, 276],
  [1332, 276],
  [108, 288],
  [396, 288],
  [588, 288],
  [912, 288],
  [1116, 288],
  [72, 300],
  [444, 300],
  [480, 300],
  [804, 300],
  [1092, 300],
  [1164, 300],
  [216, 312],
  [528, 312],
  [720, 312],
  [1044, 312],
  [1248, 312],
  [252, 324],
  [588, 324],
  [948, 324],
  [1308, 324],
]

// The photograph starts 48 into the band and runs to its foot, and the grid
// is tiled from its corner, so both land on multiples of 12.
const PHOTO_TOP = 48
const STEP = 12

const box = (x: number, y: number, w: number, h: number) =>
  `M${x} ${y}h${w}v${h}h${-w}z`

// Lone squares twinkle; runs and the dense lower rows hold, so the page's edge
// never opens. A square's own position seeds its timing, the same on every render.
const TWINKLE_FLOOR = 384
// customize: the share of squares lit when motion is off; about a quarter are lit
// at any moment while it plays.
const LIT_ONE_IN = 4
const isLone = (y: number, w: number) => w === STEP && y <= TWINKLE_FLOOR

/** One path for the dissolve that holds: adjacent runs merge, never seam. */
export const HERO_DISSOLVE_PATH = DISSOLVE.filter(([, y, w]) => !isLone(y, w))
  .map(([x, y, w]) => box(x, y, w, STEP))
  .join("")

export type HeroTwinkle = {
  x: number
  y: number
  /** The page's own ground, or the white laid over the photograph. */
  ground: boolean
  /** Shown when motion is off; the rest stay dark. */
  lit: boolean
  /** Seconds per cycle; the delay is negative, so each starts mid-cycle. */
  duration: number
  delay: number
}

const seed = (x: number, y: number) =>
  (Math.imul(x + 1, 73856093) ^ Math.imul(y + 1, 19349663)) >>> 0

const twinkle = (x: number, y: number, ground: boolean): HeroTwinkle => {
  const h = seed(x, y)
  const duration = 6 + (h % 6000) / 1000
  const phase = ((h >>> 12) % 1000) / 1000
  return {
    x,
    y,
    ground,
    lit: (h >>> 24) % LIT_ONE_IN === 0,
    duration,
    delay: -+(phase * duration).toFixed(2),
  }
}

export const HERO_TWINKLES: HeroTwinkle[] = [
  ...DISSOLVE.filter(([, y, w]) => isLone(y, w)).map(([x, y]) =>
    twinkle(x, y, true)
  ),
  ...SPARKLE.map(([x, y]) => twinkle(x, y, false)),
]

export const HERO_GRID_PATH = [
  ...Array.from(
    { length: HERO_VIEWBOX.width / STEP + 1 },
    (_, i) => `M${i * STEP} ${PHOTO_TOP}V${HERO_VIEWBOX.height}`
  ),
  ...Array.from(
    { length: (HERO_VIEWBOX.height - PHOTO_TOP) / STEP + 1 },
    (_, i) => `M0 ${PHOTO_TOP + i * STEP}H${HERO_VIEWBOX.width}`
  ),
].join("")