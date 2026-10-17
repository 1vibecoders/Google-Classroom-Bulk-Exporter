---
name: Lattice Study
description: Scheduling that understands the assignment.
colors:
  lattice-green: "#2b7a52"
  lattice-green-hover: "#256b48"
  lattice-green-soft: "#e4f2e9"
  lattice-green-edge: "#1f5c45"
  on-accent: "#ffffff"
  brand-ink: "#1f5c45"
  brand-cream: "#fffdf7"
  page: "#f7f7f5"
  surface: "#ffffff"
  surface-2: "#f3f3f1"
  surface-3: "#e9e9e6"
  text: "#1d1f1c"
  text-2: "#4a4a46"
  text-3: "#6b6b66"
  border: "#e5e5e2"
  border-strong: "#cfcfca"
  button-edge: "#d6d6d1"
  success: "#2e6a33"
  success-soft: "#e3eedc"
  warning: "#8f5300"
  warning-soft: "#f7ead0"
  danger: "#a3301c"
  danger-soft: "#f6e0da"
  available: "#edf5ea"
  available-border: "#a8c69a"
  busy: "#efefec"
  busy-stripe: "#e6e6e2"
  now: "#c23b22"
  dark-page: "#171612"
  dark-surface: "#1e1d18"
  dark-text: "#ece7dc"
  dark-border: "#34312a"
  dark-lattice-green: "#86c4a4"
  dark-lattice-green-soft: "#1f3229"
  dark-lattice-green-edge: "#4f8a6c"
typography:
  wordmark:
    fontFamily: "'Source Serif 4', 'Iowan Old Style', Georgia, serif"
    fontSize: "20px"
    fontWeight: 600
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "'Source Sans 3', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif"
    fontSize: "26px"
    fontWeight: 800
    lineHeight: 1.15
    letterSpacing: "-0.015em"
  title:
    fontFamily: "'Source Sans 3', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif"
    fontSize: "17px"
    fontWeight: 700
    lineHeight: 1.25
  title-sm:
    fontFamily: "'Source Sans 3', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 700
    lineHeight: 1.25
  body:
    fontFamily: "'Source Sans 3', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  body-sm:
    fontFamily: "'Source Sans 3', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "'Source Sans 3', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif"
    fontSize: "13px"
    fontWeight: 600
  motto:
    fontFamily: "'Source Serif 4', 'Iowan Old Style', Georgia, serif"
    fontSize: "18px"
    fontWeight: 400
rounded:
  s: "8px"
  m: "12px"
  l: "14px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "10px"
  lg: "14px"
  xl: "20px"
components:
  button-primary:
    backgroundColor: "{colors.lattice-green}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.m}"
    padding: "0 12px"
    height: "34px"
  button-primary-hover:
    backgroundColor: "{colors.lattice-green-hover}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.m}"
    padding: "0 12px"
    height: "34px"
  button-secondary-hover:
    backgroundColor: "{colors.surface-2}"
  button-ghost:
    textColor: "{colors.text}"
    rounded: "{rounded.m}"
    height: "34px"
  button-small:
    rounded: "{rounded.m}"
    padding: "0 9px"
    height: "28px"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.l}"
    padding: "14px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.m}"
    padding: "6px 12px"
    height: "34px"
  nav-link:
    textColor: "{colors.text-2}"
    rounded: "{rounded.pill}"
    padding: "6px 12px"
  nav-link-current:
    backgroundColor: "{colors.lattice-green-soft}"
    textColor: "{colors.lattice-green}"
    rounded: "{rounded.pill}"
  badge:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text-2}"
    rounded: "{rounded.pill}"
    padding: "0 6px"
    height: "20px"
  progress:
    backgroundColor: "{colors.surface-3}"
    rounded: "{rounded.pill}"
    height: "10px"
---

# Design System: Lattice Study

## Overview

**Creative North Star: "The Tidy Study Desk"**

