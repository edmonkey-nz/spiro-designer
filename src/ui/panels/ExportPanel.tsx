/** Everything that leaves the app as a file. */

import { useState } from 'react';
import type { Part, Pt } from '../../geom/types';
import {
  downloadFitCoupon,
  downloadPartSvg,
  downloadPatternPng,
  downloadPatternSvg,
  downloadSheets,
} from '../../state/exporters';
import { useDesign } from '../../state/design';
import { openDesignFile, saveDesignFile } from '../../state/storage';
import { presets } from '../../state/presets';
import { Button, NumberField, Section } from '../widgets';

export function ExportPanel({
  parts,
  activePart,
  curves,
}: {
  parts: Part[];
  activePart?: Part;
  curves: { index: number; pts: Pt[] }[];
}) {
  const design = useDesign((s) => s.design);
  const setDesign = useDesign((s) => s.setDesign);
  const patchDesign = useDesign((s) => s.patchDesign);
  const setStatus = useDesign((s) => s.setStatus);
  const [dpi, setDpi] = useState(300);

  const onSheets = () => {
    const { count, notes, rejected } = downloadSheets(design);
    const bits = [`Exported ${count} sheet${count === 1 ? '' : 's'}.`];
    if (rejected.length) bits.push(`${rejected.length} part(s) too big for the bed and left out.`);
    setStatus([...bits, ...notes].join(' '));
  };

  const onLoad = async () => {
    const res = await openDesignFile();
    if (res.design) setDesign(res.design, `Loaded ${res.name ?? 'design'}.`);
    else if (res.error) setStatus(`Could not load: ${res.error}`);
  };

  const primaryCurve = curves[0];

  return (
    <>
      <Section title="Design file">
        <label className="field">
          <span className="field-label">Design name</span>
          <input type="text" value={design.name} onChange={(e) => patchDesign({ name: e.target.value })} />
        </label>
        <div className="row-actions">
          <Button variant="primary" onClick={() => saveDesignFile(design)}>
            Save JSON
          </Button>
          <Button onClick={onLoad}>Load JSON</Button>
        </div>
        <h4 className="sub">Start from a preset</h4>
        <div className="chips">
          {presets.map((p) => (
            <button
              key={p.id}
              type="button"
              className="chip"
              title={p.description}
              onClick={() => setDesign(p.build(), `Loaded preset “${p.name}”.`)}
            >
              {p.name}
            </button>
          ))}
        </div>
        <p className="note">Loading a preset replaces the current design. Save first if you want to keep it.</p>
      </Section>

      <Section title="Cut files">
        <div className="row-actions">
          <Button variant="primary" onClick={onSheets} disabled={parts.length === 0}>
            Export nested sheets
          </Button>
          <Button onClick={() => activePart && downloadPartSvg(activePart, design.machine)} disabled={!activePart}>
            Export this part
          </Button>
        </div>
        <p className="note">
          SVG at 1:1 in millimetres, with cut and engrave on separate layers. Rings too big for the bed are split
          into segments with splice plates automatically.
        </p>

        <h4 className="sub">Before the big cut</h4>
        <Button onClick={() => { downloadFitCoupon(design); setStatus('Fit coupon exported — cut it and check the mesh before committing to a full ring.'); }}>
          Export fit-test coupon
        </Button>
        <p className="note">
          A 20T cog and a matching ring arc at the current module, kerf and backlash. Cut this first: it is the only
          test that checks those numbers against your actual laser and material.
        </p>
      </Section>

      <Section title="Pattern">
        <div className="row-actions">
          <Button
            onClick={() => primaryCurve && downloadPatternSvg(primaryCurve.pts, design, `pen${primaryCurve.index}`)}
            disabled={!primaryCurve}
          >
            Pattern SVG
          </Button>
          <Button
            onClick={async () => {
              if (!primaryCurve) return;
              const ok = await downloadPatternPng(primaryCurve.pts, design, `pen${primaryCurve.index}`, dpi);
              setStatus(ok ? `Pattern PNG exported at ${dpi} dpi.` : 'Could not render the PNG.');
            }}
            disabled={!primaryCurve}
          >
            Pattern PNG
          </Button>
        </div>
        <NumberField label="PNG resolution" value={dpi} onChange={setDpi} min={72} max={1200} step={1} unit="dpi" integer />
        <p className="note">The pattern exports at true scale, matching what the machine draws.</p>
      </Section>
    </>
  );
}
