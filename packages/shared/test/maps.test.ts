import { describe, expect, it } from 'vitest';
import { getMap, MAP_IDS, validateMap } from '../src/maps';
import { cellDiagonal, TERRAIN_RES, TerrainModel } from '../src/maps/terrainModel';
import { audit } from './mapAudit';

describe('board geometry (v0.5)', () => {
  for (const id of MAP_IDS) {
    describe(id, () => {
      const map = getMap(id);
      it('passes the map constraints', () => expect(validateMap(map)).toEqual([]));
      for (const key of ['decor', 'landmarks', 'buildings', 'fields', 'edges', 'ribbons', 'junctions', 'bridges', 'volcano', 'lava', 'cable', 'tide']) {
        it(`${key} are plausible`, () => expect(audit(map).problems[key]).toEqual([]));
      }
    });
  }

  it('the terrain sampler matches the mesh triangles', () => {
    const T = new TerrainModel(getMap('kokosnuss'));
    // on a grid vertex the height is exact, in the middle of a cell it lies on the diagonal the mesh uses
    for (const [i, j] of [
      [30, 40],
      [31, 40],
      [77, 101],
    ]) {
      const x = T.minX + i * TERRAIN_RES;
      const z = T.minZ + j * TERRAIN_RES;
      const k = j * T.nx + i;
      expect(T.height(x, z)).toBeCloseTo(T.h[k], 5);
      const diag = cellDiagonal(i, j) === 0 ? (T.h[k] + T.h[k + T.nx + 1]) / 2 : (T.h[k + 1] + T.h[k + T.nx]) / 2;
      expect(T.height(x + TERRAIN_RES / 2, z + TERRAIN_RES / 2)).toBeCloseTo(diag, 5);
    }
  });
});