A clean, bright, compact workspace for one student planning real homework into real free time. White cards with soft 2px borders sit on a near-white page; bold sans headings carry the hierarchy; the Lattice green is the only brand voice, reserved for actions, the current place, and progress. Everything else that has color is data: each class owns a color, and that color marks its work on the calendar.

Density is deliberate. Spacing is tight (10px stacks, 14px card padding, 20px page gutter) so the day, the agenda, and the next action fit in one view on a laptop and stack cleanly on a phone. Interaction feels tactile: buttons sit on a darker bottom edge and press down when clicked, the way a physical key does. The Lattice mark's diagonal geometry recurs quietly as the diamond meter and as the faint grid behind empty states.

The serif belongs to the brand alone: the wordmark and the motto. The dark theme keeps the same structure on warm near-black surfaces with a pale Lattice green.

**Key Characteristics:**
- Near-white page, white cards, 2px soft gray borders, no ambient shadows.
- One accent (Lattice green) for primary actions, current navigation, focus, and progress.
- Class colors are data encoding, not decoration.
- Bold Source Sans 3 headings; Source Serif 4 only in the wordmark and motto.
- Pill shapes for navigation, badges, and progress; 12px rounding for controls, 14px for cards.
- Buttons press down onto a 3px darker edge.
- Compact rhythm, readable at phone width without sideways scrolling.

## Colors

A neutral, slightly warm gray field with a single ink-to-leaf green accent, a small semantic set, and per-class data colors.

### Primary
- **Lattice Green** (lattice-green): primary buttons, the current-page nav pill text, links, focus outline, checkbox and caret color, filled progress and full meter cells.
- **Lattice Green Hover** (lattice-green-hover): primary button hover fill and border.
- **Soft Leaf** (lattice-green-soft): current-page nav pill fill, pressed segmented and weekday controls, text selection, the 3px input focus halo, partly filled meter cells.
- **Lattice Ink Edge** (lattice-green-edge): the pressed-down bottom edge under primary buttons; the same ink as the mark tile.

### Brand (fixed)
- **Brand Ink** (brand-ink) and **Brand Cream** (brand-cream): the Lattice mark's tile and lattice lines. They never change with the theme.

### Neutral
- **Page** (page): app background and the sticky header bar.
- **Surface** (surface): cards, inputs, secondary buttons, menus, modals.
- **Surface 2 / Surface 3** (surface-2, surface-3): hover fills, modal footers, badge fill; progress track.
- **Text / Text 2 / Text 3** (text, text-2, text-3): primary copy; labels and nav; hints, meta, empty-state copy.
- **Border / Border Strong** (border, border-strong): 2px card, input and button outlines at rest; their hover outline.
- **Button Edge** (button-edge): the 3px bottom edge under secondary buttons.

### Semantic and schedule
- **Success, Warning, Danger** with their soft fills: banners, badges, form errors, danger buttons, flagged meter cells.
- **Available / Available Border**: free-time bands on the timeline. **Busy / Busy Stripe**: fixed commitments such as school, drawn as a diagonal hatch. **Now** (now): the current-time line.
- **Class colors** (`CLASS_PALETTE` in `src/model/constants.ts`: ink blue, green, brick red, plum, ...): one per class, shown as a dot beside class names and as the 4px left edge of calendar blocks and date-strip chips.

### Dark theme
Same roles on warm near-black (dark-page, dark-surface, dark-border) with warm off-white text and a pale Lattice green (dark-lattice-green) whose text-on-accent is near-black. Whether the dark neutrals stay warm or move to neutral is an open decision, not a settled rule.

### Named Rules
**The One Green Rule.** Lattice green means "act here, you are here, or done so far". It is never used as decoration, card fill, or heading color.

**The Data Color Rule.** Class colors appear only where they identify a class: the class dot and the left edge of calendar blocks and date chips. They never tint chrome, buttons, or headings.

**The Fixed Mark Rule.** The mark is always ink tile and cream lattice, in both themes.

