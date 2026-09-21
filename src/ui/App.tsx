import { useCallback, useEffect, useMemo, useState } from 'react';
import { curveInfo } from '../geom/curves';
import type { Pt } from '../geom/types';
import { validateParts, validateSetup, type Issue } from '../geom/validate';
import { buildAll, curveForSetup, PEN_COLORS, useDesign } from '../state/design';
import { cuttableParts } from '../state/exporters';
import { loadAutosave, scheduleAutosave } from '../state/storage';
import { ExportPanel } from './panels/ExportPanel';
import { IssuePanel } from './panels/IssuePanel';
import { MachinePanel } from './panels/MachinePanel';
import { PartPanel } from './panels/PartPanel';
import { SetupPanel } from './panels/SetupPanel';
import { PartPreview } from './views/PartPreview';
import { SheetPreview } from './views/SheetPreview';
import { SimCanvas, type SimPen } from './views/SimCanvas';
import { Button } from './widgets';

type Tab = 'part' | 'simulate' | 'sheets';

export function App() {
  const design = useDesign((s) => s.design);
  const activePartId = useDesign((s) => s.activePartId);
  const activeSetupId = useDesign((s) => s.activeSetupId);
  const setDesign = useDesign((s) => s.setDesign);
  const status = useDesign((s) => s.status);
  const setStatus = useDesign((s) => s.setStatus);

  const [tab, setTab] = useState<Tab>('simulate');
  const [showGuides, setShowGuides] = useState(true);
  const [highlightHole, setHighlightHole] = useState<number | undefined>();
  const [curves, setCurves] = useState<{ index: number; pts: Pt[] }[]>([]);
  const [restorePrompt, setRestorePrompt] = useState<ReturnType<typeof loadAutosave>>(null);

  // Offer the previous session back rather than silently overwriting whatever
  // the user had open, or silently discarding it.
  useEffect(() => {
    const saved = loadAutosave();
    if (saved) setRestorePrompt(saved);
  }, []);

  useEffect(() => {
    scheduleAutosave(design);
  }, [design]);

  const parts = useMemo(() => buildAll(design), [design]);
  const activePart = parts.find((p) => p.id === activePartId);
  const setup = design.setups.find((s) => s.id === activeSetupId);

  const pens: SimPen[] = useMemo(() => {
    if (!setup) return [];
    return setup.penHoleIndices
      .map((index, i) => {
        const spec = curveForSetup(design, setup, parts, index);
        return spec ? { index, spec, color: PEN_COLORS[i % PEN_COLORS.length]! } : null;
      })
      .filter((p): p is SimPen => p !== null);
  }, [design, setup, parts]);

  const issues: Issue[] = useMemo(() => {
    const bed = { width: design.machine.bedWidth, height: design.machine.bedHeight, margin: design.machine.margin };
    const list = validateParts(design.parts, parts, design.defaults, bed);
    const primary = pens[0]?.spec;
    if (setup && primary) {
      list.push(
        ...validateSetup(
          {
            mode: setup.mode,
            fixedSpec: design.parts.find((p) => p.id === setup.fixedPartId),
            rollingSpec: design.parts.find((p) => p.id === setup.rollingPartId),
            fixedPart: parts.find((p) => p.id === setup.fixedPartId),
          },
          design.defaults,
          primary,
        ),
      );
    }
    return list;
  }, [design, parts, pens, setup]);

  const cuttable = useMemo(() => cuttableParts(design), [design]);

  const fixedPart = parts.find((p) => p.id === setup?.fixedPartId);
  const rollingPart = parts.find((p) => p.id === setup?.rollingPartId);

  const onCurves = useCallback((c: { index: number; pts: Pt[] }[]) => setCurves(c), []);

  const headline = pens[0] ? curveInfo(pens[0].spec) : null;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden>
            ◎
          </span>
          <span>Spiro</span>
        </div>
        <div className="topbar-mid">
          <span className="design-name">{design.name}</span>
          {headline ? (
            <span className="topbar-sub">
              {headline.petals} petals · {headline.closes ? `${headline.carrierRevs} turn${headline.carrierRevs === 1 ? '' : 's'}` : 'open'}
            </span>
          ) : null}
        </div>
        <nav className="tabs">
          {(['part', 'simulate', 'sheets'] as Tab[]).map((t) => (
            <button key={t} type="button" className={`tab${tab === t ? ' on' : ''}`} onClick={() => setTab(t)}>
              {t === 'part' ? 'Part' : t === 'simulate' ? 'Simulate' : 'Sheets'}
            </button>
          ))}
        </nav>
      </header>

      {restorePrompt ? (
        <div className="restore">
          <span>Found an autosaved design “{restorePrompt.name}” from a previous session.</span>
          <Button
            variant="primary"
            onClick={() => {
              setDesign(restorePrompt, 'Restored the autosaved design.');
              setRestorePrompt(null);
            }}
          >
            Restore it
          </Button>
          <Button variant="ghost" onClick={() => setRestorePrompt(null)}>
            Dismiss
          </Button>
        </div>
      ) : null}

      <div className="body">
        <aside className="side left">
          <MachinePanel />
          <PartPanel
            parts={parts}
            onPickHole={(i) => {
              setHighlightHole(i);
              setTab('part');
            }}
          />
        </aside>

        <main className="stage">
          {tab === 'part' ? (
            <PartPreview
              part={activePart}
              highlightHole={highlightHole}
              showGuides={showGuides}
              onToggleGuides={setShowGuides}
            />
          ) : null}
          {tab === 'simulate' ? (
            <SimCanvas pens={pens} fixedPart={fixedPart} rollingPart={rollingPart} onCurves={onCurves} />
          ) : null}
          {tab === 'sheets' ? (
            <SheetPreview parts={cuttable.parts} machine={design.machine} notes={cuttable.notes} />
          ) : null}
        </main>

        <aside className="side right">
          <SetupPanel parts={parts} />
          <IssuePanel issues={issues} />
          <ExportPanel parts={parts} activePart={activePart} curves={curves} />
        </aside>
      </div>

      {status ? (
        <footer className="statusbar">
          <span>{status}</span>
          <button type="button" className="link" onClick={() => setStatus(null)}>
            dismiss
          </button>
        </footer>
      ) : null}
    </div>
  );
}
