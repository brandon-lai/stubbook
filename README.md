# Stubbook

**Stubbook turns the tickets from your trips into a collage you can arrange, keep and share.** Scan a paper boarding pass, train ticket, metro card or concert stub with your phone camera, or upload a screenshot or PDF; it becomes a cut-out on your collage, with barcodes and booking codes blurred.

Built from the *Ticket Collage PRD* (Oct 7, 2026; copy in `PRD.md`). The MVP is the PRD's Phase 1 + Phase 2: scan, crop and cut out, read and blur, confirm, multiple collages, private and link sharing.

- Live: https://stubbook.vercel.app
- Repo: https://github.com/brandon-lai/stubbook

## What works

| | Status |
| --- | --- |
| Live camera scan | Edge detection on the video at ~8 fps, outline drawn live, auto-capture when the outline holds still for ~0.7 s, shutter any time, torch where the phone supports it. |
| Crop and cut-out | Perspective correction, then GrabCut inside a margin so torn edges, rounded corners and perforated stubs keep their outline. Manual corner adjustment as the fallback. |
| Upload | Photos, screenshots and PDFs (first page). Tight crops are kept whole; photos with a table around the ticket are cut out like a scan. Android share sheet via the installed PWA's share target. |
| Reading | IATA BCBP boarding-pass barcodes decoded exactly (route, date, flight, seat); OCR + heuristics for everything else; editable confirm screen. Saving never waits on a failed parse. |
| Blur | Barcodes (found from pixels, decodable or not), booking references, ticket numbers and frequent flyer numbers, blurred into the image itself. Tap a box to unblur it, draw to add one, preview exactly what a share shows. Per-ticket "blur off" changes only the owner's own view. |
| Collage | Free-form board: drag, two-finger rotate/resize, handles for mouse, layer order, tap to flip to the back (route, date, note, photo), keyboard controls. Auto-place with a slight tilt; arrange by date, scattered, or tidy grid. |
| Multiple collages | One per trip, per year, or one for everything; a ticket can sit on several (placements are separate from tickets). |
| Sharing | Private by default. "Anyone with the link" publishes a read-only view that only ever has the blurred images; it re-publishes itself as you edit; "Stop sharing" deletes it from the server. Warns when sharing a ticket from the last two weeks. |

## How it was verified

The PRD says the riskiest question is whether a phone scan of a crumpled ticket looks good enough. So the capture pipeline was built first and measured on test images before any UI existed.

**Fixtures** (`fixtures/`):
- 7 fictional tickets rendered with real, decodable barcodes (valid BCBP strings in PDF417 and Aztec), each with ground truth: the correct fields and the sensitive strings that must not survive.
- The 5 paper ones photographed 6 ways each by `scripts/fixtures/photograph.py`: on wood, on linen with creases, on marble with a curl, on slate in low light, on a white desk, and tilted with glare. The true corners are recorded for each.
- 22 real ticket photos from Wikimedia Commons, licences in `fixtures/real/meta.json`.

**`node scripts/lab.mjs`** runs the real pipeline in Chrome on all 54 and scores it:

| Measure | Result |
| --- | --- |
| Corners found (IoU ≥ 0.9 against truth) | 25 / 30 synthetic photos; mean IoU 0.91. The 5 misses are curl on marble, low light on slate and glare, all recoverable with the corner editor. |
| Privacy: nothing decodable and no sensitive string readable by OCR in the blurred output | **54 / 54**. Checked on a light background, a dark one, and with alpha stripped. |
| Boarding-pass fields from the barcode | Route, date and seat exact whenever the barcode reads (all boarding-pass photos, the wallet screenshot and the PDF). |
| Time per ticket (cut + read + blur + verify) | Median 0.9 s, max 2.2 s on a laptop. |

**`node scripts/e2e.mjs`** runs end to end on a 390 px phone viewport:
- sample scan → confirm → collage
- PDF upload → collage
- flip, drag, arrange, reload
- the live camera, using Chrome's fake camera fed a video of a ticket on a table

**Measured from opening the camera to the ticket on the collage: 3.4 s**, including the scripted tap on Save. The PRD's goal is under 15 s.

`pnpm test` runs 29 unit tests: the BCBP decoder, dates in nine formats, routes, seats, the sensitive-data rules (including what must *not* be blurred), auto-place (40 tickets, no ticket more than 12% covered), and arrange.

### What verification found

All of these were fixed; the commit messages have the details.
- zxing reports a 1D barcode as a single scanline, so the blur covered a stripe and the bars above and below still decoded. 1D boxes now grow to the full bar height, and a loop re-decodes the blurred output until nothing reads.
- Fully transparent pixels in the cut-out still held the photo, including part of a barcode the mask had trimmed. Anyone stripping the alpha channel would have seen it. Transparent pixels are now wiped.
- A booking reference under glare was only read by a second OCR pass, so every scan now OCRs its own blurred output and blurs anything still readable. The booking reference decoded from the barcode is also blurred wherever else it is printed.
- Bold text ("Milano", "DEVOE", a header) passed the bar-pattern test for 1D barcodes until a bar-coherence check was added.
- Tight crops uploaded from a photo library went down the paper path and GrabCut ate them. The fix is an edge-density test outside the outline: real surfaces measured 0.000–0.014, crops 0.028–0.112.
- The scanner's outline canvas covered the no-camera fallback, so its buttons couldn't be tapped.
- The OpenCV build is an Emscripten "thenable"; resolving a Promise with it hung the page.

