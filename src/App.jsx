import { Suspense, useEffect, useRef, useState, useCallback, Component } from 'react'
import { Canvas, useThree, useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'

useGLTF.preload('/egyptian_city.glb')

// ─── Tunable constants ───────────────────────────────────────────────────────
const MODEL_ROTATION_Y    = Math.PI
const GATE_X_FRACTION     = 0.12
const SPAWN_BUFFER        = -20
const EYE_HEIGHT_FRACTION = 0.20
const WALK_SPEED_FRACTION = 0.35
const MOUSE_SENSITIVITY   = 0.004
const SCROLL_ZOOM_SPEED   = 0.4
const INITIAL_YAW         = -90 * (Math.PI / 180)   // 90° left from entrance
// ─────────────────────────────────────────────────────────────────────────────

let g_eyeHeight = 10
let g_walkSpeed = 80
let g_bounds    = null   // THREE.Box3 after final repositioning

// ─── Scene: load + scale + center GLB ────────────────────────────────────────
function Scene({ onLoad }) {
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

    // Final bounds after repositioning (Y base = 0)
    const finalBox = new THREE.Box3().setFromObject(scene)
    g_bounds = finalBox.clone()

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
    // Apply initial yaw so camera faces left from the start
    const initEuler = new THREE.Euler(0, INITIAL_YAW, 0, 'YXZ')
    camera.quaternion.setFromEuler(initEuler)
    camera.updateProjectionMatrix()

    onLoad()
  }, [scene, camera, onLoad])

  return <primitive object={scene} />
}

// ─── Street-view controls (WASD + scroll-zoom + drag-look) ───────────────────
// topViewRef.current = true  → controls are suspended (top-view is active)
function FreeControls({ topViewRef, yawRef, pitchRef }) {
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

    const onWheel = (e) => {
      e.preventDefault()
      zoomDelta.current += e.deltaY
    }

    const onMouseDown = (e) => { if (e.button === 0) dragRef.current = true }
    const onMouseUp   = ()  => { dragRef.current = false }
    const onMouseMove = (e) => {
      if (!dragRef.current || topViewRef.current) return
      yawRef.current   -= e.movementX * MOUSE_SENSITIVITY
      pitchRef.current -= e.movementY * MOUSE_SENSITIVITY
      pitchRef.current  = Math.max(-Math.PI / 2.5, Math.min(Math.PI / 2.5, pitchRef.current))
    }

    let lastTouchX = 0, lastTouchY = 0
    const onTouchStart = (e) => {
      dragRef.current = true
      lastTouchX = e.touches[0].clientX
      lastTouchY = e.touches[0].clientY
    }
    const onTouchEnd  = () => { dragRef.current = false }
    const onTouchMove = (e) => {
      if (!dragRef.current || topViewRef.current) return
      const dx = e.touches[0].clientX - lastTouchX
      const dy = e.touches[0].clientY - lastTouchY
      lastTouchX = e.touches[0].clientX
      lastTouchY = e.touches[0].clientY
      yawRef.current   -= dx * MOUSE_SENSITIVITY
      pitchRef.current -= dy * MOUSE_SENSITIVITY
      pitchRef.current  = Math.max(-Math.PI / 2.5, Math.min(Math.PI / 2.5, pitchRef.current))
    }

    window.addEventListener('keydown',    onKeyDown)
    window.addEventListener('keyup',      onKeyUp)
    canvas.addEventListener('wheel',      onWheel,      { passive: false })
    canvas.addEventListener('mousedown',  onMouseDown)
    window.addEventListener('mouseup',    onMouseUp)
    window.addEventListener('mousemove',  onMouseMove)
    canvas.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchend',   onTouchEnd)
    window.addEventListener('touchmove',  onTouchMove,  { passive: true })

    return () => {
      window.removeEventListener('keydown',    onKeyDown)
      window.removeEventListener('keyup',      onKeyUp)
      canvas.removeEventListener('wheel',      onWheel)
      canvas.removeEventListener('mousedown',  onMouseDown)
      window.removeEventListener('mouseup',    onMouseUp)
      window.removeEventListener('mousemove',  onMouseMove)
      canvas.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchend',   onTouchEnd)
      window.removeEventListener('touchmove',  onTouchMove)
    }
  }, [gl, topViewRef, yawRef, pitchRef])

  const moveDir = useRef(new THREE.Vector3())
  const euler   = useRef(new THREE.Euler(0, 0, 0, 'YXZ'))
  const fwd     = useRef(new THREE.Vector3())

  useFrame((_, delta) => {
    // Top-view active — do nothing
    if (topViewRef.current) return

    // Apply look
    euler.current.set(pitchRef.current, yawRef.current, 0, 'YXZ')
    camera.quaternion.setFromEuler(euler.current)

    // Scroll zoom (horizontal forward only)
    if (zoomDelta.current !== 0) {
      fwd.current.set(0, 0, -1).applyEuler(new THREE.Euler(0, yawRef.current, 0))
      camera.position.addScaledVector(fwd.current, -zoomDelta.current * SCROLL_ZOOM_SPEED)
      zoomDelta.current = 0
    }

    // WASD
    const k   = keysRef.current
    const dir = moveDir.current.set(0, 0, 0)
    if (k['KeyW'] || k['ArrowUp'])    dir.z -= 1
    if (k['KeyS'] || k['ArrowDown'])  dir.z += 1
    if (k['KeyA'] || k['ArrowLeft'])  dir.x -= 1
    if (k['KeyD'] || k['ArrowRight']) dir.x += 1

    if (dir.lengthSq() > 0) {
      dir.normalize()
      dir.applyEuler(new THREE.Euler(0, yawRef.current, 0))
      camera.position.addScaledVector(dir, g_walkSpeed * delta)
    }

    // ── Strict floor lock: always pin Y to eye height in street view ──
    camera.position.y = g_eyeHeight

    // ── XZ boundary: camera stays inside GLB footprint ──
    if (g_bounds) {
      const pad = g_eyeHeight * 0.5
      camera.position.x = Math.max(g_bounds.min.x + pad, Math.min(g_bounds.max.x - pad, camera.position.x))
      camera.position.z = Math.max(g_bounds.min.z + pad, Math.min(g_bounds.max.z - pad, camera.position.z))
    }
  })

  return null
}

