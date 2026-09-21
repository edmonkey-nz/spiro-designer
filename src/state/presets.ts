/**
 * Starting points that are known to work, and double as smoke tests.
 */

import { newCogSpec, newRackSpec, newRingSpec, type CogSpec, type RingSpec } from '../geom/gear';
import { defaultGearDefaults } from '../geom/gear';
import { SHAPE_PRESETS } from '../geom/shape';
import { defaultMachine, type Design } from './schema';
import { SCHEMA_VERSION } from './schema';

function cog(id: string, teeth: number, tweak: (c: CogSpec) => void = () => {}): CogSpec {
  const c = newCogSpec(id, teeth);
  tweak(c);
  return c;
}

function ring(id: string, teeth: number, tweak: (r: RingSpec) => void = () => {}): RingSpec {
  const r = newRingSpec(id, teeth);
  tweak(r);
  return r;
}

const base = (name: string): Omit<Design, 'parts' | 'setups'> => ({
  schemaVersion: SCHEMA_VERSION,
  name,
  units: 'mm',
  machine: defaultMachine(),
  defaults: defaultGearDefaults(),
});

export interface Preset {
  id: string;
  name: string;
  description: string;
  build: () => Design;
}

export const presets: Preset[] = [
  {
    id: 'classic',
    name: 'Classic 96 / 32',
    description: 'Three clean petals, closes in a single turn. The one to cut first.',
    build: () => ({
      ...base('Classic 96/32'),
      parts: [
        ring('ring96', 96),
        cog('cog32', 32, (c) => {
          c.penHoles = { ...c.penHoles, layout: 'radial-line', count: 8, dia: 5 };
        }),
      ],
      setups: [
        {
          id: 's1',
          name: 'Inside the 96',
          mode: 'inside-ring',
          fixedPartId: 'ring96',
          rollingPartId: 'cog32',
          penHoleIndices: [8],
        },
      ],
    }),
  },
  {
    id: 'prime',
    name: 'Coprime 157 / 43',
    description: '157 petals over 43 turns — a dense rosette, and big enough to need segmenting.',
    build: () => ({
      ...base('Coprime 157/43'),
      parts: [
        ring('ring157', 157, (r) => {
          r.rimWidth = 22;
          r.mount = { ...r.mount, enabled: true, count: 12 };
        }),
        cog('cog43', 43, (c) => {
          c.penHoles = { ...c.penHoles, layout: 'radial-spokes', count: 12, arms: 3, dia: 5 };
        }),
      ],
      setups: [
        {
          id: 's1',
          name: 'Inside the 157',
          mode: 'inside-ring',
          fixedPartId: 'ring157',
          rollingPartId: 'cog43',
          penHoleIndices: [4, 8, 12],
        },
      ],
    }),
  },
  {
    id: 'rosette',
    name: 'Outside 72 / 29',
    description: 'Cog running round the outside of a ring — epitrochoid flowers.',
    build: () => ({
      ...base('Rosette 72/29'),
      parts: [
        ring('ring72', 72, (r) => {
          r.rimWidth = 26;
          r.outerTeeth = true;
        }),
        cog('cog29', 29, (c) => {
          c.penHoles = { ...c.penHoles, layout: 'radial-line', count: 6, dia: 5 };
        }),
      ],
      setups: [
        {
          id: 's1',
          name: 'Around the outside',
          mode: 'outside-ring',
          fixedPartId: 'ring72',
          rollingPartId: 'cog29',
          penHoleIndices: [6],
        },
      ],
    }),
  },
  {
    id: 'blob',
    name: 'Blob 132 / 31',
    description: 'A non-circular ring. Same closure maths, a far stranger pattern.',
    build: () => ({
      ...base('Blob 132/31'),
      parts: [
        ring('ringBlob', 132, (r) => {
          r.name = 'Blob ring 132T';
          r.rimWidth = 18;
          r.shape = { ...SHAPE_PRESETS.find((p) => p.id === 'blob')!.shape };
          r.mount = { ...r.mount, enabled: true, count: 10 };
        }),
        cog('cog31', 31, (c) => {
          c.penHoles = { ...c.penHoles, layout: 'radial-line', count: 8, dia: 5 };
        }),
      ],
      setups: [
        {
          id: 's1',
          name: 'Inside the blob',
          mode: 'inside-ring',
          fixedPartId: 'ringBlob',
          rollingPartId: 'cog31',
          penHoleIndices: [8],
        },
      ],
    }),
  },
  {
    id: 'rack',
    name: 'Rack and 24T',
    description: 'A cog rolling along a straight rack — repeating trochoid waves.',
    build: () => ({
      ...base('Rack waves'),
      parts: [
        newRackSpec('rack60', 60),
        cog('cog24', 24, (c) => {
          c.penHoles = { ...c.penHoles, layout: 'radial-line', count: 6, dia: 5 };
        }),
      ],
      setups: [
        {
          id: 's1',
          name: 'Along the rack',
          mode: 'rack',
          fixedPartId: 'rack60',
          rollingPartId: 'cog24',
          penHoleIndices: [6],
        },
      ],
    }),
  },
];

export const defaultDesign = (): Design => presets[0]!.build();
