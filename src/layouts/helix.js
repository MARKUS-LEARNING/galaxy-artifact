// ─── Helix — DNA double helix, year along the axis ───
//
// Two intertwined strands (alternating items between strand 0 and
// strand 1, 180° apart) winding around a vertical axis where height
// represents year. Twelve full revolutions across the year range so
// dense decades create visibly tighter coils.

import * as THREE from 'three';

export default {
  name: 'helix',

  placeItem(ctx) {
    const { yearNorm, li, HELIX_RADIUS } = ctx;

    const strand = li % 2;                 // alternate items between strands
    const theta = yearNorm * Math.PI * 12 + (Math.random() - 0.5) * 0.2;
    const helixY = (yearNorm - 0.5) * 120;
    const strandOffset = strand * Math.PI; // 180° apart
    const rJitter = HELIX_RADIUS + (Math.random() - 0.5) * 4;

    const x = rJitter * Math.cos(theta + strandOffset);
    const z = rJitter * Math.sin(theta + strandOffset);
    const y = helixY + (Math.random() - 0.5) * 2;

    return { x, y, z };
  },

  placeLabels(ctx) {
    const { HELIX_RADIUS, makeLabel: makeLabelFn, yearRange, minYear, maxYear } = ctx;

    const sprites = [];

    // Year markers along the helix axis (right side)
    const yearStep = yearRange > 30 ? 10 : 5;
    const firstYear = Math.ceil(minYear / yearStep) * yearStep;
    for (let yr = firstYear; yr <= maxYear; yr += yearStep) {
      const yNorm = (yr - minYear) / yearRange;
      const sprite = makeLabelFn(String(yr), '#bbb');
      sprite.position.set(HELIX_RADIUS + 8, (yNorm - 0.5) * 120, 0);
      sprite.scale.set(8, 1.5, 1);
      sprites.push(sprite);
    }

    return sprites;
  },

  setCamera() {
    const target = new THREE.Vector3(0, 0, 0);
    const position = new THREE.Vector3(60, 20, 60);
    return { target, position };
  },
};
