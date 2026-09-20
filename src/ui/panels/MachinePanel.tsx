/** Machine and tooth-form settings: the numbers that apply to every part. */

import { minTeethWithoutUndercut } from '../../geom/involute';
import { useDesign } from '../../state/design';
import { NumberField, Section, SliderField, Stat } from '../widgets';

export function MachinePanel() {
  const design = useDesign((s) => s.design);
  const updateMachine = useDesign((s) => s.updateMachine);
  const updateDefaults = useDesign((s) => s.updateDefaults);
  const m = design.machine;
  const d = design.defaults;

  const zMin = minTeethWithoutUndercut(d);
  const maxRingTeeth = Math.floor(
    (Math.min(m.bedWidth, m.bedHeight) - 2 * m.margin - 2 * (1 + d.clearance) * d.module - 30) / d.module,
  );

  return (
    <>
      <Section title="Machine">
        <div className="grid-2">
          <NumberField label="Bed width" value={m.bedWidth} onChange={(v) => updateMachine({ bedWidth: v })} min={50} max={5000} unit="mm" />
          <NumberField label="Bed height" value={m.bedHeight} onChange={(v) => updateMachine({ bedHeight: v })} min={50} max={5000} unit="mm" />
          <NumberField
            label="Kerf"
            value={m.kerf}
            onChange={(v) => updateMachine({ kerf: v })}
            min={0}
            max={2}
            step={0.01}
            unit="mm"
            hint="Width the beam removes. Paths are drawn offset by half this, so the cut part comes out nominal. Measure it with the fit coupon."
          />
          <NumberField
            label="Material"
            value={m.materialThickness}
            onChange={(v) => updateMachine({ materialThickness: v })}
            min={0.5}
            max={50}
            step={0.5}
            unit="mm"
          />
          <NumberField label="Sheet margin" value={m.margin} onChange={(v) => updateMachine({ margin: v })} min={0} max={200} unit="mm" />
          <NumberField label="Part spacing" value={m.partGap} onChange={(v) => updateMachine({ partGap: v })} min={0} max={200} unit="mm" />
        </div>
        <div className="grid-2">
          <label className="field">
            <span className="field-label">Cut colour</span>
            <input type="color" value={m.cutColor} onChange={(e) => updateMachine({ cutColor: e.target.value })} />
          </label>
          <label className="field">
            <span className="field-label">Engrave colour</span>
            <input
              type="color"
              value={m.engraveColor}
              onChange={(e) => updateMachine({ engraveColor: e.target.value })}
            />
          </label>
        </div>
        <p className="note">
          Layer colours only need to match whatever your laser software maps to cut and engrave.
        </p>
      </Section>

      <Section title="Tooth form">
        <div className="grid-2">
          <NumberField
            label="Module"
            value={d.module}
            onChange={(v) => updateDefaults({ module: v })}
            min={0.5}
            max={40}
            step={0.5}
            unit="mm"
            hint="Millimetres of pitch diameter per tooth. Bigger module means chunkier, stronger teeth. 3–5 suits laser-cut ply."
          />
          <NumberField
            label="Pressure angle"
            value={d.pressureAngleDeg}
            onChange={(v) => updateDefaults({ pressureAngleDeg: v })}
            min={10}
            max={35}
            step={0.5}
            unit="°"
            hint="20° is the standard. Higher angles give stronger teeth and allow lower tooth counts without undercut."
          />
          <NumberField
            label="Backlash"
            value={d.backlash}
            onChange={(v) => updateDefaults({ backlash: v })}
            min={0}
            max={3}
            step={0.05}
            unit="mm"
            hint="Deliberate slack at the pitch circle, split evenly between the two parts. Increase if the coupon binds."
          />
          <NumberField
            label="Clearance"
            value={d.clearance}
            onChange={(v) => updateDefaults({ clearance: v })}
            min={0}
            max={0.6}
            step={0.05}
            hint="Extra root depth as a fraction of module, so tips never bottom out. 0.25 is standard."
          />
          <NumberField
            label="Addendum"
            value={d.addendum}
            onChange={(v) => updateDefaults({ addendum: v })}
            min={0.5}
            max={1.5}
            step={0.05}
            hint="Tooth height above the pitch circle, as a fraction of module. 1.0 is standard full depth."
          />
          <NumberField
            label="Profile shift"
            value={d.profileShift}
            onChange={(v) => updateDefaults({ profileShift: v })}
            min={-0.8}
            max={0.8}
            step={0.05}
            hint="Shifts the cutter outward, which fixes undercut on low tooth counts. External cogs only."
          />
        </div>
        <SliderField
          label="Root fillet"
          value={d.filletCoeff}
          onChange={(v) => updateDefaults({ filletCoeff: v })}
          min={0}
          max={0.5}
          step={0.01}
          hint="Rounding at the tooth root, as a fraction of module. 0.38 is the standard maximum and the strongest."
          format={(v) => `${v.toFixed(2)} × m`}
        />
        <SliderField
          label="Curve tolerance"
          value={d.chordTol}
          onChange={(v) => updateDefaults({ chordTol: v })}
          min={0.005}
          max={0.2}
          step={0.005}
          unit="mm"
          hint="How closely straight segments follow the true curve. Finer means bigger files; 0.05mm is already well below the kerf."
          format={(v) => v.toFixed(3)}
        />
        <div className="stats">
          <Stat label="No undercut above" value={`${zMin}T`} title="Fewest teeth that avoid undercut at this pressure angle and profile shift" />
          <Stat label="Circular pitch" value={`${(Math.PI * d.module).toFixed(2)}mm`} />
          <Stat
            label="Largest single-piece ring"
            value={`${Math.max(0, maxRingTeeth)}T`}
            title="Approximate largest ring that still fits the bed in one piece at this module"
          />
        </div>
      </Section>
    </>
  );
}
