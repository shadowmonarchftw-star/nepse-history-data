# nepse-history-data

6+ year NEPSE OHLCV history (2019–2026). Auto-generated from public data.

- `ohlcv/{SYMBOL}.json` — per-stock daily OHLCV, 396 symbols
- `index/{BENCHMARK}.json` — NEPSE composite + sector indices
- `sector/{SECTOR}.json` — sector aggregate data

Format: `[{date, o, h, l, c, v}, ...]` sorted ascending.
