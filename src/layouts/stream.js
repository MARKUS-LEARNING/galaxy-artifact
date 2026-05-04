// ─── Stream — flowing river layout ───
//
// Each genre is a meandering stream; year is the flow direction.
// Two superimposed sine waves (one for vertical meander, one for
// depth) give each stream a different rhythm so they weave past
// each other rather than collapsing into parallel lines.

import * as THREE from 'three';

export default {
  name: 'stream',

  placeItem(ctx) {
    const { yearNorm, bucketIdx, bucketFrac, allBucketsLength, X_SPREAD } = ctx;

    const streamX = (yearNorm - 0.5) * X_SPREAD;
    const streamPhase = bucketFrac * Math.PI * 2;
    const meander = Math.sin(yearNorm * Math.PI * 3 + streamPhase) * 12;
    const streamY = (allBucketsLength / 2 - bucketIdx) * 5 + meander;
    const depth = Math.sin(yearNorm * Math.PI * 5 + streamPhase * 0.7) * 8;

    const x = streamX + (Math.random() - 0.5) * 3;
    const y = streamY + (Math.random() - 0.5) * 2;
    const z = depth + (Math.random() - 0.5) * 4;

    return { x, y, z };
  },

  placeLabels(ctx) {
    const {
      allBuckets, colorMap, OTHER, allBucketsLength, X_SPREAD,
      makeLabel: makeLabelFn, yearRange, minYear, maxYear,
    } = ctx;

    const sprites = [];

    // One label at the upstream end of each genre's meander
    allBuckets.forEach((bucket, i) => {
      if (bucket === '_other_') return;
      const denom = allBucketsLength - 1 || 1;
      const streamPhase = (i / denom) * Math.PI * 2;
      const meander = Math.sin(streamPhase) * 12;
      const sprite = makeLabelFn(bucket, colorMap[bucket] || OTHER);
      sprite.position.set(-X_SPREAD / 2 - 14, (allBucketsLength / 2 - i) * 5 + meander, 0);
      sprites.push(sprite);
    });

    // Year tick labels under the streams
    const yearStep = yearRange > 30 ? 10 : 5;
    const firstYear = Math.ceil(minYear / yearStep) * yearStep;
    for (let yr = firstYear; yr <= maxYear; yr += yearStep) {
      const xPos = ((yr - minYear) / yearRange - 0.5) * X_SPREAD;
      const sprite = makeLabelFn(String(yr), '#bbb');
      sprite.position.set(xPos, -allBucketsLength * 2.5 - 8, 0);
      sprite.scale.set(8, 1.5, 1);
      sprites.push(sprite);
    }

    return sprites;
  },

  setCamera(ctx) {
    const { centroid, X_SPREAD } = ctx;
    const target = centroid.clone();
    const position = new THREE.Vector3(
      centroid.x,
      centroid.y + 20,
      centroid.z + X_SPREAD * 0.4
    );
    return { target, position };
  },
};
