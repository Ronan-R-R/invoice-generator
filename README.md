# Invoice Generator

A single-page invoice tool for crew on South African commercial shoots. It applies CPA day rates, overtime bands, turnaround penalties, PAYE and non-taxable extras, then exports the invoice as a styled XLSX or an A4 PDF. Invoice numbers run in sequence per browser.

Live: https://ronan-r-r.github.io/invoice-generator/

## Run it locally

Any static file server works. Opening `index.html` from disk also works, but the File System Access save dialog needs `http://localhost`.

```bash
python -m http.server 8765 --bind 127.0.0.1
```

Then open http://127.0.0.1:8765/.

## Test

Node 22 or later, no packages to install.

```bash
npm test
```

The suite covers the rate maths (`js/core.js`), session and directory validation, the XLSX builder (formulas, cached values, styles, formula injection) and the print sheet (escaping). The vendored spreadsheet library is loaded through `node:vm` the same way a browser loads it, see `test/load-xlsx.js`.

## Deploy

GitHub Pages serves the `main` branch from the repository root. Pushing to `main` redeploys. There is no build step.

## Layout

| Path | What it does |
| --- | --- |
| `index.html` | Markup, CSP, dialogs |
| `css/styles.css` | Screen styles, phone card layout, print sheet |
| `js/core.js` | Pure logic: rates, turnaround, totals, invoice numbering, input validation |
| `js/xlsx-export.js` | Builds the styled workbook |
| `js/print.js` | Builds the A4 sheet that the PDF export prints |
| `js/app.js` | DOM wiring, autosave, directory, session files |
| `vendor/` | xlsx-js-style 1.2.0 and its Apache-2.0 licence |

## Invoice numbers

Format is `PREFIX-YYYY-NNNN`, for example `INV-2026-0007`. The year comes from the invoice date.

- The number on a new invoice is a preview. It is used up the first time that invoice is exported (XLSX or PDF). Exporting it again keeps the same number.
- Typing a number by hand is allowed. If it matches the current prefix and is higher than the counter, the counter jumps past it.
- The prefix and next number are set from the `#` button next to the field.
- The counter lives in this browser's `localStorage`. Two devices, or two browsers on one device, keep separate counters. Set the next number by hand when switching.

## Data and privacy

Nothing leaves the browser. There is no backend, analytics or tracking. The CSP in `index.html` only allows scripts from this origin and fonts from Google Fonts.

Stored in `localStorage` until you press **Clear saved data** in the footer:

- `ig_invoice_autosave`: the current invoice, including ID number and bank details
- `ig_invoice_sequence`: prefix and next invoice number
- `ig_dir_crew`, `ig_dir_production`: the directory

Every GitHub Pages project under one account shares the `<user>.github.io` origin, so any other Pages site on the same account can read this storage. Use a custom domain if that matters.

Session files (`.cpa`) and directory exports (`.json`) are plain JSON and are validated against an allowlist on load. Files from the original single-file version load as-is.

## Vendored dependency

`vendor/xlsx-js-style-1.2.0.min.js` comes from [xlsx-js-style](https://github.com/gitbrent/xlsx-js-style) 1.2.0, a SheetJS 0.18.5 fork that writes cell styles. SheetJS community edition silently drops them.

- Source: `https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.min.js`
- SHA-256: `af16b32bf790003c0a6bc912c70706396ec495cf64dfa144c607e7b705bd12c0`
- Licence: Apache-2.0, see `vendor/xlsx-js-style-LICENSE`

The package has not been released since April 2022. The app only writes workbooks and never parses XLSX input, so the SheetJS parser advisories (CVE-2023-30533, CVE-2024-22363) do not apply.

## Licence

MIT, see `LICENSE`.