## Decisions

The PRD leaves platform and stack open. Each choice below has its reason.

- **Name: Stubbook.** It says what it is (a scrapbook of stubs), it's short, and it was free on GitHub and Vercel.
- **Web first, as a PWA.** The PRD recommends native iOS for scan quality. I can't ship an App Store build from here, and a web app can be verified and deployed today. The question was whether browser scanning is good enough, so it was measured (above). On iOS, VisionKit would still beat this in hard cases (curl, glare); the pipeline is isolated in `lib/scan/` so a native capture app could replace it and keep everything else.
- **The owner's data stays on the device (IndexedDB).** Original photos and unblurred cut-outs never leave the phone. The server holds only shared collages, and only the blurred images. The PRD says "store the original image privately", and this is the most private version of that. It also means the whole product works with no database at all. The cost is no sync between devices and no account. Tickets live in one browser, and storage is marked persistent to resist eviction. Accounts and sync come with Phase 3's shared trip collages.
- **On-device reading, not an AI vision model.** The PRD lists a vision model as the general fallback. There's no API key here, and the free path (BCBP barcodes plus on-device OCR) gets boarding passes exactly. Other tickets get a best effort that the user confirms. Adding a vision model is one server route away (see Next).
- **Blur is applied to pixels, coarsely.** Regions are averaged into roughly character-sized cells, not lightly Gaussian-blurred, because a light blur over text can be partly undone. The blurred image is a separate file, and it's the only image a share can contain: the share schema has no field for any other.
- **Over-blur rather than under-blur.** A false positive costs one tap to unblur on a private collage. A false negative can put a booking reference on a public link.
- **Two visibility levels in the MVP: private and link.** "Public on profile" and "hide exact dates" are Phase 3 in the roadmap, so they aren't built.
- **Not built because the roadmap puts them later:** batch scan, backgrounds, print/export, paper look for passes, shared trip collages, public profiles.
- **Stack:** Next.js 16 (app router), TypeScript, plain CSS. postgres.js with Postgres for shares only. OpenCV.js, zxing-wasm, tesseract.js and pdf.js, all self-hosted under `/vendor`, so scanning sends nothing to a CDN.

## PRD open questions, answered

| Question | Answer shipped |
| --- | --- |
| Platform: iOS first, web first, or both? | **Web first (installable PWA).** Measured good enough on the fixtures; a native capture app can replace `lib/scan/` later if real-world curl and glare demand it. |
| One collage or many? | **Many.** A first scan creates "My tickets"; more collages are one tap away, and a ticket can sit on several. |
| How social? | **Share links only.** Read-only, revocable, noindex. Profiles and feeds wait for the Phase 2 gate ("people share collages by link"). |
| Can two people add to one collage? | **Not in v1.** It needs accounts and sync, which local-first defers. It's the first Phase 3 item. |
| Paper look for digital tickets? | **No: they stay as screenshots,** cropped to the pass with softly rounded corners. The roadmap puts the paper look in Phase 4. |
| Auto-place default or manual default? | **Auto-place is the default.** A user who only scans still ends up with a finished-looking collage; everything can be moved after. |
| Print or export? | **Not in v1** (Phase 4). The layout is a fixed-width board in board units, so a poster or wallpaper renderer can reuse it directly. |
| Name? | **Stubbook.** |

The carrier-logo question from the risks table is still open, and only matters for public profiles, which aren't built.

## What's blocked, and how to finish it

**Link sharing needs a database.** Everything else works in production now. Supabase's free tier allows 2 active projects per user, and `heatcheck` and `attn` hold both slots. I didn't pause either, since they're live products. Until a database is set, the share dialog says plainly that sharing isn't switched on, and the rest of the app is unaffected.

To finish:
1. Free a Supabase slot, or use any Postgres.
2. Set the URL: `vercel env add DATABASE_URL production`. Use the transaction pooler URL, port 6543, from `GET /v1/projects/<ref>/config/database/pooler`.
3. Apply the migration: `DATABASE_URL=... pnpm db:migrate`. It enables RLS on every table, with no policies, so only the server can read them.
4. Push any commit to redeploy.

`IP_HASH_SECRET` is already set in production.

## Next

- An optional AI vision fallback for non-airline tickets: a server route that receives the *blurred* image, so the booking reference never goes to a third party. It needs an API key and the go-ahead to spend.
- The Phase 1 gate in the real world: whether real phone scans of real crumpled tickets look like cut-outs. The fixtures are the best stand-in available here.
- Accounts and sync, then shared trip collages (Phase 3).

## Run it locally

```bash
pnpm install                 # also copies the scanner runtimes into public/vendor
pnpm dev                     # http://localhost:3340
pnpm test                    # unit tests
node scripts/lab.mjs         # pipeline scores on every fixture (dev server running)
node scripts/e2e.mjs         # end to end in Chrome, including the fake camera
```

For sharing locally, add `DATABASE_URL=postgres://localhost:5432/stubbook` to `.env.local` and run `pnpm db:migrate`.

## Sources

- Real ticket photos: Wikimedia Commons, used as test fixtures only. Authors, licences and links are in `fixtures/real/meta.json`. The three on the landing page's sample collage (Hawkwind, Bell Biv DeVoe, Cairo bus) are public domain or CC0.
- OCR model: `eng.traineddata` from tesseract.js-data, Apache-2.0.
- Fonts: Fraunces and IBM Plex Mono (SIL OFL), via `next/font`.
