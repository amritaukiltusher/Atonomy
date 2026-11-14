# AnatomyLive — Live 3D Human Anatomy

A dark-themed 3D human anatomy website that runs entirely in the browser.

- **3D Atlas** — male and female bodies with 135 named structures (skin, skeleton, muscles, organs, vessels, nerves, 12 joint hotspots). Rotate, zoom, click any structure, search, toggle systems, fade layers, explode the body, cut sections, save a PNG.
- **Live Scan** — point a webcam at yourself. The skull, brain, jaw, eyes and tongue follow your head; open your mouth and the jaw opens; hold up a hand and its bones follow every finger. Video is processed on your device and never uploaded.
- **Try demo** — a simulated head and hands, so the page works without a camera.

Built with Vite, Three.js and MediaPipe Tasks (Face Landmarker + Hand Landmarker). No backend.

## Run locally

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # outputs dist/
```

The camera needs a secure origin: `localhost` or `https://` (GitHub Pages is https).

## Deploy to GitHub Pages

1. Create a repository on GitHub and push this folder to the `main` branch.
2. In the repository go to **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. The workflow in `.github/workflows/deploy.yml` builds and publishes on every push to `main`.

The build uses a relative base path, so it works at `https://<user>.github.io/<repo>/` without changes.

## Tracking models

On first use the browser downloads the two MediaPipe model files (about 15 MB) from Google's CDN
(`storage.googleapis.com/mediapipe-models`). To make the site fully offline, download

- `face_landmarker.task`
- `hand_landmarker.task`

and place them in `public/models/mediapipe/`; the app uses local copies when they exist.
The MediaPipe WASM runtime is already self-hosted in `public/wasm/`.

## How the Live Scan works

- **Head:** MediaPipe's facial transformation matrix gives rotation and distance. Four rigid features (nose tip, nasion, both irises) are matched to the same points on the anatomy model to solve scale and screen position. Pose is smoothed with a One-Euro filter.
- **Jaw / eyes:** blendshape scores (`jawOpen`, `jawLeft/Right/Forward`, `eyeLook*`) rotate the mandible about the condyles and the eyeballs about their centres. The merged teeth mesh is split into upper and lower sets so the lower teeth move with the jaw.
- **Hands:** the single hand-bone mesh is skinned to a 21-point skeleton (palm plus three bones per finger and thumb) with distance-based weights. Each frame the 21 tracked landmarks drive the bones. MediaPipe's 3D "world" landmarks give true hand shape; the 2D landmarks fix position and depth.
- A **Fine alignment** panel lets you nudge size / height / depth of the head overlay, and **Show tracking points** draws the raw landmarks for debugging.

## Known limits

- The anatomy is a reference adult male; it is scaled to your head but not reshaped to it.
- Hand depth comes from a pinhole assumption (63° vertical field of view), so overlay accuracy depends on your camera.
- If left and right hands appear swapped, use **Swap left / right hand**.
- Educational use only — not for diagnosis.

## Credits and licences

Code: MIT. Anatomy models are adapted works under **CC BY 4.0** and must keep this credit:

> Anatomy: BodyParts3D © The Database Center for Life Science (CC BY 4.0); female organs: Human Reference Atlas 3D Reference Organs, HuBMAP (CC BY 4.0); female body: MakeHuman (CC0). Modified by open-anatomy-3d (https://github.com/MervinR07/open-anatomy-3d), CC BY 4.0.

Models come from the [`open-anatomy-3d`](https://github.com/MervinR07/open-anatomy-3d) package. Tracking by [MediaPipe](https://ai.google.dev/edge/mediapipe) (Apache 2.0).