## Typography

**Display/UI Font:** Source Sans 3 (self-hosted variable, with system-ui fallback)
**Brand Font:** Source Serif 4 (self-hosted, wordmark and motto only)
**Mono:** ui-monospace stack, 12px, for codes and raw values

**Character:** A sturdy humanist sans at heavy weights does the work; the serif is a signature, used twice.

### Hierarchy
- **Headline** (800, 26px, 1.15, -0.015em, balanced wrap): page titles such as the date on the Day view.
- **Title** (700, 17px; 16px inside card headers): section and card headings.
- **Title Small** (700, 15px): sub-sections, empty-state headings.
- **Body** (400, 15px, 1.5): sentences and list content.
- **Body Small** (13px): secondary sentences; no sentence goes below 13px.
- **Label** (600, 13px): field labels, nav (600, body size), table headers (600, 12px).
- **Wordmark** (Source Serif 4, 600, 20px; 30px on welcome) with "STUDY" in Source Sans 3 600 at 10.5px, 0.16em tracking, uppercase, Lattice green; "STUDY" hides under 720px.
- **Motto** (Source Serif 4 italic, 18px, text-2): the welcome screen only.

### Named Rules
**The Serif Is a Signature Rule.** Source Serif 4 appears only in the wordmark and the motto. Every heading, label and control is Source Sans 3.

**The Tabular Numbers Rule.** Times, stats and dates use tabular numerals so columns of figures align.

## Layout

A sticky 52px header (mark, wordmark, pill nav, actions on the right) over a centered main column up to 1440px with 20px side and top padding and 48px bottom. The Day view pairs a wide timeline with a right rail of stacked summary cards; card grids use auto-fit columns of at least 320px with 16px gaps.

Rhythm is compact: stacks at 10px, paragraphs in a stack take no extra margin, a later heading gets 6px extra above. Forms use a two-column grid (12px x 14px gaps) that collapses to one column at 640px.

Responsive: at 760px the header wraps and the nav takes its own full-width, horizontally scrollable row, and main padding drops to 14px 12px 40px; at 720px page actions wrap from the left and the wordmark drops "STUDY". Additional component breakpoints exist between 400px and 1000px.

## Elevation & Depth

Flat by default. Cards and surfaces have no shadow; depth comes from white surfaces on the off-white page and 2px soft borders. One diffuse shadow is reserved for floating layers (modals, menus, toasts). The only other "depth" is the tactile 3px bottom edge on buttons, which is an interaction affordance, not elevation.

### Shadow Vocabulary
- **Float** (`box-shadow: 0 12px 32px rgba(20, 22, 20, 0.14)`; dark `rgba(0, 0, 0, 0.55)`): modal dialogs, dropdown menus, toasts.
- **Press edge** (`box-shadow: 0 3px 0 <edge>`): buttons only; goes to `0 0 0` with `translateY(3px)` on press.
- **Focus halo** (`box-shadow: 0 0 0 3px <lattice-green-soft>`): focused inputs and the active primary toggle.

### Named Rules
**The Flat Surface Rule.** Surfaces are flat at rest. Shadows mean "this floats above the page" and nothing else.

**The Press Edge Rule.** The 3px bottom edge belongs to buttons, which press down onto it. Never put it on cards, chips, or static surfaces.

## Shapes

Soft, friendly rounding in three steps: 8px for small chips, timeline chips, and weekday toggles; 12px for buttons, inputs, banners, menus and toasts; 14px for cards and modals. Navigation pills, badges, and progress bars are fully rounded. Outlines are 2px on cards, inputs, buttons and segmented dividers. The Lattice mark is a rounded tile (radius 22 of 100) with two cream lines each way at 45 degrees; its diamond geometry returns as the lattice meter (11px cells rotated 45 degrees, 2px corners) and the faint 28px diagonal grid behind empty states.

## Components

