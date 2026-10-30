# Hoardwise brand kit

**The mark:** a dragon asleep around a single coin. The hoard is safe and nobody is panicking about it. The closed eye is deliberate: it keeps the mark calm for a low-stimulation app.

## Files

| Path | Use |
|---|---|
| `logo/hoardwise-mark.svg` | Mark on light backgrounds (green dragon, gold coin) |
| `logo/hoardwise-mark-dark-bg.svg` | Mark on dark backgrounds (all gold) |
| `logo/hoardwise-mark-mono.svg` | One colour, uses `currentColor`, details are cut-outs |
| `logo/hoardwise-wordmark*.svg` | Wordmark only (Lora SemiBold, converted to outlines, no font needed) |
| `logo/hoardwise-lockup*.svg` | Mark + wordmark, for the app header and login screens |
| `public/` | Drop-in files: PWA icons, maskable icon, favicons, apple-touch-icon, iOS splash screens, OG image |
| `social/` | GitHub social preview (1280×640), PikaPods icon, 500×500 avatar for GitHub org / GHCR |
| `code/` | Mantine theme, CSS tokens, `<head>` tags, manifest snippet |

## Colours

| Name | Hex | Role | Contrast |
|---|---|---|---|
| Pine | `#10302B` | Headings, dark surfaces, theme colour | 12.9:1 on Mist |
| Hoard | `#1E5F57` | Primary actions, links | 7.4:1 on white |
| Gold | `#D9A441` | Logo and illustration only | 2.3:1 on white (fails as text), 6.3:1 on Pine |
| Gold text | `#86601A` | Gold-coloured text on light | 5.7:1 on white |
| Mist | `#F2F5F3` | App background | — |
| Ember | `#A4492A` | Warnings, overspend | 5.9:1 on white |

Dark mode: surface `#0C1F1C`, text `#DDE7E3` (13.5:1), primary `#5FB3A6` (6.9:1), gold `#E3B65C` (9.1:1), ember `#E08A68` (6.5:1). All pass WCAG AA for body text.

## Rules

- Gold is for the logo and fills. Text that needs to look gold uses Gold text (`#86601A`) on light.
- Never let colour alone carry meaning: overspend uses Ember **plus** an icon or a "−" sign; income uses a "+" sign, not just green.
- Keep at least the coin's radius of clear space around the mark.
- Don't rotate the mark, add effects, or put the green version on dark backgrounds.

## Typeface

Lora (SIL Open Font License, on Google Fonts). The logo files already have the text outlined; `brand-theme.ts` uses Lora for the UI, so self-host or load it from Google Fonts if you adopt that.
