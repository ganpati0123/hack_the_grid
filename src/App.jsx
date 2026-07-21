import { Suspense, useEffect, useRef, useState, useCallback, Component } from 'react'
import { Canvas, useThree, useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'

useGLTF.preload('/egyptian_city.glb')

// ─── Constants ────────────────────────────────────────────────────────────────
const MODEL_ROTATION_Y    = Math.PI
const GATE_X_FRACTION     = 0.12
const SPAWN_BUFFER        = -20
const EYE_HEIGHT_FRACTION = 0.20
const WALK_SPEED_FRACTION = 0.35
const MOUSE_SENSITIVITY   = 0.004
const SCROLL_ZOOM_SPEED   = 0.4
const WAYPOINT_GRID       = 28          // NxN grid for road detection
const ROAD_Y_THRESHOLD    = 0.12        // hit y < this fraction of model height = ground/road
const FLY_SPEED           = 0.06        // lerp factor for fly-to
// ─────────────────────────────────────────────────────────────────────────────

let g_eyeHeight = 10
let g_walkSpeed = 80
let g_bounds    = null
let g_sceneRef  = null   // THREE.Object3D — for raycasting after load

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

    const finalBox  = new THREE.Box3().setFromObject(scene)
    g_bounds        = finalBox.clone()
    g_sceneRef      = scene

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
    camera.rotation.set(0, 0, 0)   // face into city
    camera.updateProjectionMatrix()

    onSceneReady(scene, finalBox, size)
    onLoad()
  }, [scene, camera, onLoad, onSceneReady])

  return <primitive object={scene} />
}

// ─── Road waypoint detection (runs once after scene load) ────────────────────
function detectWaypoints(scene, bounds, modelSize) {
  const raycaster   = new THREE.Raycaster()
  const downDir     = new THREE.Vector3(0, -1, 0)
  const roadYLimit  = modelSize.y * ROAD_Y_THRESHOLD
  const waypoints   = []

  const xMin = bounds.min.x, xMax = bounds.max.x
  const zMin = bounds.min.z, zMax = bounds.max.z
  const castY = bounds.max.y + 10

  for (let i = 0; i < WAYPOINT_GRID; i++) {
    for (let j = 0; j < WAYPOINT_GRID; j++) {
      const x = xMin + (xMax - xMin) * (i + 0.5) / WAYPOINT_GRID
      const z = zMin + (zMax - zMin) * (j + 0.5) / WAYPOINT_GRID

      raycaster.set(new THREE.Vector3(x, castY, z), downDir)
      const hits = raycaster.intersectObject(scene, true)

      if (hits.length > 0) {
        const hit = hits[0]
        // Only keep hits near ground level = road / path
        if (hit.point.y <= roadYLimit) {
          waypoints.push(new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z))
        }
      }
    }
  }

  return waypoints
}

// ─── Waypoint markers rendered in 3D ─────────────────────────────────────────
function WaypointMarkers({ waypoints, hoveredIdx, flyTarget }) {
  if (!waypoints.length) return null

  return (
    <group>
      {waypoints.map((wp, i) => {
        const isHovered = i === hoveredIdx
        const isFly     = flyTarget && flyTarget.index === i
        const r         = isHovered ? 3.5 : 2.2
        const color     = isFly ? '#ffff00' : isHovered ? '#ffffff' : '#ffcc44'
        const opacity   = isHovered ? 0.95 : 0.55

        return (
          <group key={i} position={[wp.x, wp.y + 0.5, wp.z]}>
            {/* Outer ring */}
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[r * 0.65, r, 32]} />
              <meshBasicMaterial color={color} transparent opacity={opacity} depthTest={false} />
            </mesh>
            {/* Center dot */}
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <circleGeometry args={[r * 0.25, 16]} />
              <meshBasicMaterial color={color} transparent opacity={opacity + 0.2} depthTest={false} />
            </mesh>
          </group>
        )
      })}
    </group>
  )
}

// ─── Waypoint hover + click detection ────────────────────────────────────────
function WaypointInteractor({ waypoints, onHover, onClick, topViewRef }) {
  const { camera, gl, size } = useThree()
  const raycaster = useRef(new THREE.Raycaster())
  const mouse     = useRef(new THREE.Vector2())

  useEffect(() => {
    if (!waypoints.length) return
    const canvas = gl.domElement

    const toNDC = (clientX, clientY) => {
      const rect = canvas.getBoundingClientRect()
      mouse.current.x =  ((clientX - rect.left) / rect.width)  * 2 - 1
      mouse.current.y = -((clientY - rect.top)  / rect.height) * 2 + 1
    }

    const findNearest = () => {
      raycaster.current.setFromCamera(mouse.current, camera)
      const ray = raycaster.current.ray
      let best = -1, bestDist = Infinity
      const PICK_RADIUS = Math.max(g_eyeHeight * 2.5, 15)

      waypoints.forEach((wp, i) => {
        const d = ray.distanceToPoint(wp)
        const cam2wp = wp.distanceTo(camera.position)
        if (d < PICK_RADIUS && cam2wp < bestDist) {
          bestDist = cam2wp
          best = i
        }
      })
      return best
    }

    const onMouseMove = (e) => {
      toNDC(e.clientX, e.clientY)
      onHover(findNearest())
    }

    const onMouseClick = (e) => {
      if (topViewRef.current) return
      toNDC(e.clientX, e.clientY)
      const idx = findNearest()
      if (idx >= 0) onClick(idx)
    }

    canvas.addEventListener('mousemove', onMouseMove)
    canvas.addEventListener('click', onMouseClick)
    return () => {
      canvas.removeEventListener('mousemove', onMouseMove)
      canvas.removeEventListener('click', onMouseClick)
    }
  }, [waypoints, camera, gl, onHover, onClick, topViewRef, size])

  return null
}

