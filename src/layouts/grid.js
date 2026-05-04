// ─── Grid — clean orthogonal layout ───
//
// One row per genre bucket, columns indexed by year. The grid is
// roughly square: cols = sqrt(rows / bucketCount), with a floor of 4
// so very small libraries still spread enough to be readable.

import * as THREE from 'three';

const GRID_SPACING = 3.5;

function gridColumnCount(rowCount, bucketCount) {
  const ideal = Math.ceil(Math.sqrt(rowCount / bucketCount));
  return Math.max(ideal, 4);
}

export default {
  name: 'grid',

  placeItem(ctx) {
    const { yearNorm, bucket, bucketIdx, allBucketsLength, rowsLength } = ctx;

    const cols = gridColumnCount(rowsLength, allBucketsLength);
    const colIdx = Math.floor(yearNorm * (cols - 1));

    const x = (colIdx - cols / 2) * GRID_SPACING + (Math.random() - 0.5) * 0.6;
    const y = (allBucketsLength / 2 - bucketIdx) * GRID_SPACING * 1.8;
    const z = (Math.random() - 0.5) * 2;

    return { x, y, z };
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
        (allBucketsLength / 2 - i) * GRID_SPACING * 1.8,
        0
      );
      sprites.push(sprite);
    });

    return sprites;
  },

  setCamera(ctx) {
    const { centroid } = ctx;
    const target = centroid.clone();
    const position = new THREE.Vector3(centroid.x, centroid.y + 30, centroid.z + 60);
    return { target, position };
  },
};
