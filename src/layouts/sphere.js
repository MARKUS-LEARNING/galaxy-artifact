// ─── Sphere — globe with year-as-longitude, genre-as-latitude ───
//
// Each genre bucket gets a latitude band; year wraps around the
// equator as longitude. The result is a navigable globe of music.
// The HUD label semantics also change here (longitude/latitude
// rather than left-right timeline arrows), so this is the only
// layout that overrides infoLines.

import * as THREE from 'three';

export default {
  name: 'sphere',

  placeItem(ctx) {
    const { yearNorm, bucket, allBucketsLength, genreLat, SPHERE_RADIUS } = ctx;

    const latSpread = (160 / (allBucketsLength || 1)) * (Math.PI / 180);
    const lat = genreLat[bucket] + (Math.random() - 0.5) * latSpread;
    const lon = yearNorm * Math.PI * 2 + (Math.random() - 0.5) * 0.15;
    const r = SPHERE_RADIUS + (Math.random() - 0.5) * 10;

    const x = r * Math.cos(lat) * Math.cos(lon);
    const y = r * Math.sin(lat);
    const z = r * Math.cos(lat) * Math.sin(lon);

    return { x, y, z };
  },

  placeLabels(ctx) {
    const {
      allBuckets, colorMap, OTHER, genreLat, SPHERE_RADIUS,
      makeLabel: makeLabelFn, yearRange, minYear, maxYear,
    } = ctx;

    const sprites = [];

    // Genre labels at their latitude band on the equator-facing side
    allBuckets.forEach(bucket => {
      if (bucket === '_other_') return;
      const lat = genreLat[bucket];
      const labelR = SPHERE_RADIUS + 15;
      const sprite = makeLabelFn(bucket, colorMap[bucket] || OTHER);
      sprite.position.set(labelR * Math.cos(lat), labelR * Math.sin(lat), 0);
      sprites.push(sprite);
    });

    // Year tick labels around the equator
    const yearStep = yearRange > 30 ? 10 : 5;
    const firstYear = Math.ceil(minYear / yearStep) * yearStep;
    for (let yr = firstYear; yr <= maxYear; yr += yearStep) {
      const lon = ((yr - minYear) / yearRange) * Math.PI * 2;
      const labelR = SPHERE_RADIUS + 12;
      const sprite = makeLabelFn(String(yr), '#bbb');
      sprite.position.set(labelR * Math.cos(lon), -2, labelR * Math.sin(lon));
      sprite.scale.set(8, 1.5, 1);
      sprites.push(sprite);
    }

    return sprites;
  },

  setCamera(ctx) {
    const { SPHERE_RADIUS } = ctx;
    const target = new THREE.Vector3(0, 0, 0);
    const position = new THREE.Vector3(0, SPHERE_RADIUS * 0.5, SPHERE_RADIUS * 2.2);
    return { target, position };
  },

  infoLines(ctx) {
    const { yearCol, genreCol, minYear, maxYear, topGenresCount } = ctx;
    const lines = [
      yearCol ? `⟳ ${minYear} — ${yearCol} — ${maxYear} (longitude)` : '',
      genreCol ? `↕ ${genreCol} (latitude, top ${topGenresCount})` : '',
      'scroll zoom · drag orbit · click to inspect',
    ];
    return lines.filter(Boolean);
  },
};
