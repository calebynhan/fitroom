#!/usr/bin/env node
// Meshopt-compress pipeline GLBs in place with gltfpack, then decode the result and verify it still meets the
// Body/Garment GLB contracts before replacing the original.
//
// gltfpack -vpf / -vtf keep POSITION (incl. morph targets) and TEXCOORD as float32 after decoding (meshopt's
// exponential filter): the viewer measures fabric tiling from raw positions and UVs (metresPerUv) and swaps
// the material, which would drop a quantization texture transform. Normals and weights are quantized.
// drei's useGLTF registers the meshopt decoder by default.
//
// Usage: node pipeline/compress_glb.mjs <file.glb> [more.glb ...]
import { execFile } from 'node:child_process';
import { rename, rm, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const run = promisify(execFile);
const require = createRequire(import.meta.url);
const GLTFPACK = require.resolve('gltfpack/cli.js');
const GLTFPACK_ARGS = ['-cc', '-vpf', '-vtf', '-kv', '-kn', '-km', '-ke']; // -kv: keep UVs (no texture uses them)
const IBM_TOL = 1e-4;
const BOUNDS_TOL = 1e-3; // metres

function summary(doc) {
  const root = doc.getRoot();
  const mesh = root.listMeshes()[0];
  const prim = mesh.listPrimitives()[0];
  const pos = prim.getAttribute('POSITION');
  const skin = root.listSkins()[0];
  return {
    joints: skin ? skin.listJoints().map((j) => j.getName()) : [],
    ibm: skin ? Array.from(skin.getInverseBindMatrices().getArray()) : [],
    targets: mesh.getExtras().targetNames ?? [],
    weights: mesh.getWeights(),
    attributes: prim.listSemantics().sort(),
    min: pos.getMin([]),
    max: pos.getMax([]),
    animations: root.listAnimations().map((a) => a.getName()),
    materials: root.listMaterials().map((m) => m.getName()),
  };
}

function compare(a, b) {
  const errors = [];
  const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
  if (!same(a.joints, b.joints)) errors.push('joint names changed');
  if (!same(a.targets, b.targets)) errors.push(`morph targets ${a.targets} -> ${b.targets}`);
  if (!same(a.animations, b.animations)) errors.push('animation clips changed');
  if (!same(a.materials, b.materials)) errors.push('material names changed');
  if (!same(a.attributes, b.attributes)) errors.push(`attributes ${a.attributes} -> ${b.attributes}`);
  const ibm = a.ibm.reduce((m, v, i) => Math.max(m, Math.abs(v - b.ibm[i])), 0);
  if (a.ibm.length !== b.ibm.length || ibm > IBM_TOL) errors.push(`inverse bind matrices moved by ${ibm}`);
  const bounds = [...a.min.map((v, i) => Math.abs(v - b.min[i])), ...a.max.map((v, i) => Math.abs(v - b.max[i]))];
  if (Math.max(...bounds) > BOUNDS_TOL) errors.push(`bounds moved by ${Math.max(...bounds)} m`);
  return errors;
}

async function compress(io, path) {
  const before = (await stat(path)).size;
  const original = await io.read(path);
  if (original.getRoot().listExtensionsUsed().some((e) => e.extensionName === 'EXT_meshopt_compression')) {
    return `${path}: already compressed (${(before / 1024).toFixed(0)} KB)`;
  }
  const tmp = `${path}.packed.glb`;
  try {
    await run(process.execPath, [GLTFPACK, '-i', path, '-o', tmp, ...GLTFPACK_ARGS]);
    const errors = compare(summary(original), summary(await io.read(tmp)));
    if (errors.length > 0) throw new Error(errors.join('; '));
    await rename(tmp, path);
  } finally {
    await rm(tmp, { force: true });
  }
  const after = (await stat(path)).size;
  return `${path}: ${(before / 1024).toFixed(0)} KB -> ${(after / 1024).toFixed(0)} KB (verified)`;
}

async function main() {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error('usage: node pipeline/compress_glb.mjs <file.glb> [...]');
    process.exit(2);
  }
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  for (const f of files) {
    try {
      console.log(await compress(io, f));
    } catch (err) {
      console.error(`${f}: NOT compressed: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    }
  }
}

await main();
