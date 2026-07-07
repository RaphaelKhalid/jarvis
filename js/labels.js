// Text label helpers — canvas-texture planes for pin labels & part names.
import * as THREE from 'three';

const texCache = new Map();

export function makeTextTexture(text, { color = '#ffffff', bg = null, fontPx = 48 } = {}) {
  const key = `${text}|${color}|${bg}|${fontPx}`;
  if (texCache.has(key)) return texCache.get(key);

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = `bold ${fontPx}px Consolas, monospace`;
  const w = Math.ceil(ctx.measureText(text).width) + 16;
  const h = fontPx + 16;
  canvas.width = w;
  canvas.height = h;

  if (bg) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.font = `bold ${fontPx}px Consolas, monospace`;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  tex.userData = { aspect: w / h };
  texCache.set(key, tex);
  return tex;
}

// A small flat label lying on top of a board (facing +Y).
export function makeFlatLabel(text, heightUnits, { color = '#ffffff' } = {}) {
  const tex = makeTextTexture(text, { color });
  const w = heightUnits * tex.userData.aspect;
  const geo = new THREE.PlaneGeometry(w, heightUnits);
  const mat = new THREE.MeshBasicMaterial({
    map: tex, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -1,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

// A billboard sprite label (always faces camera) — used for part titles.
export function makeSpriteLabel(text, heightUnits, { color = '#c8d3e0' } = {}) {
  const tex = makeTextTexture(text, { color, fontPx: 64 });
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(heightUnits * tex.userData.aspect, heightUnits, 1);
  return sprite;
}
