/** Which parts run against which, and which pen holes to trace. */

import { ROLL_MODES, type RollMode } from '../../geom/curves';
import type { Part } from '../../geom/types';
import { PEN_COLORS, useDesign } from '../../state/design';
import { Button, SelectField, Section } from '../widgets';

export function SetupPanel({ parts }: { parts: Part[] }) {
  const design = useDesign((s) => s.design);
  const activeSetupId = useDesign((s) => s.activeSetupId);
  const selectSetup = useDesign((s) => s.selectSetup);
  const addSetup = useDesign((s) => s.addSetup);
  const removeSetup = useDesign((s) => s.removeSetup);
  const updateSetup = useDesign((s) => s.updateSetup);

  const setup = design.setups.find((s) => s.id === activeSetupId);

  const cogs = design.parts.filter((p) => p.kind === 'cog');
  const fixedChoices = design.parts.filter((p) =>
    setup?.mode === 'rack' ? p.kind === 'rack' : setup?.mode === 'cog-on-cog' ? p.kind === 'cog' : p.kind === 'ring',
  );

  const rollingPart = parts.find((p) => p.id === setup?.rollingPartId);
  const holes = rollingPart?.meta.penHoles ?? [];

  const toggleHole = (index: number) => {
    if (!setup) return;
    const has = setup.penHoleIndices.includes(index);
    const next = has
      ? setup.penHoleIndices.filter((i) => i !== index)
      : [...setup.penHoleIndices, index].sort((a, b) => a - b);
    // Always leave at least one pen selected, otherwise there is nothing to draw.
    updateSetup(setup.id, { penHoleIndices: next.length ? next : [index] });
  };

  return (
    <Section
      title="Setup"
      right={
        <span className="row-actions">
          <Button variant="ghost" onClick={addSetup}>
            + New
          </Button>
        </span>
      }
    >
      {design.setups.length > 1 ? (
        <div className="chips">
          {design.setups.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`chip${s.id === activeSetupId ? ' on' : ''}`}
              onClick={() => selectSetup(s.id)}
            >
              {s.name}
            </button>
          ))}
        </div>
      ) : null}

      {!setup ? (
        <p className="note">No setup yet — add one to run the simulator.</p>
      ) : (
        <>
          <label className="field">
            <span className="field-label">Name</span>
            <input
              type="text"
              value={setup.name}
              onChange={(e) => updateSetup(setup.id, { name: e.target.value })}
            />
          </label>

          <SelectField
            label="Rolling mode"
            value={setup.mode as RollMode}
            onChange={(mode) => {
              // The fixed member must be the right kind for the new mode, so
              // re-pick it rather than leaving an impossible pairing.
              const wanted = mode === 'rack' ? 'rack' : mode === 'cog-on-cog' ? 'cog' : 'ring';
              const current = design.parts.find((p) => p.id === setup.fixedPartId);
              const fixedPartId =
                current?.kind === wanted
                  ? setup.fixedPartId
                  : (design.parts.find((p) => p.kind === wanted)?.id ?? null);
              updateSetup(setup.id, { mode, fixedPartId });
            }}
            options={ROLL_MODES.map((m) => ({ value: m.id, label: m.label }))}
          />
          <p className="note">{ROLL_MODES.find((m) => m.id === setup.mode)?.hint}</p>

          <SelectField
            label={setup.mode === 'rack' ? 'Rack' : setup.mode === 'cog-on-cog' ? 'Fixed cog' : 'Ring'}
            value={setup.fixedPartId ?? ''}
            onChange={(v) => updateSetup(setup.id, { fixedPartId: v || null })}
            options={[
              { value: '', label: '— none —' },
              ...fixedChoices.map((p) => ({ value: p.id, label: `${p.name} (${p.teeth}T)` })),
            ]}
          />

          <SelectField
            label="Rolling cog"
            value={setup.rollingPartId ?? ''}
            onChange={(v) => updateSetup(setup.id, { rollingPartId: v || null })}
            options={[
              { value: '', label: '— none —' },
              ...cogs.map((p) => ({ value: p.id, label: `${p.name} (${p.teeth}T)` })),
            ]}
          />

          <h4 className="sub">Pen holes</h4>
          {holes.length === 0 ? (
            <p className="note">Select a cog with pen holes to choose one.</p>
          ) : (
            <>
              <div className="hole-chips">
                {holes.map((h) => {
                  const on = setup.penHoleIndices.includes(h.index);
                  const colorIndex = setup.penHoleIndices.indexOf(h.index);
                  return (
                    <button
                      key={h.id}
                      type="button"
                      className={`chip${on ? ' on' : ''}`}
                      style={on ? { borderColor: PEN_COLORS[colorIndex % PEN_COLORS.length], color: PEN_COLORS[colorIndex % PEN_COLORS.length] } : undefined}
                      onClick={() => toggleHole(h.index)}
                      title={`Hole ${h.index} · ${h.r.toFixed(1)}mm from centre`}
                    >
                      {h.index}
                    </button>
                  );
                })}
              </div>
              <p className="note">
                Selected:{' '}
                {setup.penHoleIndices
                  .map((i) => holes.find((h) => h.index === i))
                  .filter(Boolean)
                  .map((h) => `#${h!.index} at ${h!.r.toFixed(1)}mm`)
                  .join(', ') || 'none'}
              </p>
            </>
          )}

          {design.setups.length > 1 ? (
            <div className="row-actions end">
              <Button variant="danger" onClick={() => removeSetup(setup.id)}>
                Delete setup
              </Button>
            </div>
          ) : null}
        </>
      )}
    </Section>
  );
}
