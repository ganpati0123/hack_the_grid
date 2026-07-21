import { Suspense, useEffect, useRef, useState, useCallback, Component } from 'react'
import { Canvas, useThree, useFrame } from '@react-three/fiber'
import { useGLTF, Html } from '@react-three/drei'
import * as THREE from 'three'

useGLTF.preload('/egyptian_city.glb')

// ─── Constants ────────────────────────────────────────────────────────────────
const MODEL_ROTATION_Y    = Math.PI
const GATE_X_FRACTION     = 0.12
const SPAWN_BUFFER        = -20
const EYE_HEIGHT_FRACTION = 0.20
const WALK_SPEED_FRACTION = 0.35
const MOUSE_SENSITIVITY   = 0.004
const ROAD_Y_THRESHOLD    = 0.14   // fraction of model height → ground = road
const GRID_RES            = 72     // NxN walkable grid resolution
const PATH_SPEED          = 0.055  // lerp speed while following path
const YAW_LERP            = 0.07   // how fast camera turns on road bends
// ─────────────────────────────────────────────────────────────────────────────

let g_eyeHeight  = 10
let g_walkSpeed  = 80
let g_bounds     = null
let g_modelSize  = new THREE.Vector3()
let g_sceneObj   = null

// ─── Walkable Grid ────────────────────────────────────────────────────────────
// Returns { grid:Uint8Array, cols, rows, waypoints:Vector3[] }
function buildNavData(scene, bounds, modelSize) {
  const cols      = GRID_RES
  const rows      = GRID_RES
  const grid      = new Uint8Array(cols * rows)  // 1 = walkable road
  const raycaster = new THREE.Raycaster()
  const down      = new THREE.Vector3(0, -1, 0)
  const castY     = bounds.max.y + 20
  const roadYLim  = modelSize.y * ROAD_Y_THRESHOLD

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = bounds.min.x + (bounds.max.x - bounds.min.x) * (c + 0.5) / cols
      const z = bounds.min.z + (bounds.max.z - bounds.min.z) * (r + 0.5) / rows
      raycaster.set(new THREE.Vector3(x, castY, z), down)
      const hits = raycaster.intersectObject(scene, true)
      if (hits.length > 0 && hits[0].point.y <= roadYLim) {
        grid[r * cols + c] = 1
      }
    }
  }

  // Pick waypoints: walkable cells at regular spacing, avoiding isolated pixels
  const waypoints = []
  const step = 3
  for (let r = step; r < rows - step; r += step) {
    for (let c = step; c < cols - step; c += step) {
      if (grid[r * cols + c] === 1) {
        // Confirm neighbours also walkable (road, not noise)
        const ok = grid[(r-1)*cols+c] + grid[(r+1)*cols+c] +
                   grid[r*cols+c-1]   + grid[r*cols+c+1] >= 2
        if (ok) {
          const wx = bounds.min.x + (bounds.max.x - bounds.min.x) * (c + 0.5) / cols
          const wz = bounds.min.z + (bounds.max.z - bounds.min.z) * (r + 0.5) / rows
          waypoints.push({ pos: new THREE.Vector3(wx, g_eyeHeight, wz), c, r })
        }
      }
    }
  }

  return { grid, cols, rows, waypoints }
}

// ─── World ↔ Grid helpers ─────────────────────────────────────────────────────
function worldToCell(x, z, bounds, cols, rows) {
  const c = Math.floor((x - bounds.min.x) / (bounds.max.x - bounds.min.x) * cols)
  const r = Math.floor((z - bounds.min.z) / (bounds.max.z - bounds.min.z) * rows)
  return {
    c: Math.max(0, Math.min(cols - 1, c)),
    r: Math.max(0, Math.min(rows - 1, r)),
  }
}

function cellToWorld(c, r, bounds, cols, rows) {
  return new THREE.Vector3(
    bounds.min.x + (c + 0.5) / cols * (bounds.max.x - bounds.min.x),
    g_eyeHeight,
    bounds.min.z + (r + 0.5) / rows * (bounds.max.z - bounds.min.z),
  )
}

