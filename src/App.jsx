import { Suspense, useEffect, useRef, useState, useCallback, Component } from 'react'
import { Canvas, useThree, useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'

useGLTF.preload('/egyptian_city.glb')

// ─── Tunable constants ───────────────────────────────────────────────────────
const MODEL_ROTATION_Y   = Math.PI   // 180° flip — entrance faces +Z
const GATE_X_FRACTION    = 0.12      // slight east offset of gate (fraction of half-width)
const SPAWN_BUFFER       = -20       // negative = spawn INSIDE campus, right at the gate
const EYE_HEIGHT_FRACTION = 0.20     // fraction of building height (~1.7 m scale)
const WALK_SPEED_FRACTION = 0.35     // units/sec relative to model size
const MOUSE_SENSITIVITY  = 0.004     // drag-to-look sensitivity (no pointer lock)
// ─────────────────────────────────────────────────────────────────────────────

let g_eyeHeight = 10
let g_walkSpeed = 80
let g_spawnX    = 0
let g_spawnZ    = 0

function Scene({ onLoad }) {
  const { scene }     = useGLTF('/egyptian_city.glb')
  const { camera }    = useThree()
  const initialized   = useRef(false)

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true

    // Raw bounds before scaling
    const rawBox  = new THREE.Box3().setFromObject(scene)
    const rawSize = new THREE.Vector3()
    rawBox.getSize(rawSize)
    const rawMax  = Math.max(rawSize.x, rawSize.y, rawSize.z)

    // Scale max dimension → 500 units
    const TARGET    = 500
    const autoScale = rawMax > 0 ? TARGET / rawMax : 1
    scene.scale.set(autoScale, autoScale, autoScale)
    scene.rotation.y = MODEL_ROTATION_Y
    scene.updateMatrixWorld(true)

    // Center on XZ, ground on Y
    const box    = new THREE.Box3().setFromObject(scene)
    const center = box.getCenter(new THREE.Vector3())
    const size   = new THREE.Vector3()
    box.getSize(size)

    scene.position.set(-center.x, -box.min.y, -center.z)
    scene.updateMatrixWorld(true)
    scene.matrixAutoUpdate = false

    // Compute spawn point — right at the gate, slightly inside
    const maxDim   = Math.max(size.x, size.y, size.z)
    const eyeHeight = Math.max(size.y * EYE_HEIGHT_FRACTION, 3)
    const walkSpeed = maxDim * WALK_SPEED_FRACTION
    const spawnX    = size.x * GATE_X_FRACTION * 0.5
    const spawnZ    = size.z * 0.5 + SPAWN_BUFFER   // SPAWN_BUFFER is negative → inside campus

    g_eyeHeight = eyeHeight
    g_walkSpeed = walkSpeed
    g_spawnX    = spawnX
    g_spawnZ    = spawnZ

    camera.near = maxDim * 0.001
    camera.far  = maxDim * 50
    camera.fov  = 75
    camera.position.set(spawnX, eyeHeight, spawnZ)
    camera.rotation.set(0, 0, 0)   // facing -Z into campus
    camera.updateProjectionMatrix()

    onLoad()
  }, [scene, camera, onLoad])

  return <primitive object={scene} />
}

