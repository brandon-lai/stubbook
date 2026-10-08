# Fixtures

Test images for the capture pipeline. None of these ship in the app.

- `synthetic/flat/` — seven fictional tickets rendered by `scripts/fixtures/tickets.mjs`. Every barcode is real and decodes; the boarding passes carry valid IATA BCBP strings. `synthetic/truth.json` has the correct fields and the sensitive strings that must not survive the blur.
- `synthetic/photos/` — the five paper tickets photographed six ways each by `scripts/fixtures/photograph.py` (wood, linen with creases, marble with curl, slate in low light, white desk, tilt with glare). `synthetic/photos.json` has the true corners.
- `real/raw/` — real ticket photos from Wikimedia Commons, used to check the scanner and the blur against real paper. Licences and authors are in `real/meta.json` (public domain, CC0, CC BY-SA 3.0/4.0); each entry links its Commons page.

Run `node scripts/lab.mjs` with the dev server up to score the pipeline on all of them.