// ─── A* Pathfinding on walkable grid ─────────────────────────────────────────
function astar(sc, sr, ec, er, grid, cols, rows) {
  const key  = (c, r) => r * cols + c
  const h    = (c, r) => Math.abs(c - ec) + Math.abs(r - er)
  const open = new Map()
  const g    = new Map()
  const prev = new Map()

  const startKey = key(sc, sr)
  g.set(startKey, 0)
  open.set(startKey, { c: sc, r: sr, f: h(sc, sr) })

  const DIRS = [
    [1,0],[-1,0],[0,1],[0,-1],
    [1,1],[1,-1],[-1,1],[-1,-1],
  ]

  let iterations = 0
  while (open.size > 0 && iterations++ < 8000) {
    // pick lowest f
    let bestKey = null, bestF = Infinity
    for (const [k, v] of open) { if (v.f < bestF) { bestF = v.f; bestKey = k } }
    const cur = open.get(bestKey)
    open.delete(bestKey)

    if (cur.c === ec && cur.r === er) {
      // Reconstruct
      const path = []
      let k = key(ec, er)
      while (k !== undefined) {
        const [c, r] = [k % cols, Math.floor(k / cols)]
        path.unshift({ c, r })
        k = prev.get(k)
      }
      return path
    }

    const gCur = g.get(bestKey) ?? Infinity
    for (const [dc, dr] of DIRS) {
      const nc = cur.c + dc, nr = cur.r + dr
      if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue
      if (grid[nr * cols + nc] !== 1) continue
      const cost  = gCur + (Math.abs(dc) + Math.abs(dr) === 2 ? 1.41 : 1)
      const nk    = key(nc, nr)
      if (cost < (g.get(nk) ?? Infinity)) {
        g.set(nk, cost)
        prev.set(nk, bestKey)
        open.set(nk, { c: nc, r: nr, f: cost + h(nc, nr) })
      }
    }
  }
  return null   // no path
}

// ─── Scene ────────────────────────────────────────────────────────────────────
function Scene({ onLoad, onSceneReady }) {
  const { scene }   = useGLTF('/egyptian_city.glb')
  const { camera }  = useThree()
  const initialized = useRef(false)

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true

    const rawBox  = new THREE.Box3().setFromObject(scene)
    const rawSize = new THREE.Vector3()
    rawBox.getSize(rawSize)
    const rawMax  = Math.max(rawSize.x, rawSize.y, rawSize.z)

    const TARGET    = 500
    const autoScale = rawMax > 0 ? TARGET / rawMax : 1
    scene.scale.set(autoScale, autoScale, autoScale)
    scene.rotation.y = MODEL_ROTATION_Y
    scene.updateMatrixWorld(true)

    const box    = new THREE.Box3().setFromObject(scene)
    const center = box.getCenter(new THREE.Vector3())
    const size   = new THREE.Vector3()
    box.getSize(size)

    scene.position.set(-center.x, -box.min.y, -center.z)
    scene.updateMatrixWorld(true)
    scene.matrixAutoUpdate = false

    const finalBox = new THREE.Box3().setFromObject(scene)
    g_bounds   = finalBox.clone()
    g_sceneObj = scene
    g_modelSize.copy(size)

    const maxDim    = Math.max(size.x, size.y, size.z)
    const eyeHeight = Math.max(size.y * EYE_HEIGHT_FRACTION, 3)
    const walkSpeed = maxDim * WALK_SPEED_FRACTION
    const spawnX    = size.x * GATE_X_FRACTION * 0.5
    const spawnZ    = size.z * 0.5 + SPAWN_BUFFER

    g_eyeHeight = eyeHeight
    g_walkSpeed = walkSpeed

    camera.near = maxDim * 0.001
    camera.far  = maxDim * 50
    camera.fov  = 75
    camera.position.set(spawnX, eyeHeight, spawnZ)
    camera.rotation.set(0, 0, 0)
    camera.updateProjectionMatrix()

    onSceneReady(scene, finalBox, size)
    onLoad()
  }, [scene, camera, onLoad, onSceneReady])

  return <primitive object={scene} />
}

