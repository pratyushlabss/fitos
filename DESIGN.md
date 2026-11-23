# FitOS design system

Minimal, monochrome, tactile. Black and white only. State, emphasis and data are told apart with contrast, weight, opacity, pattern and motion, never hue.

## Colour

Every colour is a CSS variable holding RGB channels, so Tailwind's `/opacity` modifiers work and light mode is an exact inversion.

| Token | Dark | Light | Use |
|---|---|---|---|
| `--bg` | `#000000` | `#FFFFFF` | Page background (OLED black) |
| `--surface-1` | `#0A0A0A` | `#F5F5F5` | Cards, sheets |
| `--surface-2` | `#141414` | `#EBEBEB` | Inputs, nested rows |
| `--surface-3` | `#1F1F1F` | `#E0E0E0` | Pressed and selected fills |
| `--border` | `#2A2A2A` | `#D5D5D5` | 1px hairlines |
| `--fg-muted` | `#8A8A8A` | `#757575` | Secondary text (≥ 4.5:1 on bg and surface-1) |
| `--fg` | `#EDEDED` | `#121212` | Primary text |
| `--fg-max` | `#FFFFFF` | `#000000` | Highlights, primary buttons, progress fills |

Tailwind's `white`, `black`, `slate`, `emerald`, `rose`, `amber`, `sky`, `violet` and the app tokens (`ink`, `panel`, `muted`, `accent`, `warn`) are all remapped onto these variables. Existing screens therefore render monochrome without changing their markup, and `white/10` means "foreground at 10%" in both themes.

Theme follows the system by default. Settings › Appearance can force Dark or Light (`data-theme` on `<html>`).

## States without colour

| State | Treatment |
|---|---|
| Primary action | `fg-max` fill, `bg` text, weight 600 |
| Secondary action | `surface-3` fill, `fg` text |
| Selected, active tab | Full `fg-max`, stroke 2 icon; inactive at `fg-muted`, stroke 1.5 |
| Done, completed set | Inverted row (fg-max fill, bg text) |
| Warning, over target | Bold weight plus a dashed border |
| Error | Hairline border at full foreground, bold heading, "Retry" |
| Disabled | 40% opacity |
| AI estimate, low confidence | Outlined pill and reduced opacity; high confidence is a filled dot |

## Macros by pattern

Rings, bars and legends use SVG patterns, always with a text label.

- Protein: solid fill
- Carbs: diagonal hatch, 45°, 4px pitch
- Fat: dots on a 4px grid
- Calories: thick solid ring with a radial glow behind the number

## Type

- UI: Geist Sans. Headings use tight tracking (`-0.03em`) at weight 600.
- Numbers: Geist Mono with `tabular-nums` (the `.num` class). Hero numerals are 56 to 72 px; stat values 24 to 32 px.
- Eyebrows: 11px uppercase mono at `0.16em` tracking.
- Spacing: 8pt grid (Tailwind steps 2, 4, 6, 8, 10 and so on). Generous whitespace between sections (`space-y-6`).

## Shape and depth

- Radius: 20px cards (`rounded-card`), 999px pills and buttons, 14px inputs.
- 1px hairline borders (`--border`) instead of shadows. No drop shadows.
- Icons: lucide at stroke 1.5 (2 when active).

## Texture (static)

- **Film grain:** a fixed full-screen SVG `feTurbulence` layer at 5% opacity, `mix-blend-mode: overlay`, `pointer-events: none`. Rendered once and never animated.
- **Dot grid** (`.texture-dots`) on hero cards, 12px pitch at 7% foreground.
- **Glow** (`.glow`): a soft radial `fg-max` glow behind key numbers.
- **1-bit dither:** an SVG filter (grayscale, noise, threshold) on feed images and progress photos. On by default; toggle in Settings › Appearance.

## 3D (react-three-fiber, lazy, client only)

- **Home hero:** matte black torus with a white rim light. The white arc sweeps to today's kcal ÷ goal. Slow idle spin; it tilts when dragged.
- **Streak orb:** a white faceted icosahedron in the same canvas; detail grows with streak length.
- **PR celebration:** 2 seconds of white particles bursting and settling into the "PR" shape, sampled from rendered text, with no font file.
- **Body map:** a procedural low-poly silhouette built from primitives. Worked muscle groups are white and the rest grey.

Rules:
- At most one Canvas per screen. `dpr={[1, 2]}`, no shadow maps.
- `frameloop` switches to `"never"` when offscreen (IntersectionObserver) or the tab is hidden.
- With `prefers-reduced-motion`, the 3D toggle off, or no WebGL, every 3D element becomes a static SVG.

## Motion (framer-motion)

- Pages: 200 ms fade plus 8px rise.
- Numbers count up when they change. Rings and bars fill from 0 on first view.
- Every button: scale 0.97 on press plus `navigator.vibrate(8)` where supported.
- Cards: subtle 3D tilt on press (perspective 800px). Device-orientation tilt only after the user taps "Enable motion".
- Sheets: spring in, drag down to dismiss.
- Loading: monochrome shimmer skeletons, never spinners.
- Everything respects `prefers-reduced-motion`.
