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

## Models — [Poly Haven](https://polyhaven.com/models) (CC0), glTF 1k

All under `models/polyhaven/<name>/<name>_1k.gltf` with a sibling `textures/`
folder (diffuse + ARM + OpenGL normal). Sizes are metres — the app is 1 unit =
1 cm, so these need a ×100 scale.

| Model | Tris | Notes |
|---|---|---|
| [desk_lamp_arm_01](https://polyhaven.com/a/desk_lamp_arm_01) | 24k | rigged; closest match to the lamp in the capture |
| [classic_laptop](https://polyhaven.com/a/classic_laptop) | 14k | |
| [potted_plant_02](https://polyhaven.com/a/potted_plant_02) | 70k | desk-sized (0.7 m) |
| [pachira_aquatica_01](https://polyhaven.com/a/pachira_aquatica_01) | 77k | **6.9 m wide** — floor plant, not a desk prop |
| [modular_electric_cables](https://polyhaven.com/a/modular_electric_cables) | 42k | 49 meshes — pick individual cables, don't place whole |
| [stationery_supplies](https://polyhaven.com/a/stationery_supplies) | 4k | 9 separate props |
| [ceramic_pot](https://polyhaven.com/a/ceramic_pot) | 4k | |
| [drawer_cabinet](https://polyhaven.com/a/drawer_cabinet) | 26k | |

## Materials — [ambientCG](https://ambientcg.com/) (CC0), 1K JPG

Under `textures/pbr/<name>/`. Pruned to the maps three.js uses — `_Color`,
`_NormalGL`, `_Roughness`, and `_AmbientOcclusion` where supplied. The `.blend`,
`.usdc`, `.mtlx`, `.tres`, DirectX normals and displacement maps that ship in
the source zips were deleted (34 MB → 18 MB); re-download from ambientCG if any
are ever needed.

| Material | Use |
|---|---|
| [Marble016](https://ambientcg.com/view?id=Marble016) | calacatta countertop |
| [WoodFloor051](https://ambientcg.com/view?id=WoodFloor051) | light oak floor |
| [PaintedPlaster016](https://ambientcg.com/view?id=PaintedPlaster016) | walls |
| [PaintedWood008C](https://ambientcg.com/view?id=PaintedWood008C) | cabinet fronts |
| [Fabric061](https://ambientcg.com/view?id=Fabric061) | curtain |