// ─── Egyptian waypoint names (cycling) ───────────────────────────────────────
const WAYPOINT_NAMES = [
  'Sphinx Gate', 'Temple of Ra', 'Pharaoh\'s Road', 'Nile Bazaar',
  'Obelisk Square', 'Anubis Path', 'Isis Courtyard', 'Osiris Way',
  'Horus Street', 'Cleopatra Avenue', 'Ramesses Plaza', 'Karnak Passage',
  'Luxor Lane', 'Sacred Scarab Rd', 'Valley of Kings', 'Amun Quarter',
  'Papyrus Market', 'Crocodile Alley', 'Golden Throne St', 'Nefertiti Walk',
  'Desert Wind Rd', 'Pyramid Gate', 'Lotus Pond Path', 'Sobek Shrine Rd',
  'Bastet Temple Way', 'Thoth Library Ln', 'Eye of Horus St', 'Ankh Cross Rd',
  'Sarcophagus Sq', 'Hieroglyph Alley', 'Mentuhotep Rd', 'Hathor Temple Ln',
  'Sundisc Circle', 'Canopic Way', 'Heliopolis Blvd', 'Memphis Road',
  'Thebes Passage', 'Rosetta Path', 'Apis Bull Lane', 'Aten Shrine Rd',
]

// ─── Waypoint markers ─────────────────────────────────────────────────────────
function WaypointMarkers({ waypoints, hoveredIdx, activePathIdx }) {
  if (!waypoints.length) return null
  return (
    <group>
      {waypoints.map(({ pos }, i) => {
        const isH  = i === hoveredIdx
        const isA  = i === activePathIdx
        const r    = isH ? 3.8 : 2.4
        const col  = isA ? '#ffff00' : isH ? '#ffffff' : '#ffcc44'
        const op   = isH ? 0.95 : 0.5
        const name = WAYPOINT_NAMES[i % WAYPOINT_NAMES.length]
        return (
          <group key={i} position={[pos.x, pos.y + 0.3, pos.z]}>
            {/* Ring */}
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[r * 0.6, r, 28]} />
              <meshBasicMaterial color={col} transparent opacity={op} depthTest={false} />
            </mesh>
            {/* Dot */}
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <circleGeometry args={[r * 0.22, 14]} />
              <meshBasicMaterial color={col} transparent opacity={op + 0.2} depthTest={false} />
            </mesh>
            {/* Floating name label */}
            <Html
              center
              position={[0, r * 1.6, 0]}
              distanceFactor={80}
              zIndexRange={[0, 10]}
              style={{ pointerEvents: 'none' }}
            >
              <div style={{
                background: isH ? 'rgba(255,200,60,0.95)' : 'rgba(0,0,0,0.65)',
                color:      isH ? '#1a0a00' : '#ffcc88',
                fontFamily: 'sans-serif',
                fontSize:   isH ? '13px' : '11px',
                fontWeight: isH ? 700 : 500,
                padding:    '3px 8px',
                borderRadius: 5,
                border: `1px solid ${isH ? '#ffaa00' : 'rgba(255,200,100,0.3)'}`,
                whiteSpace: 'nowrap',
                opacity: isH ? 1 : 0.8,
                transition: 'all 0.15s',
                textAlign: 'center',
                letterSpacing: '0.02em',
              }}>
                {name}
              </div>
            </Html>
          </group>
        )
      })}
    </group>
  )
}

// ─── Waypoint hover picker ────────────────────────────────────────────────────
function WaypointPicker({ waypoints, onHover, onPick, navActive }) {
  const { camera, gl } = useThree()
  const mouse = useRef(new THREE.Vector2())

  useEffect(() => {
    if (!waypoints.length) return
    const canvas = gl.domElement

    const toNDC = (cx, cy) => {
      const rect = canvas.getBoundingClientRect()
      mouse.current.x =  ((cx - rect.left) / rect.width)  * 2 - 1
      mouse.current.y = -((cy - rect.top)  / rect.height) * 2 + 1
    }

    const nearest = () => {
      const ray = new THREE.Raycaster()
      ray.setFromCamera(mouse.current, camera)
      const r = ray.ray
      const RADIUS = Math.max(g_eyeHeight * 3, 20)
      let best = -1, bestD = Infinity
      waypoints.forEach(({ pos }, i) => {
        const d = r.distanceToPoint(pos)
        const camDist = pos.distanceTo(camera.position)
        if (d < RADIUS && camDist < bestD) { bestD = camDist; best = i }
      })
      return best
    }

    const onMove  = (e) => { toNDC(e.clientX, e.clientY); onHover(nearest()) }
    const onClick = (e) => { toNDC(e.clientX, e.clientY); const i = nearest(); if (i >= 0) onPick(i) }

    canvas.addEventListener('mousemove', onMove)
    canvas.addEventListener('click', onClick)
    return () => {
      canvas.removeEventListener('mousemove', onMove)
      canvas.removeEventListener('click', onClick)
    }
  }, [waypoints, camera, gl, onHover, onPick])

  return null
}

