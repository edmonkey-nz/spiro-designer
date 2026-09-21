# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```
npm run dev              # vite on http://127.0.0.1:5173
npm test                 # vitest run, ~10s (the shape suite dominates)
npm run test:watch
npm run typecheck        # tsc -b --noEmit
npm run build            # tsc -b && vite build
```

Single test file or single case:

```
npx vitest run tests/shape.test.ts
npx vitest run -t "clears all the way round the oval"
```

`tsconfig.json` has `noUnusedLocals`, so an unused import fails `typecheck` but
not `npm test`. Run both before calling anything done.

## GitLab

This project is hosted on GitLab. Use **merge request**, not pull request, in
commit messages and descriptions. `glab` is not installed on this machine, and
there is no `.gitlab-ci.yml` yet — `npm run typecheck && npm test` is the whole
check suite, so a CI job only needs those two.

Note: `git remote origin` currently still points at a GitHub URL. Leave it
alone unless asked; ask before repointing it.

## Architecture

The app designs laser-cut involute gears for a physical spirograph and exports
1:1 SVG. Three layers, and the boundary between the first two is the important
one:

```
src/geom/    pure geometry. Never imports React, never touches the DOM.
src/state/   zod schema + zustand store + exporters. Bridges geom to UI.
src/ui/      React panels and canvas views.
```

**Conventions inside `src/geom`:** millimetres, Y-up, radians, origin at the
part's centre. `svg.ts` is the only module that converts to SVG's Y-down page
space — do not flip Y anywhere else.

### Things that are easy to get wrong

**Kerf is applied during generation, not as a post-process offset.** The rule
is always *move the drawn line into the waste by kerf/2*, which means the sign
depends on which side the material is:

- external cog: tip radius `+kh`, root radius `+kh` (a *shallower* space)
- internal ring: tip radius `-kh`, root radius `-kh`
- holes: radius `-kh`; outer boundaries: `+kh`

On an involute flank this is exact rather than approximate: offsetting an
involute along its own normal by `d` yields the same involute rotated by
`d/rb`, so the whole compensation is one extra term in the tooth half-angle.
There is no polygon-offset library in the dependency tree and adding one is
almost certainly the wrong move.

**`buildToothPeriod` is the unit of construction**, not `buildGearProfile`.
A period spans exactly one pitch, centred on whichever feature sits at the
*outer* radius — which is the tooth space on an internal ring and the tooth on
an external gear. `shapedRing.ts` re-phases the external case by half a pitch
so both are space-centred; half a pitch is not a symmetry of a gear, so that
cannot be done with a rotation.

**Closure maths is driven by tooth counts, never by measured radii.** Petals
are `Z/gcd(Z,z)` and carrier turns `z/gcd(Z,z)`, and that holds for
non-circular rings too. Anything that derives a pattern from a radius will
drift away from the physical part.

**Non-circular rings (`shape.ts` + `shapedRing.ts`)** scale the *shape* to the
tooth count, not the reverse, because teeth are spaced by arc length and the
loop has to close on a whole tooth. Each tooth is built for the circle
osculating the pitch curve where it sits. Where curvature is negative the local
equivalent flips to an *external* gear; near an inflection it becomes a rack.
With constant curvature the whole construction must collapse back to the plain
circular ring exactly — `tests/shape.test.ts` asserts that, and it is the
fastest way to catch a regression here.

**Two dispatch points** silently do the wrong thing if you add a code path and
forget them:

- `buildRing` → `buildBlobRing` when the shape is not a circle.
- `segmentRing` → `segmentShapedRing` likewise. The circular splitter slices by
  polar angle, which is only valid when teeth sit at equal angles.

**`PartMeta.innerHoleR`** is what lets `nest.ts` pack parts into a ring's empty
interior. It is the radius of a concentric empty circle, so an arc segment or a
splice plate must report 0, not its bounding radius.

### Testing approach

Tests measure the **generated polyline**, not the formulas that produced it.
Two conventions worth keeping:

- Dimensional assertions are stated against the flattening tolerance
  (`chordTol`), not a fixed number of decimal places. Chords fall inside the
  true curve, so a measurement off a polyline understates arc length by about
  the sagitta; asserting to 4dp tests the flattening budget, not the geometry.
- Clearance between meshed parts uses `PolyIndex` (grid-indexed polygon) in
  `tests/mesh.ts`, **not** `radialProfile`. The radial version assumes the
  boundary is single-valued in angle, which is true of a circular gear and
  false of a blobby ring, where it silently compares the wrong pair of teeth
  and reports several millimetres of interference that is not there.
