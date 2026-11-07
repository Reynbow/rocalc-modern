# RO Classic + calculator

A new interface, in the roclassicplus.com style, for Kurimet's pre-renewal calculator,
[rocalc.com](https://rocalc.com/). It follows rocalc's releases.

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
   builds `dist/`, and runs the smoke test.
4. If every check passes, commit and push. GitHub Actions builds, tests again and deploys.

rocalc dates its scripts (`head_2026-04-06.js`), so the release name comes from those.
Its changelog is on the "Server and options" tab.

If the smoke test fails, rocalc changed something the interface depends on. The live site
keeps the previous release until it's fixed.

## Commands

| Command | What it does |
| --- | --- |
| `npm run sync` | Import the newest snapshot, build, test |
| `npm run import [file]` | Import a snapshot (default: newest `rocalc-*.json` in Downloads) |
| `npm run build` | Build `dist/` from `upstream/CURRENT` |
| `npm test` | Smoke test `dist/` in headless Chrome |
| `npm run serve` | Serve `dist/` on http://localhost:4317 |
| `npm run bookmarklet` | Print the "Save rocalc" bookmark link |

## Credits

The calculator is rocalc by Kurimet, built on ROratorio, Doddler, Gandi and Triper's work.
The font is Galmuri11 (SIL Open Font License, `app/fonts/Galmuri-LICENSE.txt`).
