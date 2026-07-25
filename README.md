# FLPR Website Beta D2.2

This package includes:

- Official ranking, handicap, awards and 20 player profiles
- D2.1 automatic individual player analysis
- D2.2 Americano Padel URL integration test importer
- Netlify serverless function for fetching and parsing public `/print/` tournament pages
- Duplicate-ID checking, player registry matching and TEST staging

## Deploy to Netlify

1. Unzip this package.
2. Upload the **folder** to a Git repository and connect it to Netlify. This is recommended because Netlify must install the `cheerio` dependency and deploy the serverless function.
3. Build command: leave blank or use `npm install`.
4. Publish directory: `.`
5. Functions directory is already configured in `netlify.toml`.

A simple drag-and-drop static deployment may publish the pages but may not build the serverless importer. Git-based Netlify deployment is therefore recommended for D2.2.

## Current safety boundary

D2.2 alpha imports tournament data only into browser TEST staging. It does **not** yet write to a permanent cloud database and does not recalculate the official FLPR ranking. This protects official results while the parser is validated against real and dummy tournament pages.

## Next production step

Connect approved staging imports to a persistent database (for example Supabase), implement player alias review, and run the FLPR recalculation engine after approval.


FLPR V1.0 PRODUCTION UPDATE
- Army Blue production visual identity
- Live Rating Change movement center
- Player-level before/after rating explanation
- Production baseline snapshot
- No artificial rating movement: first real delta appears after the next approved tournament
