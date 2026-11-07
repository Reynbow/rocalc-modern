# RO Classic + calculator

A new interface, in the roclassicplus.com style, for Kurimet's pre-renewal calculator,
[rocalc.com](https://rocalc.com/). It follows rocalc's releases.

It lives on the website at `roclassicplus.com/?module=calculator`. The page there is the
FluxCP module in `RO_PreRenewal/1_Database/www` (`modules/calculator`,
`themes/roclassicplus-dark/calculator`); its files are `www/calc/`, written by
`npm run site`. The game's Stats window has an "Open in calculator" button
(`5_Legacy/src/UI/CustomTheme/RoCalcExport.js`) that opens it with the character loaded
through a `#build=` link (format in `app/app.js`, "builds sent from the game").

## How it works

- `upstream/<release>/` holds rocalc's own files exactly as rocalc.com serves them.
  `upstream/CURRENT` names the release in use.
- `dist/engine.html` is rocalc's page, untouched. It runs in a hidden frame and does
  every calculation.
- `dist/index.html` is our interface (`app/`). Each control mirrors one of rocalc's form
  fields: changing it sets rocalc's field and fires its event, then everything is redrawn
  from rocalc's page. Character, stats, equipment and results have hand-made layouts.
  Buffs, combat, saves and options are drawn straight from rocalc's markup, so fields a
  new release adds show up without code changes.

## Updating to a new rocalc release

rocalc.com sits behind a browser check, and your home connection only reaches it through
the VPN in Chrome. So a new release is fetched through Chrome:

1. One-time setup: run `npm run bookmarklet`, make a Chrome bookmark, and paste the printed
   `javascript:` link as its URL. Name it "Save rocalc".
2. With the VPN on, open rocalc.com in Chrome, wait for the calculator, click "Save rocalc".
   It downloads `rocalc-<release>.json` to Downloads.
3. Run `npm run sync`. It imports the newest snapshot from Downloads into `upstream/`,
   builds `dist/`, runs the smoke test, and only if every check passes copies the
   calculator into the website's `www/calc/`.
4. Deploy the website as usual (the `www` job of `deploy-to-vps.ps1`, run on the VPS).

rocalc dates its scripts (`head_2026-04-06.js`), so the release name comes from those.
Its changelog is on the "Server and options" tab.

If the smoke test fails, rocalc changed something the interface depends on. The live site
keeps the previous release until it's fixed.

## Commands

| Command | What it does |
| --- | --- |
| `npm run sync` | Import the newest snapshot, build, test, copy to the website |
| `npm run site` | Build and copy to the website's `www/calc/` (no import, no test) |
| `npm run import [file]` | Import a snapshot (default: newest `rocalc-*.json` in Downloads) |
| `npm run build` | Build `dist/` from `upstream/CURRENT` |
| `npm test` | Smoke test `dist/` in headless Chrome |
| `npm run serve` | Serve `dist/` on http://localhost:4317 |
| `npm run bookmarklet` | Print the "Save rocalc" bookmark link |

## Credits

The calculator is rocalc by Kurimet, built on ROratorio, Doddler, Gandi and Triper's work.
The font is Galmuri11 (SIL Open Font License, `app/fonts/Galmuri-LICENSE.txt`).