// ─── Top-view camera animator ─────────────────────────────────────────────────
function TopViewCamera({ topViewRef }) {
  const { camera } = useThree()
  const targetPos  = useRef(new THREE.Vector3())
  const targetQ    = useRef(new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0, 'YXZ')))

  useFrame(() => {
    if (!topViewRef.current || !g_bounds) return

    const cx = (g_bounds.min.x + g_bounds.max.x) / 2
    const cz = (g_bounds.min.z + g_bounds.max.z) / 2
    const span = Math.max(g_bounds.max.x - g_bounds.min.x, g_bounds.max.z - g_bounds.min.z)
    const h  = g_bounds.max.y + span * 0.8
    targetPos.current.set(cx, h, cz)

    camera.position.lerp(targetPos.current, 0.08)
    camera.quaternion.slerp(targetQ.current, 0.08)
  })

  return null
}

// ─── Error boundary ───────────────────────────────────────────────────────────
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(e) { return { error: e } }
  render() {
    if (this.state.error) return (
      <div style={{
        position:'absolute', inset:0, display:'flex', flexDirection:'column',
        alignItems:'center', justifyContent:'center',
        color:'#ffcc88', fontFamily:'sans-serif', background:'#1a0a00', gap:12,
      }}>
        <div style={{fontSize:36}}>⚠️</div>
        <div style={{fontSize:18}}>3D viewer failed to load</div>
        <div style={{fontSize:13, opacity:0.6, maxWidth:400, textAlign:'center'}}>
          {this.state.error.message}
        </div>
      </div>
    )
    return this.props.children
  }
}

