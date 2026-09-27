import type { CSSProperties } from "react"

import { HERO_SLIDES, HERO_VIEWBOX, type HeroSlide } from "./data"
import {
  HERO_DISSOLVE_PATH,
  HERO_GRID_PATH,
  HERO_TWINKLES,
} from "./hero-pixels"

// Each photograph ships beside the block at a few widths, so the browser picks
// the one it needs rather than asking a CDN to resize on the way in.
// `exact` marks a slide whose `base` is already a full URL — a Cloudflare Images
// variant of one of the user's own pictures, which has no per-width siblings.
const srcOf = ({ base, widths, exact }: HeroSlide) =>
  exact ? base : `${base}-${widths[widths.length - 1]}.webp`
const srcSetOf = ({ base, widths, exact }: HeroSlide) =>
  exact ? undefined : widths.map((w) => `${base}-${w}.webp ${w}w`).join(", ")

// Each photograph holds SLOT seconds and the next fades over it in FADE; the
// first rests beneath and never moves, so paused or reduced motion shows it.
const SLOT = 5
const FADE = 1.5
const CYCLE = SLOT * HERO_SLIDES.length
const at = (seconds: number) =>
  `${+((Math.min(seconds, CYCLE) / CYCLE) * 100).toFixed(3)}%`

const HERO_MOTION = `
@keyframes app-shell-22-slide {
  0%, ${at(SLOT - FADE)} { opacity: 0 }
  ${at(SLOT)}, ${at(2 * SLOT)} { opacity: 1 }
  ${at(2 * SLOT + 0.01)}, 100% { opacity: 0 }
}
@keyframes app-shell-22-slide-last {
  0%, ${at(SLOT - FADE)} { opacity: 0 }
  ${at(SLOT)}, ${at(2 * SLOT - FADE)} { opacity: 1 }
  ${at(2 * SLOT)}, 100% { opacity: 0 }
}
.app-shell-22-slide {
  opacity: 0;
  animation: app-shell-22-slide ${CYCLE}s ease-in-out var(--app-shell-22-slide-delay) infinite;
}
.app-shell-22-slide[data-last] { animation-name: app-shell-22-slide-last }
@keyframes app-shell-22-twinkle {
  0%, 62% { opacity: 0 }
  72%, 88% { opacity: 1 }
  98%, 100% { opacity: 0 }
}
.app-shell-22-twinkle {
  opacity: 0;
  animation: app-shell-22-twinkle var(--app-shell-22-twinkle-duration) ease-in-out var(--app-shell-22-twinkle-delay) infinite;
}
.app-shell-22-twinkle[data-lit] { opacity: 1 }
@media (prefers-reduced-motion: reduce) {
  .app-shell-22-slide, .app-shell-22-twinkle { animation: none }
}
`

// Each crop holds the robot clear of the nav, and the band ends in a dissolve
// of the page's own ground rather than a fade.
export function HeroBand({ slides = [] }: { slides?: HeroSlide[] }) {
  // No pictures of the user's own → NO band. The block shipped stock photography
  // as the fallback, which put someone else's robots across the top of every
  // page and implied content that is not there.
  if (slides.length === 0) return null
  const [resting, ...crossing] = slides

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 top-[-68px] h-[380px] overflow-hidden sm:h-[420px] lg:h-[444px]"
    >
      <style>{HERO_MOTION}</style>
      <img
        src={srcOf(resting)}
        srcSet={srcSetOf(resting)}
        sizes="100vw"
        alt=""
        width={HERO_VIEWBOX.width}
        height={HERO_VIEWBOX.height}
        fetchPriority="high"
        style={{ objectPosition: resting.position }}
        className="absolute inset-0 size-full object-cover"
      />
      {crossing.map((slide, index) => (
        <img
          key={slide.base}
          src={srcOf(slide)}
          srcSet={srcSetOf(slide)}
          sizes="100vw"
          alt=""
          width={HERO_VIEWBOX.width}
          height={HERO_VIEWBOX.height}
          decoding="async"
          fetchPriority="low"
          data-last={index === crossing.length - 1 ? "" : undefined}
          style={
            {
              objectPosition: slide.position,
              "--app-shell-22-slide-delay": `${index * SLOT}s`,
            } as CSSProperties
          }
          className="app-shell-22-slide absolute inset-0 size-full object-cover"
        />
      ))}
      {/* Scaled the way the photograph is: it covers the band and stays pinned
          to the foot, so the dissolve always meets the page. */}
      <svg
        viewBox={`0 0 ${HERO_VIEWBOX.width} ${HERO_VIEWBOX.height}`}
        preserveAspectRatio="xMidYMax slice"
        className="absolute inset-0 size-full"
      >
        <path
          d={HERO_GRID_PATH}
          fill="none"
          strokeWidth={0.48}
          className="stroke-white/7"
        />
        <path d={HERO_DISSOLVE_PATH} className="fill-muted" />
        {/* Each lone square rests dark and lights on its own clock, so only a
            scattered few show at once. */}
        {HERO_TWINKLES.map((square) => (
          <rect
            key={`${square.x}-${square.y}`}
            x={square.x}
            y={square.y}
            width={12}
            height={12}
            data-lit={square.lit ? "" : undefined}
            style={
              {
                "--app-shell-22-twinkle-duration": `${square.duration}s`,
                "--app-shell-22-twinkle-delay": `${square.delay}s`,
              } as CSSProperties
            }
            className={`app-shell-22-twinkle ${square.ground ? "fill-muted" : "fill-white/45"}`}
          />
        ))}
      </svg>
    </div>
  )
}