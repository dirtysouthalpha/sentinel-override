---
name: Cyber-Ops Automation
colors:
  surface: '#111318'
  surface-dim: '#111318'
  surface-bright: '#37393e'
  surface-container-lowest: '#0c0e12'
  surface-container-low: '#1a1c20'
  surface-container: '#1e2024'
  surface-container-high: '#282a2e'
  surface-container-highest: '#333539'
  on-surface: '#e2e2e8'
  on-surface-variant: '#b9cacb'
  inverse-surface: '#e2e2e8'
  inverse-on-surface: '#2f3035'
  outline: '#849495'
  outline-variant: '#3b494b'
  surface-tint: '#00dbe9'
  primary: '#dbfcff'
  on-primary: '#00363a'
  primary-container: '#00f0ff'
  on-primary-container: '#006970'
  inverse-primary: '#006970'
  secondary: '#bcff5f'
  on-secondary: '#203600'
  secondary-container: '#95e400'
  on-secondary-container: '#3d6200'
  tertiary: '#fff5e7'
  on-tertiary: '#402d00'
  tertiary-container: '#ffd47b'
  on-tertiary-container: '#7a5a00'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#7df4ff'
  primary-fixed-dim: '#00dbe9'
  on-primary-fixed: '#002022'
  on-primary-fixed-variant: '#004f54'
  secondary-fixed: '#a8f928'
  secondary-fixed-dim: '#8fdb00'
  on-secondary-fixed: '#112000'
  on-secondary-fixed-variant: '#314f00'
  tertiary-fixed: '#ffdfa0'
  tertiary-fixed-dim: '#fbbc00'
  on-tertiary-fixed: '#261a00'
  on-tertiary-fixed-variant: '#5c4300'
  background: '#111318'
  on-background: '#e2e2e8'
  surface-variant: '#333539'
typography:
  headline-lg:
    fontFamily: Space Grotesk
    fontSize: 32px
    fontWeight: '700'
    lineHeight: '1.2'
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Space Grotesk
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.2'
    letterSpacing: 0.05em
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.5'
    letterSpacing: 0em
  data-mono:
    fontFamily: monospace
    fontSize: 14px
    fontWeight: '500'
    lineHeight: '1.4'
    letterSpacing: 0.02em
  label-caps:
    fontFamily: Space Grotesk
    fontSize: 12px
    fontWeight: '700'
    lineHeight: '1'
    letterSpacing: 0.15em
spacing:
  unit: 4px
  gutter: 16px
  margin: 24px
  container-max: 1440px
---

## Brand & Style

This design system targets power users and technical operators who require high-density information environments. The brand personality is clinical, covert, and authoritative. It evokes the feeling of a mission-control terminal where AI is an extension of the user’s intent. 

The design style is a hybrid of **High-Contrast / Bold** and **Brutalism**, filtered through a futuristic lens. It prioritizes clarity and status monitoring over softness. Key visual drivers include terminal-inspired interfaces, tactical overlays, and a sense of "active surveillance" of browser tasks.

## Colors

The palette is rooted in deep obsidian blacks to ensure maximum contrast for neon accents. 

- **Primary (Electric Cyan):** Used for active data streams, primary actions, and "AI Thinking" states.
- **Secondary (Neon Lime):** Reserved for "Success" states, completed automations, and secure connections.
- **Tertiary (Cyber Amber):** Used for warnings, manual intervention requirements, and low-priority system logs.
- **Backgrounds:** A tiered system of nearly-black grays (#0A0C10, #14171C) to maintain a sense of depth without losing the terminal feel.

## Typography

The system utilizes a dual-font strategy to distinguish between UI control and system output.

- **UI Controls & Headlines:** **Space Grotesk** provides a geometric, futuristic feel. Headings should often be used in ALL CAPS for a tactical, militaristic appearance.
- **Body Text:** **Inter** is used for descriptions and settings to ensure high legibility during long configuration sessions.
- **Data & Logs:** A system **Monospace** (Courier New or Roboto Mono) is mandatory for all browser automation logs, selector strings, and coordinate data.

## Layout & Spacing

The design system employs a **Fixed Grid** model based on a 4px baseline rhythm. The layout is structured as a series of modular "docks" or "viewports" rather than standard web pages.

- **Grid:** A 12-column grid with 16px gutters. Elements should snap strictly to the grid to maintain a "technical blueprint" feel.
- **Density:** High density is preferred. Padding is minimized in data tables to maximize information visibility.
- **Scanning Lines:** Use a global CSS overlay of faint, horizontal 1px lines at 4px intervals with 0.03 opacity to simulate a CRT or high-tech HUD.

## Elevation & Depth

Elevation is conveyed through **Tonal Layers** and **Glows** rather than soft shadows.

- **Stacking:** Surface levels are defined by increasing brightness of the background hex. Base level is #0A0C10, components sit on #14171C, and modals/popovers sit on #1C2026.
- **Borders:** Every container must have a 1px solid border. Active containers use the Primary Cyan color with a `box-shadow: 0 0 8px rgba(0, 240, 255, 0.3)`.
- **Scanning Animations:** Floating elements should have a "vertical scan" light sweep animation that passes over the surface every 5-10 seconds.

## Shapes

The shape language is strictly **Sharp (0px)**. 

- **Corners:** Right angles reflect precision and structural integrity. 
- **Chamfered Edges:** For primary buttons or headers, use a CSS `clip-path` to create 45-degree "cut" corners (8px) on the top-right and bottom-left to enhance the military-tech aesthetic.
- **Iconography:** Use 2pt stroke-weight icons with open paths. Icons should look like technical schematics rather than illustrative glyphs.

## Components

- **Buttons:** Sharp corners. Primary buttons feature a solid Cyan fill with black text. Secondary buttons are Ghost-style with Cyan borders that "pulse" slowly when hovered.
- **Chips:** Monospace text only. Used for status tags (e.g., `[ RUNNING ]`, `[ STALLED ]`). Enclose in square brackets.
- **Input Fields:** Darker than the background. On focus, the border glows and a small "terminal cursor" (underscore) blinks at the end of the text.
- **Cards/Modules:** Must include a "Header Bar" with a small technical ID in the corner (e.g., `REF_0042`).
- **Progress Indicators:** Use "segmented" bars rather than smooth fills, appearing like a loading sequence on a 90s mainframe.
- **Specialty Component - The 'Command Console':** A dedicated persistent area for raw AI output using the `data-mono` type scale and the amber tertiary color for real-time telemetry.