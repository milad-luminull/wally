import { paletteValues, type Palette } from '@wally/shared';

export const PALETTES = {
  minimal: {
    swatches: ['#f6f6f7', '#ffb224', '#0e0e10'],
  },
  paper: {
    swatches: ['#EEEEEB', '#F5A524', '#111111'],
  },
  morning: {
    swatches: ['#E1EEF8', '#FFD05C', '#0B1A2A'],
  },
  highlighter: {
    swatches: ['#F2F2EC', '#EDFF4A', '#111111'],
  },
  aurora: {
    swatches: ['#E7EDF5', '#FDE68A', '#18172B'],
  },
  daybreak: {
    swatches: ['#FCEADF', '#FF6B3D', '#14110F'],
  },
  sprout: {
    swatches: ['#E5F0D2', '#C6F432', '#0F2A1F'],
  },
  amber: {
    swatches: ['#FFE9B0', '#FFB21A', '#211900'],
  },
  neutral: {
    swatches: ['#EEEEEE', '#D8D8D8', '#0A0A0A'],
  },
} satisfies Record<Palette, { swatches: string[] }>;

export function parsePalette(value: unknown): Palette {
  return (paletteValues as readonly unknown[]).includes(value) ? (value as Palette) : 'paper';
}
