// ─── Layers — the default layout ───
//
// Year on the X axis, genre on the Y axis (one row per top genre,
// "Other" at the bottom). Z is depth scatter for the auto-fly tunnel.
// Items whose year is missing or out of [1900, 2030] are pushed off
// to the left of the timeline as a "no year" cluster.

import * as THREE from 'three';

function makeLabel(makeLabelFn, text, color) {
  return makeLabelFn(text, color);
}

export default {
  name: 'layers',

  placeItem(ctx) {
    const { row, yearCol, yearNorm, bucket, X_SPREAD, Z_SCATTER, Y_GAP, genreY } = ctx;

    let x = (yearNorm - 0.5) * X_SPREAD;
    if (yearCol) {
      const yr = parseInt(row[yearCol]);
      const isValidYear = yr > 1900 && yr <= 2030;
      if (!isValidYear) x = (Math.random() - 0.5) * 10 - X_SPREAD / 2 - 10;
    }

    const yJitter = (Math.random() - 0.5) * Y_GAP * 0.5;
    const y = genreY[bucket] + yJitter;
    const z = (Math.random() - 0.5) * Z_SCATTER;

    return { x, y, z };
  },

  placeLabels(ctx) {
    const {
      allBuckets, colorMap, OTHER, genreY, X_SPREAD, Y_GAP,
      groups, sortedGenres, MAX_GENRES, makeLabel: makeLabelFn,
      yearRange, minYear, maxYear,
    } = ctx;

    const sprites = [];

    // Genre row labels along the left edge, skipping the "Other" bucket
    allBuckets.forEach(bucket => {
      if (bucket === '_other_') return;
      const sprite = makeLabel(makeLabelFn, bucket, colorMap[bucket] || OTHER);
      sprite.position.set(-X_SPREAD / 2 - 14, genreY[bucket], 0);
      sprites.push(sprite);
    });

    // "Other" label only if there actually are other-bucket rows
    const hasOtherGroup = !!groups[Object.keys(groups).find(k => k.startsWith('_other_'))];
    if (hasOtherGroup) {
      const otherLabel = `Other (${sortedGenres.length - MAX_GENRES} genres)`;
      const sprite = makeLabel(makeLabelFn, otherLabel, OTHER);
      sprite.position.set(-X_SPREAD / 2 - 14, genreY['_other_'], 0);
      sprites.push(sprite);
    }

    // Year tick labels along the bottom
    const yearStep = yearRange > 30 ? 10 : 5;
    const firstYear = Math.ceil(minYear / yearStep) * yearStep;
    for (let yr = firstYear; yr <= maxYear; yr += yearStep) {
      const xPos = ((yr - minYear) / yearRange - 0.5) * X_SPREAD;
      const sprite = makeLabel(makeLabelFn, String(yr), '#bbb');
      sprite.position.set(xPos, genreY['_other_'] - Y_GAP, 0);
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
      centroid.y + 10,
      centroid.z + X_SPREAD * 0.5
    );
    return { target, position };
  },
};