// ─── Road Navigator: follows A* path, auto-turns at bends ────────────────────
function RoadNavigator({ pathRef, navActiveRef, yawRef }) {
  const { camera } = useThree()
  const nodeIdx    = useRef(0)
  const prevPath   = useRef(null)

  useFrame(() => {
    const path = pathRef.current
    if (!navActiveRef.current || !path || path.length === 0) return

    // Reset node index when path changes
    if (path !== prevPath.current) {
      nodeIdx.current = 0
      prevPath.current = path
    }

    let idx = nodeIdx.current
    if (idx >= path.length) { navActiveRef.current = false; return }

    const target = path[idx]
    const dx = target.x - camera.position.x
    const dz = target.z - camera.position.z
    const dist = Math.sqrt(dx * dx + dz * dz)

    if (dist < 2.5) {
      // Reached this node — advance
      nodeIdx.current = idx + 1
      if (nodeIdx.current >= path.length) { navActiveRef.current = false; return }
    }

    // Move toward current node
    camera.position.x += dx * PATH_SPEED
    camera.position.z += dz * PATH_SPEED
    camera.position.y  = g_eyeHeight

    // Auto-turn: smoothly rotate yaw toward movement direction
    if (dist > 0.5) {
      const targetYaw = Math.atan2(-dx, -dz)
      let delta = targetYaw - yawRef.current
      // Normalize to [-π, π]
      while (delta > Math.PI)  delta -= 2 * Math.PI
      while (delta < -Math.PI) delta += 2 * Math.PI
      yawRef.current += delta * YAW_LERP
    }
  })

  return null
}

