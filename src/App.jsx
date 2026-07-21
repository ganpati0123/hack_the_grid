import { Suspense, useEffect, useRef, useState, useCallback, Component } from 'react'
import { Canvas, useThree, useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'

useGLTF.preload('/egyptian_city.glb')

// ─── Tunable constants ──────────────────────────────────────────────────────
// Rotate model so the previously back-facing entrance (upper-right in the
// isometric screenshot) becomes the front-facing +Z side.
// Math.PI = 180° flip from original model orientation.
const MODEL_ROTATION_Y = Math.PI

// The gate sits slightly east (+X) of center on the north edge.
// Fraction of model half-width (positive = east). 0 = dead centre.
const GATE_X_FRACTION = 0.12

// Spawn the player this many units *outside* the north boundary.
const SPAWN_BUFFER = 8

// Eye height as a fraction of building height (size.y).
// 0.20 ≈ 1.7 m for typical 8-10 m buildings at this scale.
const EYE_HEIGHT_FRACTION = 0.20

// Ground walking speed (units / second). Scaled to model size.
const WALK_SPEED_FRACTION = 0.35

// Mouse-look sensitivity
const MOUSE_SENSITIVITY = 0.002
// ────────────────────────────────────────────────────────────────────────────

// Passed from Scene up to App so FirstPersonControls gets consistent values.
let g_eyeHeight = 10
let g_walkSpeed = 80
let g_spawnX = 0
let g_spawnZ = 0

function Scene({ onLoad }) {
  const { scene } = useGLTF('/egyptian_city.glb')
  const { camera } = useThree()
  const initialized = useRef(false)

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true

    // 1. Raw bounding box (pre-scale)
    const rawBox = new THREE.Box3().setFromObject(scene)
    const rawSize = new THREE.Vector3()
    rawBox.getSize(rawSize)
    const rawMax = Math.max(rawSize.x, rawSize.y, rawSize.z)

    // 2. Uniform scale so the longest axis = 500 units
    const TARGET = 500
    const autoScale = rawMax > 0 ? TARGET / rawMax : 1
    scene.scale.set(autoScale, autoScale, autoScale)

    // Rotate the whole world so the entrance faces +Z (toward the player spawn)
    scene.rotation.y = MODEL_ROTATION_Y
    scene.updateMatrixWorld(true)

    // 3. Center on XZ, ground on Y
    const box = new THREE.Box3().setFromObject(scene)
    const center = box.getCenter(new THREE.Vector3())
    const size = new THREE.Vector3()
    box.getSize(size)

    scene.position.set(-center.x, -box.min.y, -center.z)
    scene.updateMatrixWorld(true)
    scene.matrixAutoUpdate = false

    // 4. Compute spawn & camera settings
    const maxDim = Math.max(size.x, size.y, size.z)
    const eyeHeight = Math.max(size.y * EYE_HEIGHT_FRACTION, 3)
    const walkSpeed = maxDim * WALK_SPEED_FRACTION
    const spawnX = size.x * GATE_X_FRACTION * 0.5  // fraction of half-width
    const spawnZ = size.z * 0.5 + SPAWN_BUFFER      // just outside north (+Z) boundary

    g_eyeHeight = eyeHeight
    g_walkSpeed = walkSpeed
    g_spawnX = spawnX
    g_spawnZ = spawnZ

    camera.near = maxDim * 0.001
    camera.far = maxDim * 50
    camera.fov = 75
    camera.position.set(spawnX, eyeHeight, spawnZ)
    camera.rotation.set(0, 0, 0) // yaw=0 → looking toward -Z (into campus)
    camera.updateProjectionMatrix()

    onLoad()
  }, [scene, camera, onLoad])

  return <primitive object={scene} />
}

