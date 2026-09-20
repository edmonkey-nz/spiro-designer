# Spiro

A local web app for designing the cogs and rings of a large-scale physical
spirograph machine, simulating what they will draw, and exporting 1:1 SVG for a
laser cutter.

It exists to answer two questions before you burn a sheet of ply:

- **will these two tooth counts actually mesh and roll without binding?**
- **what does hole #7 in the 43-tooth cog draw inside the 157-tooth ring?**

```
npm install
npm run dev     # http://127.0.0.1:5173
```

Nothing is sent anywhere — it is a static app, and your designs live in a JSON
file you save yourself.

## What it does

**True involute gears.** External cogs, internal rings and straight racks, from
a tooth count and a module. Flanks are real involutes of the base circle; the
external root fillet is the analytic trochoid swept by the generating rack's
rounded tip corner, so low tooth counts undercut correctly instead of getting a
plausible-looking circular blend. 20° pressure angle by default, with
addendum, clearance, backlash, profile shift and fillet radius all adjustable.

**Kerf handled as a parameter, not a post-process.** Paths are drawn offset by
half the kerf so the *cut* part comes out nominal. On an involute flank this is
exact: offsetting an involute along its own normal by `d` gives the same
involute rotated by `d/rb`, so the whole compensation is one extra term in the
tooth half-angle. No polygon-offset library, and no surprises.

**Four rolling modes.** Cog inside a ring (hypotrochoid), cog outside a ring
(epitrochoid), cog on a fixed cog, and cog along a straight rack.

**A simulator that cannot drift from the parts.** Press play and the *generated*
gear outlines roll at the real centre distance while the pen traces. The pen
offset is the engraved radius of an actual hole, so what you watch is what the
machine draws. Several pen holes can be traced at once in different colours.

**Parts with the features a real cut needs.** Numbered pen holes with their
radii engraved beside them, centre bore and hub boss, bolt circles, mounting
holes, lightening cutouts, and an identification label on every piece.

**Bed-aware output.** A live check against your 900×600mm bed. Rings too big
are split into arc segments at tooth-space centres — never through a tooth —
and each joint gets a splice plate with bolt and alignment-dowel holes plus
match marks. Parts are nested onto sheets you can preview before exporting.

**Export.** 1:1 SVG in millimetres with cut and engrave on separate layers,
either per part or as nested sheets. The drawn pattern exports as SVG and PNG.
Designs save and load as JSON, with a debounced autosave so a refresh never
loses work.

## Cut the coupon first

`Export fit-test coupon` gives you a 20T cog and a matching ring arc at your
current module, kerf and backlash, with those numbers engraved on the part.
Cut it, feel the mesh, adjust `kerf` and `backlash`, and only then commit to a
600mm ring. It is the only test that checks the numbers against your actual
laser, your actual material and today's focus — the app cannot know them.

## Layout

```
src/
  geom/       pure TypeScript, no React, no DOM
    involute.ts   involute flanks + trochoidal root fillets, external & internal
    gear.ts       spec -> cuttable Part
    features.ts   hub, bolt circles, cutouts, pen holes, labels
    segment.ts    oversized rings -> arc segments + splice plates
    curves.ts     hypo/epi/rack/cog-on-cog maths, closure and petal counts
    nest.ts       shelf packing onto sheets
    svg.ts        mm-exact SVG writer (the only place that knows SVG is Y-down)
    hershey.ts    single-stroke engraving font
    validate.ts   design rules, advisory rather than blocking
    coupon.ts     the fit-test coupon
  state/      schema (zod), store (zustand), storage, presets, exporters
  ui/         React: panels, canvas views, widgets
tests/        vitest over src/geom and the design document
```

Conventions inside `src/geom`: millimetres, Y-up, origin at the part centre,
angles in radians. `src/geom` never imports React and never touches the DOM.

## Tests

```
npm test          # 87 tests
npm run typecheck
```

The tests measure the *generated polyline* rather than re-deriving from the
same formulas the code under test uses. Highlights:

- a meshed pair is swept through a full tooth engagement and checked for
  collision, for four internal pairings and two external ones, with a
  mismatched-module pair as a negative control;
- tooth thickness is measured off the profile at several radii and compared to
  the textbook involute formula;
- the curve is checked to close exactly after the predicted number of turns,
  and not before;
- the Tusi couple (pen on the pitch circle, `R = 2r`) must come out as a dead
  straight line, which pins the rolling relation;
- a 100mm circle must measure 100 user units in the exported SVG.

Dimensional assertions are stated against the flattening tolerance rather than
a fixed number of decimal places. Chords always fall inside the true curve, so
a measurement off the polyline understates arc length by almost exactly the
sagitta; asserting to 4dp would be testing the flattening budget, not the
geometry.

## Known limits

- Nesting is bounding-box shelf packing, not true outline nesting. Fine for
  round parts on a big bed; swap `nest.ts` for a no-fit-polygon implementation
  behind the same interface if sheet utilisation ever matters more.
- Splice plates assume a single-layer ring. A double-layer ring with staggered
  joints would be stronger and is a natural extension of `segment.ts`.
- Internal ring roots meet the flanks without a fillet. The kerf rounds them to
  ~0.09mm anyway and the loads are low, but a shaper-generated trochoid would
  be more correct.
- Profile shift applies to external cogs only; rings stay standard.