// ─── Manual free controls (WASD + drag-look + scroll) ────────────────────────
function FreeControls({ topViewRef, navActiveRef, yawRef, pitchRef }) {
  const { camera, gl } = useThree()
  const keysRef   = useRef({})
  const dragRef   = useRef(false)
  const zoomDelta = useRef(0)

  useEffect(() => {
    const canvas = gl.domElement

    const onKeyDown = (e) => {
      keysRef.current[e.code] = true
      navActiveRef.current = false   // manual key cancels nav
      if (['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))
        e.preventDefault()
    }
    const onKeyUp = (e) => { keysRef.current[e.code] = false }

    const onWheel = (e) => { e.preventDefault(); zoomDelta.current += e.deltaY }

    const onMouseDown = (e) => {
      if (e.button === 0) { dragRef.current = true; navActiveRef.current = false }
    }
    const onMouseUp   = () => { dragRef.current = false }
    const onMouseMove = (e) => {
      if (!dragRef.current || topViewRef.current) return
      yawRef.current   -= e.movementX * MOUSE_SENSITIVITY
      pitchRef.current -= e.movementY * MOUSE_SENSITIVITY
      pitchRef.current  = Math.max(-Math.PI / 2.5, Math.min(Math.PI / 2.5, pitchRef.current))
    }

    let lx = 0, ly = 0
    const onTouchStart = (e) => { dragRef.current = true; navActiveRef.current = false; lx = e.touches[0].clientX; ly = e.touches[0].clientY }
    const onTouchEnd   = () => { dragRef.current = false }
    const onTouchMove  = (e) => {
      if (!dragRef.current || topViewRef.current) return
      const dx = e.touches[0].clientX - lx; const dy = e.touches[0].clientY - ly
      lx = e.touches[0].clientX; ly = e.touches[0].clientY
      yawRef.current   -= dx * MOUSE_SENSITIVITY
      pitchRef.current -= dy * MOUSE_SENSITIVITY
      pitchRef.current  = Math.max(-Math.PI / 2.5, Math.min(Math.PI / 2.5, pitchRef.current))
    }

    window.addEventListener('keydown',   onKeyDown)
    window.addEventListener('keyup',     onKeyUp)
    canvas.addEventListener('wheel',     onWheel,      { passive: false })
    canvas.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mouseup',   onMouseUp)
    window.addEventListener('mousemove', onMouseMove)
    canvas.addEventListener('touchstart',onTouchStart, { passive: true })
    window.addEventListener('touchend',  onTouchEnd)
    window.addEventListener('touchmove', onTouchMove,  { passive: true })

    return () => {
      window.removeEventListener('keydown',   onKeyDown)
      window.removeEventListener('keyup',     onKeyUp)
      canvas.removeEventListener('wheel',     onWheel)
      canvas.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mouseup',   onMouseUp)
      window.removeEventListener('mousemove', onMouseMove)
      canvas.removeEventListener('touchstart',onTouchStart)
      window.removeEventListener('touchend',  onTouchEnd)
      window.removeEventListener('touchmove', onTouchMove)
    }
  }, [gl, topViewRef, navActiveRef, yawRef, pitchRef])

  const moveDir = useRef(new THREE.Vector3())
  const euler   = useRef(new THREE.Euler(0, 0, 0, 'YXZ'))
  const fwd     = useRef(new THREE.Vector3())

  useFrame((_, delta) => {
    if (topViewRef.current) return

    // Apply look from yawRef / pitchRef (also updated by RoadNavigator)
    euler.current.set(pitchRef.current, yawRef.current, 0, 'YXZ')
    camera.quaternion.setFromEuler(euler.current)

    if (navActiveRef.current) return   // Navigator handles position

    // Scroll zoom
    if (zoomDelta.current !== 0) {
      fwd.current.set(0, 0, -1).applyEuler(new THREE.Euler(0, yawRef.current, 0))
      camera.position.addScaledVector(fwd.current, -zoomDelta.current * 0.4)
      zoomDelta.current = 0
    }

    // WASD (road-constrained: only move if next cell is walkable)
    const k   = keysRef.current
    const dir = moveDir.current.set(0, 0, 0)
    if (k['KeyW'] || k['ArrowUp'])    dir.z -= 1
    if (k['KeyS'] || k['ArrowDown'])  dir.z += 1
    if (k['KeyA'] || k['ArrowLeft'])  dir.x -= 1
    if (k['KeyD'] || k['ArrowRight']) dir.x += 1

    if (dir.lengthSq() > 0) {
      dir.normalize()
      dir.applyEuler(new THREE.Euler(0, yawRef.current, 0))
      const step  = g_walkSpeed * delta
      const nx    = camera.position.x + dir.x * step
      const nz    = camera.position.z + dir.z * step
      // Only allow movement if next position is on road
      if (g_bounds && g_sceneObj) {
        const { c, r } = worldToCell(nx, nz, g_bounds, GRID_RES, GRID_RES)
        // Use the navData walkable grid stored in window for check
        const walkable = window.__navGrid && window.__navGrid[r * GRID_RES + c] === 1
        if (walkable) {
          camera.position.x = nx
          camera.position.z = nz
        }
      }
    }

    camera.position.y = g_eyeHeight

    if (g_bounds) {
      const pad = g_eyeHeight * 0.5
      camera.position.x = Math.max(g_bounds.min.x + pad, Math.min(g_bounds.max.x - pad, camera.position.x))
      camera.position.z = Math.max(g_bounds.min.z + pad, Math.min(g_bounds.max.z - pad, camera.position.z))
    }
  })

  return null
}

// ─── Top-view camera ──────────────────────────────────────────────────────────
function TopViewCamera({ topViewRef }) {
  const { camera } = useThree()
  const tgt  = useRef(new THREE.Vector3())
  const tgtQ = useRef(new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0, 'YXZ')))

  useFrame(() => {
    if (!topViewRef.current || !g_bounds) return
    const cx   = (g_bounds.min.x + g_bounds.max.x) / 2
    const cz   = (g_bounds.min.z + g_bounds.max.z) / 2
    const span = Math.max(g_bounds.max.x - g_bounds.min.x, g_bounds.max.z - g_bounds.min.z)
    tgt.current.set(cx, g_bounds.max.y + span * 0.8, cz)
    camera.position.lerp(tgt.current, 0.08)
    camera.quaternion.slerp(tgtQ.current, 0.08)
  })

  return null
}