// ─── First-person WASD + pointer-lock mouse-look ────────────────────────────
function FirstPersonControls() {
  const { camera, gl } = useThree()
  const keysRef    = useRef({})
  const yawRef     = useRef(0)       // 0 = looking toward -Z (into campus)
  const pitchRef   = useRef(0)
  const lockedRef  = useRef(false)

  useEffect(() => {
    const canvas = gl.domElement

    const onKeyDown = (e) => {
      keysRef.current[e.code] = true
      if (['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))
        e.preventDefault()
    }
    const onKeyUp = (e) => { keysRef.current[e.code] = false }

    const onMouseMove = (e) => {
      if (!lockedRef.current) return
      yawRef.current   -= e.movementX * MOUSE_SENSITIVITY
      pitchRef.current -= e.movementY * MOUSE_SENSITIVITY
      pitchRef.current  = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, pitchRef.current))
    }

    const onClick = () => canvas.requestPointerLock()

    const onLockChange = () => {
      lockedRef.current = document.pointerLockElement === canvas
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup',   onKeyUp)
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('pointerlockchange', onLockChange)
    canvas.addEventListener('click', onClick)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup',   onKeyUp)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('pointerlockchange', onLockChange)
      canvas.removeEventListener('click', onClick)
    }
  }, [gl])

  const moveDir = useRef(new THREE.Vector3())
  const euler   = useRef(new THREE.Euler(0, 0, 0, 'YXZ'))

  useFrame((_, delta) => {
    // Apply look rotation from yaw + pitch
    euler.current.set(pitchRef.current, yawRef.current, 0, 'YXZ')
    camera.quaternion.setFromEuler(euler.current)

    // WASD movement
    const k = keysRef.current
    const dir = moveDir.current.set(0, 0, 0)
    if (k['KeyW'] || k['ArrowUp'])    dir.z -= 1
    if (k['KeyS'] || k['ArrowDown'])  dir.z += 1
    if (k['KeyA'] || k['ArrowLeft'])  dir.x -= 1
    if (k['KeyD'] || k['ArrowRight']) dir.x += 1

    if (dir.lengthSq() > 0) {
      dir.normalize()
      // Apply only horizontal yaw so player doesn't fly up ramps
      dir.applyEuler(new THREE.Euler(0, yawRef.current, 0))
      camera.position.addScaledVector(dir, g_walkSpeed * delta)
    }

    // Lock Y to eye height — no flying
    camera.position.y = g_eyeHeight
  })

  return null
}

// ─── Error boundary ─────────────────────────────────────────────────────────
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

// ─── Loading spinner ─────────────────────────────────────────────────────────
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

// ─── Click-to-explore hint ───────────────────────────────────────────────────
function Hint({ visible }) {
  if (!visible) return null
  return (
    <div style={{
      position:'absolute', bottom:32, left:'50%', transform:'translateX(-50%)',
      background:'rgba(0,0,0,0.55)', color:'#ffcc88', fontFamily:'sans-serif',
      fontSize:14, padding:'10px 20px', borderRadius:8, pointerEvents:'none',
      border:'1px solid rgba(255,200,100,0.25)', letterSpacing:'0.03em',
    }}>
      🖱 Click to explore &nbsp;·&nbsp; WASD to walk &nbsp;·&nbsp; Esc to release mouse
    </div>
  )
}

// ─── Root ────────────────────────────────────────────────────────────────────
export default function App() {
  const [loaded,  setLoaded]  = useState(false)
  const [locked,  setLocked]  = useState(false)

  const handleLoad = useCallback(() => setLoaded(true), [])

  // Track pointer-lock state for hint visibility
  useEffect(() => {
    const onChange = () => setLocked(!!document.pointerLockElement)
    document.addEventListener('pointerlockchange', onChange)
    return () => document.removeEventListener('pointerlockchange', onChange)
  }, [])

  return (
    <ErrorBoundary>
      <div style={{ position:'relative', width:'100vw', height:'100vh', background:'#1a0a00' }}>
        {!loaded && <Loader />}

        <Canvas
          style={{ width:'100%', height:'100%' }}
          gl={{ antialias:true, failIfMajorPerformanceCaveat:false, powerPreference:'high-performance' }}
          camera={{ position:[0, 10, 50], fov:75, near:0.1, far:50000 }}
        >
          <ambientLight intensity={1.2} />
          <directionalLight position={[500,800,300]} intensity={2.5} castShadow />
          <hemisphereLight skyColor="#ffe0a0" groundColor="#4a3000" intensity={0.8} />

          <Suspense fallback={null}>
            <Scene onLoad={handleLoad} />
          </Suspense>

          {loaded && <FirstPersonControls />}
        </Canvas>

        <Hint visible={loaded && !locked} />
      </div>
    </ErrorBoundary>
  )
}
