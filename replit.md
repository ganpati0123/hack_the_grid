# Egyptian City — 3D Viewer

A React-based 3D viewer for `egyptian_city.glb` using @react-three/fiber and Three.js.

## Stack
- React 18 + Vite
- @react-three/fiber (Three.js React renderer)
- @react-three/drei (OrbitControls, useGLTF)

## Run
```
npm run dev
```
Serves on port 5000.

## How it works
- The GLB file lives in `public/egyptian_city.glb` so Vite serves it at `/egyptian_city.glb`
- `src/App.jsx` loads the model, auto-centers it (X/Z centered, base at Y=0), and renders it with OrbitControls
- No custom lighting is added — the GLB's own materials and embedded lights are used as-is

## Controls
- **Drag** — Rotate
- **Scroll** — Zoom
- **Right-drag** — Pan

## User preferences
- Keep the GLB's original lighting/materials — do not add custom lights
- React-based website only