// ─── Saved position restorer when leaving top-view ───────────────────────────
function PositionSaver({ topViewRef, savedPosRef, yawRef, pitchRef }) {
  const { camera } = useThree()
  const wasTop = useRef(false)

  useFrame(() => {
    const isTop = topViewRef.current
    if (!isTop) savedPosRef.current.set(camera.position.x, 0, camera.position.z)
    if (wasTop.current && !isTop) {
      camera.position.set(savedPosRef.current.x, g_eyeHeight, savedPosRef.current.z)
      camera.quaternion.setFromEuler(new THREE.Euler(pitchRef.current, yawRef.current, 0, 'YXZ'))
    }
    wasTop.current = isTop
  })
  return null
}

// ─── Error boundary ───────────────────────────────────────────────────────────
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(e) { return { error: e } }
  render() {
    if (this.state.error) return (
      <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column',
        alignItems:'center', justifyContent:'center',
        color:'#ffcc88', fontFamily:'sans-serif', background:'#1a0a00', gap:12 }}>
        <div style={{fontSize:36}}>⚠️</div>
        <div style={{fontSize:18}}>3D viewer failed to load</div>
        <div style={{fontSize:13, opacity:0.6, maxWidth:400, textAlign:'center'}}>{this.state.error.message}</div>
      </div>
    )
    return this.props.children
  }
}

// ─── Loader ───────────────────────────────────────────────────────────────────
function Loader({ phase }) {
  const msg = { loading:'Loading Egyptian City…', scanning:'Scanning roads…', pathfinding:'Building road map…' }
  return (
    <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column',
      alignItems:'center', justifyContent:'center',
      color:'#ffcc88', fontFamily:'sans-serif', background:'#1a0a00',
      gap:16, pointerEvents:'none', zIndex:10 }}>
      <div style={{ width:48, height:48, border:'4px solid #4a2800',
        borderTop:'4px solid #ffcc88', borderRadius:'50%', animation:'spin 1s linear infinite' }}/>
      <div style={{fontSize:16}}>{msg[phase] || 'Loading…'}</div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}

// ─── Hint ─────────────────────────────────────────────────────────────────────
function Hint({ topView, navigating }) {
  return (
    <div style={{ position:'absolute', bottom:24, left:'50%', transform:'translateX(-50%)',
      background:'rgba(0,0,0,0.55)', color:'#ffcc88', fontFamily:'sans-serif',
      fontSize:13, padding:'8px 18px', borderRadius:8, pointerEvents:'none',
      border:'1px solid rgba(255,200,100,0.2)', whiteSpace:'nowrap' }}>
      {topView      ? '🗺 Top View — click Street View to walk' :
       navigating   ? '🔶 Navigating road… drag or press key to stop' :
                      '🖱 Drag to look · WASD to walk · Click 🔶 waypoint to navigate'}
    </div>
  )
}

