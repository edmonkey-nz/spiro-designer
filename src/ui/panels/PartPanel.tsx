/** Part list and the editor for whichever part is selected. */

import type { CogSpec, PartSpec, RackSpec, RingSpec } from '../../geom/gear';
import { outerTeethFor, penHoleBand } from '../../geom/gear';
import { SHAPE_PRESETS, circleShape, describeShape, isCircle } from '../../geom/shape';
import type { Part } from '../../geom/types';
import { useDesign } from '../../state/design';
import { Button, NumberField, SelectField, Section, SliderField, Stat, Toggle } from '../widgets';

export function PartPanel({ parts, onPickHole }: { parts: Part[]; onPickHole: (index: number) => void }) {
  const design = useDesign((s) => s.design);
  const activePartId = useDesign((s) => s.activePartId);
  const selectPart = useDesign((s) => s.selectPart);
  const addPart = useDesign((s) => s.addPart);
  const removePart = useDesign((s) => s.removePart);
  const duplicatePart = useDesign((s) => s.duplicatePart);

  const spec = design.parts.find((p) => p.id === activePartId);
  const built = parts.find((p) => p.id === activePartId);

  return (
    <>
      <Section
        title="Parts"
        right={
          <span className="row-actions">
            <Button variant="ghost" onClick={() => addPart('cog')} title="Add a cog">
              + Cog
            </Button>
            <Button variant="ghost" onClick={() => addPart('ring')} title="Add a ring">
              + Ring
            </Button>
            <Button variant="ghost" onClick={() => addPart('rack')} title="Add a rack">
              + Rack
            </Button>
          </span>
        }
      >
        <ul className="part-list">
          {design.parts.map((p) => {
            const b = parts.find((q) => q.id === p.id);
            return (
              <li key={p.id}>
                <button
                  type="button"
                  className={`part-row${p.id === activePartId ? ' active' : ''}`}
                  onClick={() => selectPart(p.id)}
                >
                  <span className={`kind kind-${p.kind}`}>{p.kind}</span>
                  <span className="part-name">{p.name}</span>
                  <span className="part-meta">
                    {p.teeth}T{b ? ` · ø${(b.meta.outerR * 2).toFixed(0)}mm` : ''}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {design.parts.length === 0 ? <p className="note">No parts yet — add a ring and a cog.</p> : null}
      </Section>

      {spec ? (
        <Section title={`Edit · ${spec.name}`} key={spec.id}>
          <CommonFields spec={spec} />
          {spec.kind === 'cog' ? <CogFields spec={spec} built={built} onPickHole={onPickHole} /> : null}
          {spec.kind === 'ring' ? <RingFields spec={spec} built={built} /> : null}
          {spec.kind === 'rack' ? <RackFields spec={spec} /> : null}

          {built ? (
            <div className="stats">
              <Stat label="Pitch ø" value={`${(built.meta.pitchR * 2).toFixed(2)}mm`} />
              <Stat label="Outer ø" value={`${(built.meta.outerR * 2).toFixed(2)}mm`} />
              <Stat label="Cut length" value={`${(built.meta.cutLength / 1000).toFixed(2)}m`} />
            </div>
          ) : null}

          <div className="row-actions end">
            <Button onClick={() => duplicatePart(spec.id)}>Duplicate</Button>
            <Button variant="danger" onClick={() => removePart(spec.id)}>
              Delete
            </Button>
          </div>
        </Section>
      ) : null}
    </>
  );
}

function useUpdate(id: string) {
  const updatePart = useDesign((s) => s.updatePart);
  return (patch: Partial<PartSpec>) => updatePart(id, patch);
}

function CommonFields({ spec }: { spec: PartSpec }) {
  const design = useDesign((s) => s.design);
  const update = useUpdate(spec.id);
  return (
    <>
      <label className="field">
        <span className="field-label">Name</span>
        <input type="text" value={spec.name} onChange={(e) => update({ name: e.target.value })} />
      </label>
      <div className="grid-2">
        <NumberField
          label="Teeth"
          value={spec.teeth}
          onChange={(v) => update({ teeth: v })}
          min={spec.kind === 'rack' ? 2 : 3}
          max={2000}
          integer
        />
        <NumberField
          label="Module override"
          value={spec.module ?? design.defaults.module}
          onChange={(v) => update({ module: Math.abs(v - design.defaults.module) < 1e-9 ? undefined : v })}
          min={0.5}
          max={40}
          step={0.5}
          unit="mm"
          hint="Leave equal to the design module unless this part belongs to a different gear train — parts of different modules will not mesh."
        />
      </div>
      <Toggle label="Engrave label" value={spec.label} onChange={(v) => update({ label: v })} />
    </>
  );
}

function HubFields({ spec }: { spec: CogSpec | RingSpec }) {
  const update = useUpdate(spec.id);
  const hub = spec.hub;
  const set = (patch: Partial<CogSpec['hub']>) => update({ hub: { ...hub, ...patch } } as Partial<PartSpec>);
  return (
    <div className="grid-2">
      <NumberField label="Centre bore" value={hub.boreDia} onChange={(v) => set({ boreDia: v })} min={0} max={200} unit="mm" />
      <NumberField
        label="Hub boss"
        value={hub.bossDia}
        onChange={(v) => set({ bossDia: v })}
        min={0}
        max={400}
        unit="mm"
        hint="Solid area kept around the bore. Pen holes are never placed inside it, and the part label goes here."
      />
      <NumberField label="Hub bolts" value={hub.boltCount} onChange={(v) => set({ boltCount: v })} min={0} max={24} integer />
      <NumberField
        label="Hub bolt circle"
        value={hub.boltCircleDia}
        onChange={(v) => set({ boltCircleDia: v })}
        min={0}
        max={600}
        unit="mm"
      />
    </div>
  );
}

function CogFields({
  spec,
  built,
  onPickHole,
}: {
  spec: CogSpec;
  built?: Part;
  onPickHole: (index: number) => void;
}) {
  const update = useUpdate(spec.id);
  const pen = spec.penHoles;
  const setPen = (patch: Partial<CogSpec['penHoles']>) =>
    update({ penHoles: { ...pen, ...patch } } as Partial<PartSpec>);
  const band = built ? penHoleBand(spec, built.meta.rootR) : null;

  return (
    <>
      <h4 className="sub">Hub</h4>
      <HubFields spec={spec} />
      <Toggle
        label="Centre crosshair"
        value={spec.hub.crosshair}
        onChange={(v) => update({ hub: { ...spec.hub, crosshair: v } } as Partial<PartSpec>)}
      />

      <h4 className="sub">Pen holes</h4>
      <SelectField
        label="Layout"
        value={pen.layout}
        onChange={(v) => setPen({ layout: v })}
        options={[
          { value: 'radial-line', label: 'One radial line' },
          { value: 'radial-spokes', label: 'Radial spokes' },
          { value: 'spiral', label: 'Spiral' },
          { value: 'ring', label: 'Ring at one radius' },
        ]}
      />
      <div className="grid-2">
        <NumberField label="Count" value={pen.count} onChange={(v) => setPen({ count: v })} min={1} max={200} integer />
        {pen.layout === 'radial-spokes' ? (
          <NumberField label="Arms" value={pen.arms} onChange={(v) => setPen({ arms: v })} min={1} max={24} integer />
        ) : (
          <span />
        )}
        <NumberField
          label="Hole ø"
          value={pen.dia}
          onChange={(v) => setPen({ dia: v })}
          min={0.5}
          max={40}
          step={0.5}
          unit="mm"
          hint="The finished hole size. Make it a close fit on your pen barrel — slop here shows up directly in the drawing."
        />
        <span />
        <NumberField
          label="Inner radius"
          value={pen.minR}
          onChange={(v) => setPen({ minR: v })}
          min={0}
          max={2000}
          unit="mm"
          hint="0 means start at the innermost usable radius."
        />
        <NumberField
          label="Outer radius"
          value={pen.maxR}
          onChange={(v) => setPen({ maxR: v })}
          min={0}
          max={2000}
          unit="mm"
          hint="0 means run out to the last usable radius."
        />
      </div>
      {band ? (
        <p className="note">
          Usable band {band.min.toFixed(1)}–{band.max.toFixed(1)}mm from centre.
        </p>
      ) : null}
      <Toggle label="Engrave hole numbers" value={pen.annotate} onChange={(v) => setPen({ annotate: v })} />
      {pen.annotate ? (
        <Toggle
          label="Engrave hole radii"
          value={pen.annotateRadius}
          onChange={(v) => setPen({ annotateRadius: v })}
        />
      ) : null}

      {built && built.meta.penHoles.length > 0 ? (
        <div className="hole-chips">
          {built.meta.penHoles.map((h) => (
            <button key={h.id} type="button" className="chip" onClick={() => onPickHole(h.index)} title={`${h.r.toFixed(1)}mm from centre`}>
              {h.index}
            </button>
          ))}
        </div>
      ) : null}

      <h4 className="sub">Lightening and fixings</h4>
      <Toggle
        label="Lightening cutouts"
        value={spec.cutouts.enabled}
        onChange={(v) => update({ cutouts: { ...spec.cutouts, enabled: v } } as Partial<PartSpec>)}
      />
      {spec.cutouts.enabled ? <CutoutFields spec={spec} /> : null}
      <Toggle
        label="Finger holes for driving by hand"
        value={spec.mount.enabled}
        onChange={(v) => update({ mount: { ...spec.mount, enabled: v } } as Partial<PartSpec>)}
      />
      {spec.mount.enabled ? (
        <div className="grid-2">
          <NumberField
            label="Count"
            value={spec.mount.count}
            onChange={(v) => update({ mount: { ...spec.mount, count: v } } as Partial<PartSpec>)}
            min={0}
            max={32}
            integer
          />
          <NumberField
            label="Hole ø"
            value={spec.mount.holeDia}
            onChange={(v) => update({ mount: { ...spec.mount, holeDia: v } } as Partial<PartSpec>)}
            min={1}
            max={40}
            unit="mm"
          />
        </div>
      ) : null}
    </>
  );
}

function CutoutFields({ spec }: { spec: CogSpec | RingSpec }) {
  const update = useUpdate(spec.id);
  const c = spec.cutouts;
  const set = (patch: Partial<CogSpec['cutouts']>) =>
    update({ cutouts: { ...c, ...patch } } as Partial<PartSpec>);
  return (
    <div className="grid-2">
      <NumberField label="Count" value={c.count} onChange={(v) => set({ count: v })} min={1} max={32} integer />
      <NumberField label="Web width" value={c.webWidth} onChange={(v) => set({ webWidth: v })} min={2} max={100} unit="mm" />
      <NumberField label="Edge margin" value={c.edgeMargin} onChange={(v) => set({ edgeMargin: v })} min={2} max={100} unit="mm" />
      <NumberField label="Corner radius" value={c.cornerRadius} onChange={(v) => set({ cornerRadius: v })} min={0} max={40} unit="mm" />
    </div>
  );
}

function ShapeFields({ spec, built }: { spec: RingSpec; built?: Part }) {
  const update = useUpdate(spec.id);
  const shape = spec.shape;
  const set = (patch: Partial<RingSpec['shape']>) =>
    update({ shape: { ...shape, ...patch } } as Partial<PartSpec>);
  const shaped = built?.meta.shaped;
  const module = built?.meta.module ?? 3;

  return (
    <>
      <h4 className="sub">Shape</h4>
      <div className="chips">
        {SHAPE_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`chip${JSON.stringify(p.shape) === JSON.stringify(shape) ? ' on' : ''}`}
            title={p.hint}
            onClick={() => update({ shape: { ...p.shape } } as Partial<PartSpec>)}
          >
            {p.name}
          </button>
        ))}
      </div>

      <SliderField
        label="Lobes"
        value={shape.lobes}
        onChange={(v) => set({ lobes: v })}
        min={0}
        max={8}
        step={1}
        hint="How many bulges go round the ring. 0 is a circle, 1 an egg, 2 an oval."
        format={(v) => (v === 0 ? 'circle' : String(v))}
      />
      {shape.lobes > 0 ? (
        <SliderField
          label="Depth"
          value={shape.amplitude}
          onChange={(v) => set({ amplitude: v })}
          min={0}
          max={0.35}
          step={0.005}
          hint="How far the bulges swing, as a fraction of the mean radius. Deeper means tighter corners, which limits how big the cog can be."
          format={(v) => `${(v * 100).toFixed(1)}%`}
        />
      ) : null}

      <SliderField
        label="Second lobes"
        value={shape.lobes2}
        onChange={(v) => set({ lobes2: v })}
        min={0}
        max={8}
        step={1}
        hint="A second harmonic on top of the first. Two harmonics out of phase is what makes a shape look organic rather than regular."
        format={(v) => (v === 0 ? 'none' : String(v))}
      />
      {shape.lobes2 > 0 ? (
        <>
          <SliderField
            label="Second depth"
            value={shape.amplitude2}
            onChange={(v) => set({ amplitude2: v })}
            min={0}
            max={0.25}
            step={0.005}
            format={(v) => `${(v * 100).toFixed(1)}%`}
          />
          <SliderField
            label="Second phase"
            value={shape.phase2}
            onChange={(v) => set({ phase2: v })}
            min={0}
            max={360}
            step={5}
            unit="°"
          />
        </>
      ) : null}

      {!isCircle(shape) ? (
        <>
          <div className="stats">
            <Stat label="Shape" value={describeShape(shape)} />
            {shaped ? (
              <Stat
                label="Tightest bend"
                value={`${shaped.minConvexRho.toFixed(0)}mm`}
                title="The cog's pitch radius must be smaller than this to reach into the corners"
              />
            ) : null}
            {shaped ? (
              <Stat
                label="Largest cog"
                value={`${Math.max(0, Math.floor((2 * shaped.minConvexRho) / module) - 10)}T`}
                title="Comfortable limit, leaving clearance for the tips coming into mesh"
              />
            ) : null}
          </div>
          <p className="note">
            The shape is scaled so its perimeter is exactly {spec.teeth} tooth pitches — teeth are spaced
            along the curve, so the loop has to close on a whole tooth. Change the tooth count to change
            the size.
          </p>
          <Button variant="ghost" onClick={() => update({ shape: circleShape() } as Partial<PartSpec>)}>
            Back to a circle
          </Button>
        </>
      ) : null}
    </>
  );
}

function RingFields({ spec, built }: { spec: RingSpec; built?: Part }) {
  const design = useDesign((s) => s.design);
  const update = useUpdate(spec.id);
  return (
    <>
      <ShapeFields spec={spec} built={built} />

      <h4 className="sub">Rim</h4>
      <NumberField
        label="Rim width"
        value={spec.rimWidth}
        onChange={(v) => update({ rimWidth: v })}
        min={2}
        max={300}
        unit="mm"
        hint="Material outside the tooth roots. Allow 18mm or more if the ring will be split into segments, so the splice plates can take a bolt."
      />
      {isCircle(spec.shape) ? (
        <Toggle
          label="Cut teeth on the outside too"
          value={spec.outerTeeth}
          onChange={(v) => update({ outerTeeth: v })}
          hint="Needed for running a cog around the outside of the ring."
        />
      ) : (
        <p className="note">
          Outer teeth are only available on a circular ring: the outside of a blob is a different curve,
          whose perimeter is not a whole number of tooth pitches.
        </p>
      )}
      {spec.outerTeeth && isCircle(spec.shape) ? (
        <>
          <NumberField
            label="Outer teeth"
            value={spec.outerTeethCount || outerTeethFor(spec, design.defaults)}
            onChange={(v) => update({ outerTeethCount: v })}
            min={0}
            max={4000}
            integer
            hint="0 derives the count from the rim width."
          />
          <Button variant="ghost" onClick={() => update({ outerTeethCount: 0 })}>
            Derive from rim width
          </Button>
        </>
      ) : null}

      <h4 className="sub">Fixings</h4>
      <Toggle
        label="Mounting holes"
        value={spec.mount.enabled}
        onChange={(v) => update({ mount: { ...spec.mount, enabled: v } } as Partial<PartSpec>)}
      />
      {spec.mount.enabled ? (
        <div className="grid-2">
          <NumberField
            label="Count"
            value={spec.mount.count}
            onChange={(v) => update({ mount: { ...spec.mount, count: v } } as Partial<PartSpec>)}
            min={0}
            max={64}
            integer
          />
          <NumberField
            label="Hole ø"
            value={spec.mount.holeDia}
            onChange={(v) => update({ mount: { ...spec.mount, holeDia: v } } as Partial<PartSpec>)}
            min={1}
            max={40}
            unit="mm"
          />
          <NumberField
            label="Bolt circle ø"
            value={spec.mount.circleDia}
            onChange={(v) => update({ mount: { ...spec.mount, circleDia: v } } as Partial<PartSpec>)}
            min={0}
            max={4000}
            unit="mm"
            hint="0 places them in the middle of the rim."
          />
        </div>
      ) : null}
      <Toggle
        label="Lightening cutouts"
        value={spec.cutouts.enabled}
        onChange={(v) => update({ cutouts: { ...spec.cutouts, enabled: v } } as Partial<PartSpec>)}
      />
      {spec.cutouts.enabled ? <CutoutFields spec={spec} /> : null}
    </>
  );
}

function RackFields({ spec }: { spec: RackSpec }) {
  const update = useUpdate(spec.id);
  return (
    <>
      <NumberField
        label="Body height"
        value={spec.bodyHeight}
        onChange={(v) => update({ bodyHeight: v })}
        min={2}
        max={300}
        unit="mm"
        hint="Material below the tooth roots, where the fixing holes go."
      />
      <Toggle
        label="Fixing holes"
        value={spec.mount.enabled}
        onChange={(v) => update({ mount: { ...spec.mount, enabled: v } } as Partial<PartSpec>)}
      />
      {spec.mount.enabled ? (
        <div className="grid-2">
          <NumberField
            label="Count"
            value={spec.mount.count}
            onChange={(v) => update({ mount: { ...spec.mount, count: v } } as Partial<PartSpec>)}
            min={0}
            max={64}
            integer
          />
          <NumberField
            label="Hole ø"
            value={spec.mount.holeDia}
            onChange={(v) => update({ mount: { ...spec.mount, holeDia: v } } as Partial<PartSpec>)}
            min={1}
            max={40}
            unit="mm"
          />
        </div>
      ) : null}
    </>
  );
}