// ─── Loader ───────────────────────────────────────────────────────────────────
function Loader() {
  return (
    <div style={{
      position:'absolute', inset:0, display:'flex', flexDirection:'column',
      alignItems:'center', justifyContent:'center',
      color:'#ffcc88', fontFamily:'sans-serif', background:'#1a0a00',
      gap:16, pointerEvents:'none', zIndex:10,
    }}>
      <div style={{
        width:48, height:48, border:'4px solid #4a2800',
        borderTop:'4px solid #ffcc88', borderRadius:'50%',
        animation:'spin 1s linear infinite',
      }}/>
      <div style={{fontSize:16}}>Loading Egyptian City…</div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}

// ─── Hint bar ─────────────────────────────────────────────────────────────────
function Hint({ visible, topView }) {
  if (!visible) return null
  return (
    <div style={{
      position:'absolute', bottom:24, left:'50%', transform:'translateX(-50%)',
      background:'rgba(0,0,0,0.55)', color:'#ffcc88', fontFamily:'sans-serif',
      fontSize:13, padding:'8px 18px', borderRadius:8, pointerEvents:'none',
      border:'1px solid rgba(255,200,100,0.2)', whiteSpace:'nowrap',
    }}>
      {topView
        ? '🗺 Top View — click Street View to walk'
        : '🖱 Drag to look · WASD to walk · Scroll to zoom'}
    </div>
  )
}

// ─── View toggle button ───────────────────────────────────────────────────────
function ViewToggle({ visible, topView, onToggle }) {
  if (!visible) return null
  return (
    <button
      onClick={onToggle}
      style={{
        position:'absolute', top:20, right:20,
        background: topView ? 'rgba(255,200,100,0.9)' : 'rgba(0,0,0,0.65)',
        color: topView ? '#1a0a00' : '#ffcc88',
        border:'1px solid rgba(255,200,100,0.5)',
        borderRadius:8, padding:'8px 16px',
        fontFamily:'sans-serif', fontSize:13, fontWeight:600,
        cursor:'pointer', zIndex:20,
        backdropFilter:'blur(4px)',
        transition:'all 0.2s',
      }}
    >
      {topView ? '🚶 Street View' : '🗺 Top View'}
    </button>
  )
}

// ─── CameraRestorer: runs inside Canvas, listens for street-view restore ──────
// When topViewRef flips false, snaps camera back to saved XZ + eye height.
function CameraRestorer({ topViewRef, savedPosRef, yawRef, pitchRef }) {
  const { camera } = useThree()
  const wasTopView = useRef(false)

  useFrame(() => {
    const isTop = topViewRef.current

    if (wasTopView.current && !isTop) {
      // Just switched back to street view — restore position
      camera.position.set(
        savedPosRef.current.x,
        g_eyeHeight,
        savedPosRef.current.z,
      )
      // Restore look direction
      const euler = new THREE.Euler(pitchRef.current, yawRef.current, 0, 'YXZ')
      camera.quaternion.setFromEuler(euler)
    }

    wasTopView.current = isTop
  })

  return null
}

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [loaded, setLoaded]   = useState(false)
  const [topView, setTopView] = useState(false)

  // Shared refs — live inside Canvas components
  const topViewRef  = useRef(false)
  const yawRef      = useRef(INITIAL_YAW)
  const pitchRef    = useRef(0)
  const savedPosRef = useRef(new THREE.Vector3())   // XZ saved before entering top view

  const handleLoad = useCallback(() => setLoaded(true), [])

  const toggleTopView = useCallback(() => {
    setTopView(prev => {
      const entering = !prev
      topViewRef.current = entering

      if (entering) {
        // Save current XZ so we can restore on return
        // (camera ref not accessible here — CameraRestorer will read it at frame time,
        //  but we update savedPosRef in a Canvas-side effect via the ref trick below)
      }
      return entering
    })
  }, [])

  return (
    <ErrorBoundary>
      <div style={{ position:'relative', width:'100vw', height:'100vh', background:'#1a0a00', overflow:'hidden' }}>
        {!loaded && <Loader />}

        <Canvas
          style={{ position:'absolute', inset:0, width:'100%', height:'100%',
            cursor: loaded ? (topView ? 'default' : 'grab') : 'default' }}
          gl={{ antialias:true, failIfMajorPerformanceCaveat:false, powerPreference:'high-performance' }}
          camera={{ position:[0, 10, 50], fov:75, near:0.1, far:50000 }}
        >
          <ambientLight intensity={1.2} />
          <directionalLight position={[500,800,300]} intensity={2.5} castShadow />
          <hemisphereLight skyColor="#ffe0a0" groundColor="#4a3000" intensity={0.8} />

          <Suspense fallback={null}>
            <Scene onLoad={handleLoad} />
          </Suspense>

          {loaded && (
            <>
              {/* Saves XZ position every frame while in street view */}
              <PositionSaver topViewRef={topViewRef} savedPosRef={savedPosRef} />
              <FreeControls  topViewRef={topViewRef} yawRef={yawRef} pitchRef={pitchRef} />
              <TopViewCamera topViewRef={topViewRef} />
              <CameraRestorer
                topViewRef={topViewRef}
                savedPosRef={savedPosRef}
                yawRef={yawRef}
                pitchRef={pitchRef}
              />
            </>
          )}
        </Canvas>

        <ViewToggle visible={loaded} topView={topView} onToggle={toggleTopView} />
        <Hint       visible={loaded} topView={topView} />
      </div>
    </ErrorBoundary>
  )
}

// ─── Continuously saves last street-view XZ position ─────────────────────────
function PositionSaver({ topViewRef, savedPosRef }) {
  const { camera } = useThree()

  useFrame(() => {
    if (!topViewRef.current) {
      savedPosRef.current.set(camera.position.x, 0, camera.position.z)
    }
  })

  return null
}
