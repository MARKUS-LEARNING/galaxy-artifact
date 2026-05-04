// ─── Schotter — Georg Nees, "Gravel," 1968 ───
//
// One of the foundational works of computer art. Order at the top
// row dissolves into chaos at the bottom: jitter and rotation both
// scale quadratically with row index, so the transition is gradual
// at first then accelerates.
//
// This is the only layout that overrides rotateItem -- ordinary
// random rotation would obliterate the order-to-chaos gradient.

import * as THREE from 'three';

const GRID_SPACING = 3.2;

function gridColumnCount(rowCount, bucketCount) {
  const ideal = Math.ceil(Math.sqrt(rowCount / bucketCount));
  return Math.max(ideal, 6);
}

// Quadratic chaos ramp: 0 at the top genre row, 1 at the bottom row.
function chaosAt(bucketIdx, allBucketsLength) {
  const denom = allBucketsLength - 1 || 1;
  const fromBottom = (allBucketsLength - 1 - bucketIdx) / denom;  // 0 = top, 1 = bottom
  return fromBottom * fromBottom;                                 // quadratic ramp
}

export default {
  name: 'schotter',

  placeItem(ctx) {
    const { yearNorm, bucketIdx, allBucketsLength, rowsLength } = ctx;

    const cols = gridColumnCount(rowsLength, allBucketsLength);
    const colIdx = Math.floor(yearNorm * (cols - 1));
    const chaos = chaosAt(bucketIdx, allBucketsLength);

    const x = (colIdx - cols / 2) * GRID_SPACING
            + (Math.random() - 0.5) * chaos * GRID_SPACING * 1.8;
    const y = (allBucketsLength / 2 - bucketIdx) * GRID_SPACING * 1.6
            + (Math.random() - 0.5) * chaos * GRID_SPACING * 1.5;
    const z = (Math.random() - 0.5) * chaos * 12;

    return { x, y, z };
  },

  rotateItem(ctx) {
    const { bucketIdx, allBucketsLength } = ctx;
    const chaos = chaosAt(bucketIdx, allBucketsLength);

    return {
      x: (Math.random() - 0.5) * chaos * Math.PI,
      y: (Math.random() - 0.5) * chaos * Math.PI * 0.5,
      z: (Math.random() - 0.5) * chaos * Math.PI,
    };
  },

  placeLabels(ctx) {
    const {
      allBuckets, colorMap, OTHER, allBucketsLength, rowsLength,
      makeLabel: makeLabelFn,
    } = ctx;

    const sprites = [];
    const cols = gridColumnCount(rowsLength, allBucketsLength);

    allBuckets.forEach((bucket, i) => {
      if (bucket === '_other_') return;
      const sprite = makeLabelFn(bucket, colorMap[bucket] || OTHER);
      sprite.position.set(
        -cols / 2 * GRID_SPACING - 10,
        (allBucketsLength / 2 - i) * GRID_SPACING * 1.6,
        0
      );
      sprites.push(sprite);
    });

    return sprites;
  },

  setCamera(ctx) {
    const { centroid } = ctx;
    const target = centroid.clone();
    const position = new THREE.Vector3(centroid.x, centroid.y + 20, centroid.z + 55);
    return { target, position };
  },
};