### Buttons
Tactile and confident.
- **Shape:** 12px rounding, 2px outline, 34px tall (28px small), weight 700.
- **Primary:** Lattice green fill and border, white text, 3px Lattice Ink bottom edge.
- **Secondary:** white fill, soft border, 3px gray bottom edge; border strengthens on hover and fill moves to surface-2.
- **Danger:** danger text and border on white, edge tinted toward danger; hover fills danger-soft.
- **Ghost:** transparent, no border, no edge; hover fills surface-2.
- **Press:** moves down 3px and the edge collapses (0.08s ease-out); disabled drops to 50% opacity with no edge and no movement; reduced motion removes the movement.
- **Icon buttons:** square 34px (28px small) with inline SVG icons.

### Chips, badges, segmented controls
- **Badge:** pill, 20px tall, 12px 500 text on surface-2 or a semantic soft fill.
- **Class chip:** a 10px class-color dot beside 12px 600 class name.
- **Segmented control:** a bordered group of buttons divided by 2px lines; the pressed option fills Soft Leaf with Lattice green text.

### Cards / Containers
- **Corner Style:** 14px.
- **Background:** surface.
- **Shadow Strategy:** none (see Elevation).
- **Border:** 2px border color; header separated by a 2px rule.
- **Internal Padding:** 14px body; header 10px 14px.

### Inputs / Fields
- **Style:** 2px soft border, 12px rounding, white fill, 34px minimum height, 6px 12px padding; labels 13px 600 in text-2 above, hints 12px text-3.
- **Hover:** border strengthens.
- **Focus:** border turns Lattice green with a 3px Soft Leaf halo.
- **Error:** danger border via `aria-invalid`, danger message below.

### Navigation
- Horizontal pill links, 600 weight, text-2, 6px 12px padding, 4px apart. Hover lays a faint surface-2 pill. The current page is a Soft Leaf pill with Lattice green text. On phones the nav becomes its own scrollable row below the brand and actions.

### Progress and the Lattice Meter
- **Progress bar:** 10px pill track in surface-3 with a Lattice green pill fill that eases its width (0.32s).
- **Lattice meter:** a row of diamond cells for level and test readiness: full (green), part (Soft Leaf with green outline), flag (warning), empty (text-3 outline). The row is one labelled progressbar for assistive technology.

### Timeline blocks and date chips
Calendar blocks tint their class color at 15% into the surface, outline at 40%, and carry a solid 4px class-color left edge; date-strip chips carry the same 4px edge. Busy time is a diagonal hatch, free time a pale green band with a 3px available-border edge.

### Empty states
Centered, text-3 copy with a text-colored heading, the Lattice mark above, and a faint diagonal lattice grid that fades out radially behind them.

### Modals, menus, toasts
Modals: 14px rounding, Float shadow, blurred warm backdrop, surface-2 footer with right-aligned actions. Menus: 12px rounding, 4px inset, rows highlight with surface-2. Toasts: dark pill-like bars (12px rounding) at bottom center with semantic dark fills.

## Do's and Don'ts

### Do:
- **Do** keep cards flat: white surface, 2px border, 14px rounding, 14px padding.
- **Do** use Lattice green only for primary actions, the current location, focus, and progress.
- **Do** give every button the 3px press edge (except ghost and disabled) and let it press down on click.
- **Do** use pills for navigation, badges and progress.
- **Do** keep sentences at 13px or larger and use tabular numerals for times and stats.
- **Do** mark class work with the class color dot or the 4px left edge on calendar blocks and date chips.
- **Do** honor reduced motion: no press movement, no meter or progress transitions.

### Don't:
- **Don't** use Source Serif 4 for headings or UI; it is for the wordmark and motto only.
- **Don't** recolor or theme the Lattice mark; it stays ink and cream in dark mode.
- **Don't** add shadows to cards or surfaces; the Float shadow is for modals, menus and toasts.
- **Don't** put the press edge on anything that is not a button.
- **Don't** use class colors for chrome, headings or buttons.
