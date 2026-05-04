// ─── Layouts registry ───
//
// Every layout exports a default object implementing this contract:
//
//   placeItem(ctx)    -> { x, y, z }              (required)
//   rotateItem(ctx)?  -> { x, y, z }              (optional; falls back to random rotation)
//   placeLabels(ctx)  -> Sprite[]                 (required)
//   setCamera(ctx)    -> { target, position }     (required)
//   infoLines(ctx)?   -> string[]                 (optional; falls back to default HUD copy)
//
// The dispatcher in src/app.js's build() picks LAYOUTS[layoutMode]
// (defaulting to 'layers') and calls into the chosen object once
// per build. Adding a new layout is one new file plus one entry in
// this map -- no changes to build().

import layers from './layers.js';
import sphere from './sphere.js';
import helix from './helix.js';
import grid from './grid.js';
import schotter from './schotter.js';
import stream from './stream.js';

export const LAYOUTS = {
  layers,
  sphere,
  helix,
  grid,
  schotter,
  stream,
};

export const LAYOUT_NAMES = Object.keys(LAYOUTS);
