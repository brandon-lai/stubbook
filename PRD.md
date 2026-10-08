# Ticket Collage PRD

Oct 7, 2026 · @Brandon

## Overview

Ticket Collage (working name) turns the tickets from your trips into a collage you can arrange, keep, and share. You scan a paper boarding pass, train ticket, subway card, or concert stub with your phone camera, or upload a digital one, and it becomes a cut-out ticket on your collage page.

The problem: paper tickets get lost or thrown out, and digital ones sit buried in email and wallet apps. Both are small records of where you have been, and today there is no good place to keep them together.

The page works like a scrapbook first and a social profile second. Every collage is private by default, and you choose when to share it.

## Goals and non-goals

**Goals for v1**

- Capturing a ticket takes under 15 seconds from opening the camera to seeing it on the collage.
- Every ticket keeps the look of the original (paper texture, colors, logos) while sensitive data is hidden.
- The collage feels physical: tickets can be dragged, rotated, layered, and resized.
- Private by default, with simple per-collage sharing.

**Non-goals for v1**

- Not a ticket wallet. Saved tickets are keepsakes, not valid for boarding or entry.
- No booking, price tracking, or flight status.
- No full social feed, likes, or follower graph. Sharing a link comes first; social features come later if people want them.
- No direct import from airline or rail accounts.

## Target users and use cases

The core user is someone who already keeps ticket stubs in a drawer or shoebox and wants them somewhere better. These are assumed segments to validate, not researched ones.

| User | What they want | Example |
| --- | --- | --- |
| Frequent traveler | A running record of every trip | Adds each boarding pass after landing |
| Couple or friends | A shared memory of trips together | One collage for a Tokyo trip, both add tickets |
| Event-goer | Concert, game, and museum stubs in one place | A collage of every show in 2026 |
| Collector or nostalgic | Old paper tickets saved before they fade | Scans a box of stubs from years past |

**Use cases for v1**

1. Scan a paper ticket right after a trip and see it land on the collage.
2. Upload a screenshot or PDF of a mobile boarding pass.
3. Arrange tickets by hand into a layout that looks good.
4. Keep one collage per trip, per year, or one for everything.
5. Share a read-only link to a collage with friends.

## User flow

Scanning and uploading join into one pipeline, and the ticket is placed for you before you touch the canvas.

&#91;embedded content: capture to collage · 2 ways in, 7 steps\]

Arranging and sharing are optional. A user who only scans still ends up with a finished-looking collage.

## Functional requirements

**Capture**

- Live camera scan with edge detection, auto-crop, and perspective correction, like a document scanner.
- Works on curved or creased paper and in low light. Manual corner adjustment as a fallback.
- Upload from photos, files (PDF, PNG, JPG), or the share sheet (for example, sharing a boarding pass PDF from email).
- Background removed so the ticket looks like a cut-out, with a soft shadow on the canvas.
- Batch scan: capture several tickets in a row without leaving the camera.

**Ticket parsing**

- Read text from the ticket and pull out type (flight, train, subway, event, other), origin, destination, date, carrier or venue, and seat when present.
- Decode the barcode or QR code when possible, since boarding pass barcodes often hold cleaner data than the printed text.
- Show parsed fields for a quick confirm or edit. Never block saving on a failed parse.
- Detect and blur sensitive data by default: barcodes, booking references, ticket numbers, and frequent flyer numbers. The user can turn blur off per ticket for private collages only.

**Collage canvas**

- Free-form canvas: drag, rotate, resize, and change layer order with touch gestures and mouse.
- Auto-place: new tickets land in an open spot with a slight random tilt, so the page looks hand-made without any effort.
- Auto-arrange options: by date, scattered, or a tidy grid. The user can always move things after.
- Tap a ticket to flip it and see the details: route, date, and an optional note or photo.
- Multiple collages: one per trip, per year, or a single running collage.
- Background choices (cork board, kraft paper, plain) as a later polish item.

**Privacy and sharing**

