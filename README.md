# Spiro

Design the cogs and rings for a large-scale physical spirograph, see what they
will draw, and export 1:1 SVG for a laser cutter.

**[Try it in your browser](https://edmonkey-nz.github.io/spiro-designer/)** — no
install, no sign-up.

It exists to answer two questions before you burn a sheet of ply:

- will these two tooth counts mesh and roll without binding?
- what does hole #7 in the 43-tooth cog draw inside the 157-tooth ring?

```
npm install
npm run dev     # http://127.0.0.1:5173/spiro-designer/
```

Static app, nothing leaves your machine. Designs save as JSON.

![The simulator: a 96/30 pair tracing two pen holes at once, with the generated
gear outlines rolling in real time](spiro-ui.png)

![The Sheets tab: seven parts on one 900x600 sheet, three of them nested inside
the ring interiors, ready to export as 1:1 SVG](spiro-output.png)

## Cut the fit coupon first

`Export fit-test coupon` gives you a small cog and a matching ring arc at your
current module, kerf and backlash, with those numbers engraved on it. Cut it,
feel the mesh, adjust `kerf` and `backlash`, then commit to a full ring.

Those two depend on your laser, your material and today's focus. The app cannot
know them, and everything else it produces depends on them.

## What it does

- **True involute gears** — external cogs, internal rings, straight racks. Set
  module, pressure angle, backlash, clearance, profile shift, root fillet.
- **Kerf as a parameter, not a post-process.** Paths are drawn offset by half
  the kerf so the *cut* part comes out nominal.
- **Four rolling modes** — inside a ring, outside a ring, cog on cog, cog on a
  rack.
- **Non-circular rings** — eggs, ovals, rounded triangles, flowers, blobs, from
  one or two harmonics.
- **A simulator** that rolls the real generated gear outlines, with the pen at
  an actual hole's engraved radius. Play, scrub, several pens at once.
- **Real part features** — numbered pen holes with their radii engraved, hub
  bore and boss, bolt circles, mounting holes, lightening cutouts, labels.
- **Bed-aware output** — live check against your bed; oversized rings split
  into segments with bolt-on splice plates; parts nested onto sheets, including
  into the empty interiors of rings.
- **Export** — 1:1 mm SVG with cut and engrave on separate layers, per part or
  as nested sheets. Pattern as SVG and PNG. Design as JSON, with autosave.

## Two rules for non-circular rings

Both are enforced, but they are worth knowing before you start:

1. **The perimeter must be a whole number of tooth pitches**, or the last tooth
   collides with the first. So the shape is scaled to the tooth count, not the
   other way round — change the tooth count to change the size.
2. **The cog must fit the tightest bend.** It cannot reach into a corner
   sharper than itself. The panel reports the minimum radius of curvature and
   the largest cog that fits.

## Layout

```
src/geom/     pure TypeScript, no React, no DOM — mm, Y-up, radians
src/state/    zod schema, zustand store, storage, presets, exporters
src/ui/       React panels and canvas views
tests/        vitest over src/geom and the design document
```

`svg.ts` is the only module that knows SVG is Y-down.

```
npm test          # 132 tests
npm run typecheck
```

Tests measure the *generated geometry* rather than re-deriving it from the same
formulas. The sharpest two: a cog is rolled the whole way round a ring, circular
or blobby, and checked for collision at every step; and a ring whose "shape" is
a circle must reproduce the plain circular ring exactly.

## Known limits

- Sheet packing works on bounding boxes (MaxRects), not true outlines. Nesting
  into ring interiors is exact, because a ring's hole really is a circle.
- Outer teeth are circle-only — the outside of a blob is a different curve with
  a different perimeter.
- Non-circular rings assume curvature is constant across one tooth. The error
  appears as a step between neighbouring teeth, which is measured and warned
  about; under 0.02mm for every built-in shape, against a 0.18mm kerf.
- Splice plates assume a single-layer ring.
- Profile shift applies to cogs only; rings stay standard.
