export const GLASS_MENU =
  "border-0 bg-black/60 p-1 text-white ring-1 ring-white/15 backdrop-blur-xl backdrop-contrast-20 backdrop-saturate-200 before:hidden"

export const GLASS_MENU_GROUP = "flex flex-col gap-1"

// Every variant is spelled out: Tailwind only emits classes it reads literally.
const ROW = "rounded-full px-3 py-1 text-xs font-medium transition-colors"

// Rows carry the tabs' shape and ink, and a reached row takes the current one's
// flat lift. The style repaints its descendants in the theme's ink: pinned white.
export const GLASS_MENU_ITEM = `${ROW} text-white/70 focus:bg-white/10 focus:text-white focus:**:text-white data-highlighted:bg-white/10 data-highlighted:text-white data-highlighted:**:text-white`

// The current section sits on a plain lift of white rather than the tab's lit
// rim: in a list of rows the glass reads heavy, the flat fill reads light.
export const GLASS_MENU_ITEM_CURRENT = `${ROW} bg-white/10 text-white **:text-white`

// A row that holds a control never takes the lit fill; reached by keyboard, its
// ink and the control's track brighten instead. Its glyph is pinned the same way.
export const GLASS_MENU_ITEM_STATIC = `${ROW} cursor-default text-white/70 [&>svg]:text-white/70 [&>svg_*]:text-white/70 focus:bg-transparent data-highlighted:bg-transparent focus-visible:text-white focus-visible:[&>svg]:text-white focus-visible:[&>svg_*]:text-white focus-visible:[&_[data-slot=toggle-group]]:ring-white/40`

export const GLASS_MENU_LABEL = "px-3 py-1.5 text-white"
export const GLASS_MENU_SEPARATOR = "-mx-1 my-1 bg-white/10"

// One secondary tier: anything dimmer than the rows' own ink falls under 4.5:1
// where the glass sits over the light page.
export const GLASS_MENU_MUTED = "text-white/70"

// The theme switch is a small pill nav: a hairline track, round segments, the
// pressed one lit like the current tab. px-0 squares each to icon-sm.
export const GLASS_TOGGLE = "rounded-full p-0.5 ring-1 ring-white/15"
export const GLASS_TOGGLE_ITEM =
  "rounded-full px-0 text-white/70 **:text-inherit hover:bg-white/10 hover:text-white hover:shadow-[inset_1px_1px_0_0_rgb(255_255_255/0.45),inset_-1px_-1px_0_0_rgb(255_255_255/0.3)] focus-visible:ring-white/40 aria-pressed:bg-white/10 aria-pressed:text-white aria-pressed:shadow-[inset_1px_1px_0_0_rgb(255_255_255/0.45),inset_-1px_-1px_0_0_rgb(255_255_255/0.3)] data-[state=on]:bg-white/10 data-[state=on]:text-white data-[state=on]:shadow-[inset_1px_1px_0_0_rgb(255_255_255/0.45),inset_-1px_-1px_0_0_rgb(255_255_255/0.3)]"