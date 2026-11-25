# Design: Pune Giving Planner

Recorded from the shipped build (`styles.css`, `index.html`). Every new UI here follows this file.

## North star: "a year of jars"
A giving year is twelve glass jars that fill with marigold as you plan. The hero holds one big jar that coins drop into; the planner fills a jar per month; the 404 has a thirteenth, empty jar you can fill. Money becomes something you can see filling up, without the planner ever claiming what it buys (only the charity says that).

## Colour
| Token | Value | Use |
| --- | --- | --- |
| `--ground` | `#f3f8fc` pale sky | Page ground |
| `--sky` | `#e2f0f8` | Planner band, legal page heroes, table heads |
| `--mint` | `#d9f1e8` | Soft hero blob, open FAQ toggle |
| `--ink` | `#1f2f3d` deep ink | Headings, strong text, footer ground |
| `--body` / `--muted` | `#46525c` / `#5f6b74` | Body and meta text |
| `--teal` / `--teal-deep` | `#0f766e` / `#0b5c56` | The one action colour (buttons, links, lids, focus) with white text |
| `--marigold` / `--marigold-deep` | `#f2a93b` / `#c97b0a` | The gifts: jar fill, coins, headline highlight. Never text on white. |
| `--line` | `#cfe1ec` | Borders |

No cream or beige grounds, no purple, no gradients on text.

## Type
Baloo 2 (600) for display, Nunito for reading, one Caveat aside per view ("your plan stays on your device"). Sentence case everywhere; the runtime's all-caps panel headings are reset to sentence case.

## Shape and depth
Pills for buttons and nav, 24 to 32px card radii, jars with 22/26px rounded corners, organic blob shapes, a wave edge into the planner band. Shadows are soft and ink-tinted (`0 14px 34px -16px rgba(31,47,61,0.22)`); no coloured glows. Focus is a 3px teal outline.

## Motion
Out-expo `cubic-bezier(0.16, 1, 0.3, 1)`. Moments: hero coins drop and the jar floats and sloshes; month jars fill in a 40ms stagger as you plan; the 404 jar wobbles and fills per coin; FAQ toggles rotate. Everything collapses under `prefers-reduced-motion`.

## Components
- **Panel**: white, 32px radius, `--line` border, soft shadow.
- **Jar**: see `planner.js` `render()`; `--level` drives the fill (full jar = ₹10,000 a month).
- **Buttons**: `.btn-primary` teal fill with white text (one per view), `.btn-ghost` teal outline.
- **FAQ**: native `<details>`, Baloo summary, round `+` that turns 45° when open. Same text as the FAQPage JSON-LD.
- **Legal pages**: `.page-hero` on sky with breadcrumbs, `.legal` prose at about 70ch, rounded tables.
- **Assistant**: the agentic-web runtime themed through `--ns-*` variables; providers the CSP blocks are hidden.
