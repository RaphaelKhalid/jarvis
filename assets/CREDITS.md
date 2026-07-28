# Asset credits

Every asset below is **CC0 (public domain)** — free for commercial use, no
attribution required. Credit is given here anyway because it costs nothing and
these are good projects.

Verified loadable by `tests/assets.spec.js`, which fails if any file is missing
or corrupt. Run it after adding or re-downloading anything here.

## HDRI — [Poly Haven](https://polyhaven.com/) (CC0)

| File | Source |
|---|---|
| `hdri/residential_garden_1k.hdr`, `_2k.hdr` | [residential_garden](https://polyhaven.com/a/residential_garden) |

Chosen to match the greenery visible through the window in the captured room:
overcast, EV9, so it lights the interior without blowing out the marble.

The room loads the **1k** on every tier. The HDRI is never rendered — it is only
convolved by PMREM into an environment map, so the 2k's extra detail is discarded
while its 6.5 MB of float decode is not. The 2k is kept for offline stills.

## Models — [Poly Haven](https://polyhaven.com/models) (CC0), glTF 1k

All under `models/polyhaven/<name>/<name>_1k.gltf` with a sibling `textures/`
folder (diffuse + ARM + OpenGL normal). Sizes are metres — the app is 1 unit =
1 cm, so these need a ×100 scale.

| Model | Tris | Notes |
|---|---|---|
Several are authored well over life size, and several are a *sheet of variants*
rather than one object — `placeModel()` in `js/app/room-assets.js` takes
`fitHeight` and `pick` for exactly these cases. ✓ = in the room today.

| Model | Tris | Real size + notes |
|---|---|---|
| [desk_lamp_arm_01](https://polyhaven.com/a/desk_lamp_arm_01) | 24k | ✓ 0.89 m tall; fitted to 46 cm |
| [classic_laptop](https://polyhaven.com/a/classic_laptop) | 14k | ✓ **0.65 m wide** — a huge laptop; fitted to 26 cm. Extra `lid_floaters_*` meshes are alternate lids |
| [potted_plant_02](https://polyhaven.com/a/potted_plant_02) | 70k | ✓ 0.84 m; floor plant right of the counter, fitted to 60 cm |
| [stationery_supplies](https://polyhaven.com/a/stationery_supplies) | 4k | ✓ 9 props laid out **side by side**. Picking keeps their original spacing, so a 2-item pick is still ~29 cm wide — the room takes only `pencilcup` |
| [pachira_aquatica_01](https://polyhaven.com/a/pachira_aquatica_01) | 77k | unused. Not one 6.9 m tree — **four variants side by side** (`bark_a..d` + `leaves_a..d`). Variant `_d` alone is a good 1.9 m tree, but its 1.4 m canopy doesn't fit this room |
| [ceramic_pot](https://polyhaven.com/a/ceramic_pot) | 4k | unused. **0.66 m wide** — a floor planter, not a desk pot |
| [drawer_cabinet](https://polyhaven.com/a/drawer_cabinet) | 26k | unused. Redundant with the built-in cabinet + washer |
| [modular_electric_cables](https://polyhaven.com/a/modular_electric_cables) | 42k | unused. 49-piece modular kit for wall runs, authored **flat in the XY plane on a layout grid** — each piece needs its own rotation to lie on a counter |

## Materials — [ambientCG](https://ambientcg.com/) (CC0), 1K JPG

Under `textures/pbr/<name>/`. Pruned to the maps three.js uses — `_Color`,
`_NormalGL`, `_Roughness`, and `_AmbientOcclusion` where supplied. The `.blend`,
`.usdc`, `.mtlx`, `.tres`, DirectX normals and displacement maps that ship in
the source zips were deleted (34 MB → 18 MB); re-download from ambientCG if any
are ever needed.

**These were originally picked by name, and three of them do not look like their
names.** What each one actually is, and how `bench-room.js` uses it:

| Material | What it actually looks like | Used as |
|---|---|---|
| [WoodFloor051](https://ambientcg.com/view?id=WoodFloor051) | light oak flooring ✓ | the floor, as shipped — the only set used unmodified |
| [Marble016](https://ambientcg.com/view?id=Marble016) | **black** marble, not calacatta | countertop, but **normal + roughness only**; albedo is a procedural calacatta canvas |
| [PaintedPlaster016](https://ambientcg.com/view?id=PaintedPlaster016) | distressed plaster falling off **exposed brick** | **unused.** Even its normal map carries brick relief, so the wall is fully procedural |
| [PaintedWood008C](https://ambientcg.com/view?id=PaintedWood008C) | dark weathered **barn wood**, not painted | cabinet fronts, **normal + roughness only** — the grain reads as grain under paint; albedo is flat sage |
| [Fabric061](https://ambientcg.com/view?id=Fabric061) | grey-beige upholstery weave | curtain, **normal + roughness only**; albedo is flat off-white |

Why not just tint them? three multiplies `color × albedo`, so a tint can only
ever *darken*. There is no tint that turns black marble white. `pbrMaterial(name,
{ useColor: false })` in `js/app/room-assets.js` is the mechanism — it loads
everything except the albedo.

If you want these surfaces to come from real scanned albedos, the fix is to
download correctly-chosen sets (a white/calacatta marble, a clean interior wall,
a painted cabinet) and drop the `useColor: false`.