// ─── Controls: WASD + click-drag look, NO pointer lock, Y locked to floor ───
function FreeControls() {
  const { camera, gl } = useThree()
  const keysRef    = useRef({})
  const yawRef     = useRef(0)      // 0 = looking -Z (into campus)
  const pitchRef   = useRef(0)
  const dragRef    = useRef(false)

  useEffect(() => {
    const canvas = gl.domElement

    // ── Keyboard ──
    const onKeyDown = (e) => {
      keysRef.current[e.code] = true
      if (['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))
        e.preventDefault()
    }
    const onKeyUp = (e) => { keysRef.current[e.code] = false }

    // ── Click-drag mouse look (NO pointer lock) ──
    const onMouseDown = (e) => {
      if (e.button === 0) dragRef.current = true
    }
    const onMouseUp   = ()  => { dragRef.current = false }
    const onMouseMove = (e) => {
      if (!dragRef.current) return
      yawRef.current   -= e.movementX * MOUSE_SENSITIVITY
      pitchRef.current -= e.movementY * MOUSE_SENSITIVITY
      pitchRef.current  = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, pitchRef.current))
    }

    // Touch support
    let lastTouchX = 0, lastTouchY = 0
    const onTouchStart = (e) => {
      dragRef.current = true
      lastTouchX = e.touches[0].clientX
      lastTouchY = e.touches[0].clientY
    }
    const onTouchEnd = () => { dragRef.current = false }
    const onTouchMove = (e) => {
      if (!dragRef.current) return
      const dx = e.touches[0].clientX - lastTouchX
      const dy = e.touches[0].clientY - lastTouchY
      lastTouchX = e.touches[0].clientX
      lastTouchY = e.touches[0].clientY
      yawRef.current   -= dx * MOUSE_SENSITIVITY
      pitchRef.current -= dy * MOUSE_SENSITIVITY
      pitchRef.current  = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, pitchRef.current))
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup',   onKeyUp)
    canvas.addEventListener('mousedown',  onMouseDown)
    window.addEventListener('mouseup',    onMouseUp)
    window.addEventListener('mousemove',  onMouseMove)
    canvas.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchend',   onTouchEnd)
    window.addEventListener('touchmove',  onTouchMove,  { passive: true })

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup',   onKeyUp)
      canvas.removeEventListener('mousedown',  onMouseDown)
      window.removeEventListener('mouseup',    onMouseUp)
      window.removeEventListener('mousemove',  onMouseMove)
      canvas.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchend',   onTouchEnd)
      window.removeEventListener('touchmove',  onTouchMove)
    }
  }, [gl])

  const moveDir = useRef(new THREE.Vector3())
  const euler   = useRef(new THREE.Euler(0, 0, 0, 'YXZ'))

  useFrame((_, delta) => {
    // Apply look
    euler.current.set(pitchRef.current, yawRef.current, 0, 'YXZ')
    camera.quaternion.setFromEuler(euler.current)

    // WASD movement (horizontal only)
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

    // ── Bottom lock only: never go below eye height (floor) ──
    if (camera.position.y < g_eyeHeight) camera.position.y = g_eyeHeight
  })

  return null
}

// ─── Error boundary ──────────────────────────────────────────────────────────
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

// ─── Loader ──────────────────────────────────────────────────────────────────
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

// ─── Controls hint ───────────────────────────────────────────────────────────
function Hint({ visible }) {
  if (!visible) return null
  return (
    <div style={{
      position:'absolute', bottom:24, left:'50%', transform:'translateX(-50%)',
      background:'rgba(0,0,0,0.55)', color:'#ffcc88', fontFamily:'sans-serif',
      fontSize:13, padding:'8px 18px', borderRadius:8, pointerEvents:'none',
      border:'1px solid rgba(255,200,100,0.2)', whiteSpace:'nowrap',
    }}>
      🖱 Drag to look &nbsp;·&nbsp; WASD to walk
    </div>
  )
}

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [loaded, setLoaded] = useState(false)
  const handleLoad = useCallback(() => setLoaded(true), [])

  return (
    <ErrorBoundary>
      <div style={{ position:'relative', width:'100vw', height:'100vh', background:'#1a0a00' }}>
        {!loaded && <Loader />}

        <Canvas
          style={{ width:'100%', height:'100%', cursor: loaded ? 'grab' : 'default' }}
          gl={{ antialias:true, failIfMajorPerformanceCaveat:false, powerPreference:'high-performance' }}
          camera={{ position:[0, 10, 50], fov:75, near:0.1, far:50000 }}
        >
          <ambientLight intensity={1.2} />
          <directionalLight position={[500,800,300]} intensity={2.5} castShadow />
          <hemisphereLight skyColor="#ffe0a0" groundColor="#4a3000" intensity={0.8} />

          <Suspense fallback={null}>
            <Scene onLoad={handleLoad} />
          </Suspense>

          {loaded && <FreeControls />}
        </Canvas>

        <Hint visible={loaded} />
      </div>
    </ErrorBoundary>
  )
}
