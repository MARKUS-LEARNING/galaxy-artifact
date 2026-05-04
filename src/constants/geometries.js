// ─── Geometry pool ───
//
// A library of factory functions that each construct one Three.js
// geometry primitive. The renderer picks a geometry per genre bucket
// using `bucketIdx % NUM_SHAPES`, so the *order* of this list is
// stable and load-bearing — reordering changes which shape a given
// genre gets across renders.
//
// Geometries are cached lazily via getCachedGeometry(idx): only
// shapes that get used are constructed, and each is constructed once
// per page lifetime (positions change per row but the geometry is
// shared across all instances of an InstancedMesh).

import * as THREE from 'three';

export const GEOMETRIES = [
  // Core primitives
  () => new THREE.SphereGeometry(0.35, 8, 6),
  () => new THREE.BoxGeometry(0.45, 0.45, 0.45),
  () => new THREE.ConeGeometry(0.3, 0.6, 6),
  () => new THREE.CylinderGeometry(0.15, 0.3, 0.5, 6),
  () => new THREE.CapsuleGeometry(0.15, 0.3, 4, 8),
  () => new THREE.TorusGeometry(0.25, 0.1, 8, 16),
  () => new THREE.TorusKnotGeometry(0.22, 0.08, 32, 8),
  () => new THREE.IcosahedronGeometry(0.35, 0),
  () => new THREE.OctahedronGeometry(0.35, 0),
  () => new THREE.DodecahedronGeometry(0.35, 0),
  () => new THREE.TetrahedronGeometry(0.4, 0),
  () => new THREE.CircleGeometry(0.35, 8),
  () => new THREE.RingGeometry(0.15, 0.35, 8),
  () => new THREE.PlaneGeometry(0.5, 0.5),
  // Subdivision variants
  () => new THREE.IcosahedronGeometry(0.4, 1),
  () => new THREE.OctahedronGeometry(0.45, 1),
  () => new THREE.DodecahedronGeometry(0.3, 1),
  () => new THREE.SphereGeometry(0.25, 4, 3),
  // Knot & torus variants
  () => new THREE.TorusKnotGeometry(0.18, 0.06, 24, 6, 3, 2),
  () => new THREE.TorusKnotGeometry(0.2, 0.07, 28, 6, 2, 5),
  () => new THREE.TorusGeometry(0.3, 0.08, 6, 12),
  // Custom polyhedron (diamond)
  () => new THREE.PolyhedronGeometry([0,0.5,0, 0.4,0,0, 0,-0.5,0, -0.4,0,0, 0,0,0.4, 0,0,-0.4],[0,1,4, 1,2,4, 2,3,4, 3,0,4, 1,0,5, 2,1,5, 3,2,5, 0,3,5],0.35,0),
  // Cone & cylinder variants
  () => new THREE.ConeGeometry(0.35, 0.4, 3),
  () => new THREE.CylinderGeometry(0.25, 0.25, 0.15, 6),
  // Lathe (vase silhouette)
  () => new THREE.LatheGeometry([new THREE.Vector2(0,0),new THREE.Vector2(0.25,0.1),new THREE.Vector2(0.3,0.25),new THREE.Vector2(0.15,0.45),new THREE.Vector2(0.2,0.5)], 8),
];

export const NUM_SHAPES = GEOMETRIES.length;

// Lazy cache: each geometry is built at most once per page lifetime,
// only when first requested. Indexed by the same idx used for lookup.
const _geomCache = new Array(NUM_SHAPES);

export function getCachedGeometry(idx) {
  const isUncached = !_geomCache[idx];
  if (isUncached) _geomCache[idx] = GEOMETRIES[idx]();
  return _geomCache[idx];
}