- Every collage is private by default.
- Three levels per collage: private, link-only, and public on the user's profile.
- Shared views are read-only and always use the blurred version of each ticket.
- Optional: hide exact dates on shared collages and show only month and year.

## Technical approach and data model

The recommended path is a native iOS app for capture, since scanning quality decides whether the product feels good. A web viewer for shared collages keeps sharing frictionless. These are options to weigh, not decisions.

**Capture and parsing options**

| Step | iOS native option | Web option |
| --- | --- | --- |
| Edge detection and crop | VisionKit document camera | OpenCV.js on a camera stream |
| Cut-out background | Vision foreground mask | Server-side segmentation model |
| Text reading | Vision text recognition | Server-side OCR |
| Barcode | Vision barcode detection | A JS barcode library |
| Field extraction | AI vision model on the cropped image, returning structured JSON | Same |

Most airline boarding passes encode data in the IATA Bar Coded Boarding Pass (BCBP) format, so decoding the barcode can give route, date, and seat without OCR. Train, subway, and event tickets vary widely, so an AI vision model is the general fallback.

**Data model (first pass)**

| Object | Key fields |
| --- | --- |
| User | id, handle, display name, default privacy |
| Ticket | id, owner, original image, cut-out image, blurred image, type, origin, destination, date, carrier or venue, seat, note, parse confidence |
| Collage | id, owner, title, background, visibility (private, link, public), share token |
| Placement | collage id, ticket id, x, y, rotation, scale, z-order |

Keeping Placement separate from Ticket lets one ticket appear on several collages (for example, a trip collage and a yearly collage). Store the original image privately and serve only the blurred image on shared views.

## MVP scope and roadmap

The MVP is Phase 2: scan, read, blur, arrange, and share by link. Each phase starts only after the gate before it is met.

&#91;embedded content: roadmap · 4 phases, 3 gates\]

The prototype tests the riskiest part first: whether a phone scan of a crumpled ticket looks good enough on a canvas that people want to keep doing it. Gates are proposed checks, not measured targets yet.

## Risks and success metrics

The biggest risk is privacy: a shared boarding pass can expose more than people expect. A booking reference plus a last name is often enough to open a reservation on an airline site, and a boarding pass barcode can contain that data.

| Risk | Mitigation |
| --- | --- |
| Sensitive data leaks on shared collages | Blur barcodes and booking codes by default; shared views only ever use blurred images |
| Location and travel patterns exposed | Private by default; option to hide exact dates; warn before making a recent trip public |
| Poor scans on creased or shiny tickets | Manual crop fallback; save the ticket even when parsing fails |
| Parsing errors on non-airline tickets | Confirm screen with editable fields; type "other" always allowed |
| Low repeat use between trips | Batch import of old tickets; yearly collage that fills up over time |
| Copyright or trademark concerns with carrier logos | Open question; tickets are the user's own items, but worth checking before public profiles launch |

**Success metrics (proposed)**

- Scan success: share of captures saved without a manual crop.
- Parse accuracy: share of tickets where the user changes no fields.
- Activation: share of new users who add 3 or more tickets in their first week.
- Retention: share of users who add a ticket in a second month.
- Sharing: share of collages set to link or public.

## Open questions

These are the decisions that shape the build. Each one changes scope.

- [ ] Platform: native iOS first, web first, or both from day one?
- [ ] One collage or many? A single running page is simpler; per-trip collages are more personal.
- [ ] How social should it be? Share links only, public profiles, or a feed of friends' collages?
- [ ] Shared collages: can two people add tickets to the same collage (for example, a trip with a partner)?
- [ ] Do digital tickets get a "paper" look, or stay as screenshots? Rendering a mobile pass as a printed stub could make the collage feel consistent.
- [ ] Should auto-place be the default, with manual arranging optional, or the other way around?
- [ ] Is there a print or export option (poster, phone wallpaper) as a way to make money later?
- [ ] Name: "Ticket Collage" is a placeholder.
