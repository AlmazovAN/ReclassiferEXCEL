# SQLite WASM vendor slot

Reclassifier pins the official SQLite WASM release **3.53.4** (`sqlite-wasm-3530400.zip`).

The build accepts exactly one offline vendor form:

- `vendor/sqlite/sqlite-wasm-3530400.zip`

Before extraction the complete archive is verified against the pinned SHA3-256:

`e4fa7e1750b42f6954115d8e69ffff7dc08da7e9fee6e28a2a0ea6bf228a49f2`

Only after that check does the build extract `jswasm/sqlite3.js` and `jswasm/sqlite3.wasm` and embed them into the single HTML.

Loose local files `sqlite3.js` / `sqlite3.wasm` are intentionally **not accepted**. A matching version string or WASM header is not a sufficient supply-chain check.

If the verified archive is absent, `build/build.py` downloads the same pinned release from sqlite.org and applies the same SHA3-256 verification before extraction.

The runtime itself never fetches SQLite assets from the network.
