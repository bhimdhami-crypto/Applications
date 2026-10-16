# UI design

## Visual identity

The palette follows KTM's motorcycle branding: **orange `#FF6600`** on near-black and white. Tokens live in `packages/shared/src/theme.ts` and are shared by the web portal and the future mobile app.

| Token | Light | Dark | Use |
|---|---|---|---|
| `accent` | `#FF6600` | `#FF6600` | Buttons, active menu item, stat bars, sidebar edge |
| `onAccent` | `#141414` | `#141414` | Text on orange (white on this orange fails contrast) |
| `accentText` | `#B84700` | `#FF8533` | Links and orange text on page backgrounds |
| `sidebar` | `#141414` | `#000000` | Navigation rail |
| `bg` / `surface` | `#F6F6F4` / `#FFFFFF` | `#0E0E0E` / `#181818` | Page and cards |

Every text and background pair meets WCAG 2.2 AA (4.5:1); a unit test (`packages/shared/src/reference.spec.ts`) checks the ratios so a palette change cannot quietly break it.

## Themes and language

- Light, dark, or follow the device, chosen from the top bar and remembered per browser. The page sets the theme before first paint, so there is no flash.
- Language menu: English, Kiswahili, French and Arabic for now (draft translations, flagged for professional review). Choosing Arabic flips the whole layout right to left; the CSS uses logical properties (`inline-start`, `inline-end`) so components mirror correctly.
- Dates and numbers use the browser's `Intl` formatting in the chosen language; currencies use their ISO decimal places.

## Layout

- Left navigation rail with an orange edge, grouped by section and filtered by the user's permissions. Upcoming modules are listed greyed out with their phase number.
- Top bar: company switcher (only companies in the user's scope), language, theme, user and sign-out.
- Footer on every page: "Designed and developed by Bhim Dhami · © 2026 Bhim Dhami. All rights reserved." and the demonstration disclaimer. The credit also appears on the sign-in page, in the sidebar, in every email and in the API documentation.
- Below 900 px the rail becomes a slide-in menu, cards stack, and tables scroll sideways inside their frame.

## Components

Cards with an orange top bar for key figures, data tables, badges for status, tabs, collapsible panels, inline forms with labels above fields, alerts for errors and success, and pagers on every list that can grow (users, audit). All controls are native elements with visible focus rings for keyboard use.

## Screens in this release

Sign-in (two steps), accept invitation, home, organisation list, company detail (structure, modules, details), users and roles, countries and currencies, audit log, my account (devices and password).