// ─── Fly-to animator ──────────────────────────────────────────────────────────
function FlyToAnimator({ flyTarget, onArrived }) {
  const { camera } = useThree()

  useFrame(() => {
    if (!flyTarget) return
    const dest = flyTarget.position
    const dx = dest.x - camera.position.x
    const dz = dest.z - camera.position.z
    camera.position.x += dx * FLY_SPEED
    camera.position.z += dz * FLY_SPEED
    camera.position.y = g_eyeHeight

    // Auto-look toward destination while flying
    const dist = Math.sqrt(dx * dx + dz * dz)
    if (dist > 1) {
      const targetYaw = Math.atan2(dx, dz) + Math.PI
      // signal yaw change via callback
      onArrived(null, targetYaw)   // update yaw live
    }

    if (Math.abs(dx) < 1 && Math.abs(dz) < 1) {
      onArrived(null, null)   // arrived — clear target but keep yaw
    }
  })

  return null
}

// ─── Street-view controls ─────────────────────────────────────────────────────
function FreeControls({ topViewRef, yawRef, pitchRef, flyActiveRef }) {
  const { camera, gl } = useThree()
  const keysRef   = useRef({})
  const dragRef   = useRef(false)
  const zoomDelta = useRef(0)

  useEffect(() => {
    const canvas = gl.domElement

    const onKeyDown = (e) => {
      keysRef.current[e.code] = true
      if (['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))
        e.preventDefault()
    }
    const onKeyUp   = (e) => { keysRef.current[e.code] = false }

    const onWheel = (e) => { e.preventDefault(); zoomDelta.current += e.deltaY }

    const onMouseDown = (e) => { if (e.button === 0) { dragRef.current = true; flyActiveRef.current = false } }
    const onMouseUp   = ()  => { dragRef.current = false }
    const onMouseMove = (e) => {
      if (!dragRef.current || topViewRef.current) return
      yawRef.current   -= e.movementX * MOUSE_SENSITIVITY
      pitchRef.current -= e.movementY * MOUSE_SENSITIVITY
      pitchRef.current  = Math.max(-Math.PI / 2.5, Math.min(Math.PI / 2.5, pitchRef.current))
    }

    let lx = 0, ly = 0
    const onTouchStart = (e) => { dragRef.current = true; flyActiveRef.current = false; lx = e.touches[0].clientX; ly = e.touches[0].clientY }
    const onTouchEnd   = ()  => { dragRef.current = false }
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
  }, [gl, topViewRef, yawRef, pitchRef, flyActiveRef])

  const moveDir = useRef(new THREE.Vector3())
  const euler   = useRef(new THREE.Euler(0, 0, 0, 'YXZ'))
  const fwd     = useRef(new THREE.Vector3())

  useFrame((_, delta) => {
    if (topViewRef.current) return

    euler.current.set(pitchRef.current, yawRef.current, 0, 'YXZ')
    camera.quaternion.setFromEuler(euler.current)

    if (zoomDelta.current !== 0) {
      fwd.current.set(0, 0, -1).applyEuler(new THREE.Euler(0, yawRef.current, 0))
      camera.position.addScaledVector(fwd.current, -zoomDelta.current * SCROLL_ZOOM_SPEED)
      zoomDelta.current = 0
    }

    const k   = keysRef.current
    const dir = moveDir.current.set(0, 0, 0)
    if (k['KeyW'] || k['ArrowUp'])    dir.z -= 1
    if (k['KeyS'] || k['ArrowDown'])  dir.z += 1
    if (k['KeyA'] || k['ArrowLeft'])  dir.x -= 1
    if (k['KeyD'] || k['ArrowRight']) dir.x += 1

    if (dir.lengthSq() > 0) {
      flyActiveRef.current = false
      dir.normalize()
      dir.applyEuler(new THREE.Euler(0, yawRef.current, 0))
      camera.position.addScaledVector(dir, g_walkSpeed * delta)
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
  const tgt = useRef(new THREE.Vector3())
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

// ─── Position saver + restorer ────────────────────────────────────────────────
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
  return (
    <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column',
      alignItems:'center', justifyContent:'center',
      color:'#ffcc88', fontFamily:'sans-serif', background:'#1a0a00',
      gap:16, pointerEvents:'none', zIndex:10 }}>
      <div style={{ width:48, height:48, border:'4px solid #4a2800',
        borderTop:'4px solid #ffcc88', borderRadius:'50%', animation:'spin 1s linear infinite' }}/>
      <div style={{fontSize:16}}>
        {phase === 'waypoints' ? 'Scanning roads…' : 'Loading Egyptian City…'}
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}

// ─── Hint ─────────────────────────────────────────────────────────────────────
function Hint({ topView }) {
  return (
    <div style={{ position:'absolute', bottom:24, left:'50%', transform:'translateX(-50%)',
      background:'rgba(0,0,0,0.55)', color:'#ffcc88', fontFamily:'sans-serif',
      fontSize:13, padding:'8px 18px', borderRadius:8, pointerEvents:'none',
      border:'1px solid rgba(255,200,100,0.2)', whiteSpace:'nowrap' }}>
      {topView
        ? '🗺 Top View — click Street View to walk'
        : '🖱 Drag to look · WASD / click waypoint 🔶 to move · Scroll to zoom'}
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
  const [phase, setPhase]       = useState('loading')   // loading | waypoints | ready
  const [topView, setTopView]   = useState(false)
  const [waypoints, setWaypoints] = useState([])
  const [hoveredIdx, setHoveredIdx] = useState(-1)
  const [flyTarget, setFlyTarget]   = useState(null)    // { index, position }

  const topViewRef   = useRef(false)
  const yawRef       = useRef(0)
  const pitchRef     = useRef(0)
  const savedPosRef  = useRef(new THREE.Vector3())
  const flyActiveRef = useRef(false)

  const handleLoad = useCallback(() => setPhase('waypoints'), [])

  const handleSceneReady = useCallback((scene, bounds, modelSize) => {
    // Detect waypoints in a setTimeout so the render can paint "Scanning roads…" first
    setTimeout(() => {
      const pts = detectWaypoints(scene, bounds, modelSize)
      setWaypoints(pts)
      setPhase('ready')
    }, 50)
  }, [])

  const toggleTopView = useCallback(() => {
    setTopView(v => { topViewRef.current = !v; return !v })
  }, [])

  const handleWaypointClick = useCallback((idx) => {
    if (idx < 0 || !waypoints[idx]) return
    flyActiveRef.current = true
    setFlyTarget({ index: idx, position: waypoints[idx] })
  }, [waypoints])

  // FlyToAnimator callback: update yaw live while flying, clear on arrival
  const handleFlyUpdate = useCallback((_, newYaw) => {
    if (newYaw !== null) yawRef.current = newYaw
    else { flyActiveRef.current = false; setFlyTarget(null) }
  }, [])

  const showLoader = phase !== 'ready'

  return (
    <ErrorBoundary>
      <div style={{ position:'relative', width:'100vw', height:'100vh', background:'#1a0a00', overflow:'hidden' }}>
        {showLoader && <Loader phase={phase} />}

        <Canvas
          style={{ position:'absolute', inset:0, width:'100%', height:'100%',
            cursor: showLoader ? 'default' : (hoveredIdx >= 0 ? 'pointer' : topView ? 'default' : 'grab') }}
          gl={{ antialias:true, failIfMajorPerformanceCaveat:false, powerPreference:'high-performance' }}
          camera={{ position:[0, 10, 50], fov:75, near:0.1, far:50000 }}
        >
          <ambientLight intensity={1.2} />
          <directionalLight position={[500,800,300]} intensity={2.5} castShadow />
          <hemisphereLight skyColor="#ffe0a0" groundColor="#4a3000" intensity={0.8} />

          <Suspense fallback={null}>
            <Scene onLoad={handleLoad} onSceneReady={handleSceneReady} />
          </Suspense>

          {phase === 'ready' && (
            <>
              <WaypointMarkers waypoints={waypoints} hoveredIdx={hoveredIdx} flyTarget={flyTarget} />
              <WaypointInteractor
                waypoints={waypoints}
                onHover={setHoveredIdx}
                onClick={handleWaypointClick}
                topViewRef={topViewRef}
              />
              <FlyToAnimator flyTarget={flyActiveRef.current ? flyTarget : null} onArrived={handleFlyUpdate} />
              <PositionSaver topViewRef={topViewRef} savedPosRef={savedPosRef} yawRef={yawRef} pitchRef={pitchRef} />
              <FreeControls  topViewRef={topViewRef} yawRef={yawRef} pitchRef={pitchRef} flyActiveRef={flyActiveRef} />
              <TopViewCamera topViewRef={topViewRef} />
            </>
          )}
        </Canvas>

        {phase === 'ready' && (
          <>
            <ViewToggle topView={topView} onToggle={toggleTopView} />
            <Hint topView={topView} />
          </>
        )}
      </div>
    </ErrorBoundary>
  )
}