// ─── View toggle ──────────────────────────────────────────────────────────────
function ViewToggle({ topView, onToggle }) {
  return (
    <button onClick={onToggle} style={{
      position:'absolute', top:20, right:20,
      background: topView ? 'rgba(255,200,100,0.9)' : 'rgba(0,0,0,0.65)',
      color: topView ? '#1a0a00' : '#ffcc88',
      border:'1px solid rgba(255,200,100,0.5)',
      borderRadius:8, padding:'8px 16px',
      fontFamily:'sans-serif', fontSize:13, fontWeight:600,
      cursor:'pointer', zIndex:20, backdropFilter:'blur(4px)', transition:'all 0.2s',
    }}>
      {topView ? '🚶 Street View' : '🗺 Top View'}
    </button>
  )
}

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [phase, setPhase]         = useState('loading')
  const [topView, setTopView]     = useState(false)
  const [navData, setNavData]     = useState(null)      // { grid, cols, rows, waypoints }
  const [hoveredIdx, setHoveredIdx]   = useState(-1)
  const [activePathIdx, setActivePathIdx] = useState(-1)
  const [navigating, setNavigating]   = useState(false)

  const topViewRef   = useRef(false)
  const navActiveRef = useRef(false)
  const pathRef      = useRef(null)
  const yawRef       = useRef(0)
  const pitchRef     = useRef(0)
  const savedPosRef  = useRef(new THREE.Vector3())

  const handleLoad = useCallback(() => setPhase('scanning'), [])

  const handleSceneReady = useCallback((scene, bounds, modelSize) => {
    setTimeout(() => {
      setPhase('pathfinding')
      setTimeout(() => {
        const data = buildNavData(scene, bounds, modelSize)
        window.__navGrid = data.grid   // expose for WASD collision
        setNavData(data)
        setPhase('ready')
      }, 30)
    }, 30)
  }, [])

  const toggleTopView = useCallback(() => {
    setTopView(v => { topViewRef.current = !v; return !v })
  }, [])

  const handlePick = useCallback((idx) => {
    if (!navData || !g_bounds) return
    // Get camera position as grid cell
    const { camera } = window.__threeCamera || {}
    if (!camera) return

    const { c: sc, r: sr } = worldToCell(camera.position.x, camera.position.z, g_bounds, navData.cols, navData.rows)
    const { c: ec, r: er } = navData.waypoints[idx]

    const rawPath = astar(sc, sr, ec, er, navData.grid, navData.cols, navData.rows)
    if (!rawPath || rawPath.length < 2) return

    // Convert grid path to world positions (thin out: every 2 nodes)
    const worldPath = rawPath
      .filter((_, i) => i % 2 === 0 || i === rawPath.length - 1)
      .map(({ c, r }) => cellToWorld(c, r, g_bounds, navData.cols, navData.rows))

    pathRef.current    = worldPath
    navActiveRef.current = true
    setActivePathIdx(idx)
    setNavigating(true)
  }, [navData])

  // Track navigation state for UI
  useEffect(() => {
    const id = setInterval(() => {
      if (!navActiveRef.current && navigating) setNavigating(false)
      if (navActiveRef.current  && !navigating) setNavigating(true)
    }, 200)
    return () => clearInterval(id)
  }, [navigating])

  const showLoader = phase !== 'ready'

  return (
    <ErrorBoundary>
      <div style={{ position:'relative', width:'100vw', height:'100vh', background:'#1a0a00', overflow:'hidden' }}>
        {showLoader && <Loader phase={phase} />}

        {/* Camera accessor for handlePick */}
        <CameraExporter />

        <Canvas
          style={{ position:'absolute', inset:0, width:'100%', height:'100%',
            cursor: showLoader ? 'default' : hoveredIdx >= 0 ? 'pointer' : topView ? 'default' : 'grab' }}
          gl={{ antialias:true, failIfMajorPerformanceCaveat:false, powerPreference:'high-performance' }}
          camera={{ position:[0, 10, 50], fov:75, near:0.1, far:50000 }}
        >
          <ambientLight intensity={1.2} />
          <directionalLight position={[500,800,300]} intensity={2.5} castShadow />
          <hemisphereLight skyColor="#ffe0a0" groundColor="#4a3000" intensity={0.8} />

          <Suspense fallback={null}>
            <Scene onLoad={handleLoad} onSceneReady={handleSceneReady} />
          </Suspense>

          {phase === 'ready' && navData && (
            <>
              <WaypointMarkers waypoints={navData.waypoints} hoveredIdx={hoveredIdx} activePathIdx={activePathIdx} />
              <WaypointPicker  waypoints={navData.waypoints} onHover={setHoveredIdx} onPick={handlePick} navActive={navActiveRef} />
              <RoadNavigator   pathRef={pathRef} navActiveRef={navActiveRef} yawRef={yawRef} />
              <PositionSaver   topViewRef={topViewRef} savedPosRef={savedPosRef} yawRef={yawRef} pitchRef={pitchRef} />
              <FreeControls    topViewRef={topViewRef} navActiveRef={navActiveRef} yawRef={yawRef} pitchRef={pitchRef} />
              <TopViewCamera   topViewRef={topViewRef} />
            </>
          )}
        </Canvas>

        {phase === 'ready' && (
          <>
            <ViewToggle topView={topView} onToggle={toggleTopView} />
            <Hint topView={topView} navigating={navigating} />
          </>
        )}
      </div>
    </ErrorBoundary>
  )
}

// ─── Exports camera ref to window so handlePick can read position ─────────────
function CameraExporter() {
  const { camera } = useThree()
  useEffect(() => { window.__threeCamera = { camera } }, [camera])
  return null
}
