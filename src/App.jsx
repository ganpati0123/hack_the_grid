import { Suspense, useEffect, useRef, useState, useCallback, Component } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls, useGLTF } from '@react-three/drei'
import * as THREE from 'three'

useGLTF.preload('/egyptian_city.glb')

function Scene({ onLoad }) {
  const { scene } = useGLTF('/egyptian_city.glb')
  const { camera, controls } = useThree()
  const initialized = useRef(false)

  useEffect(() => {
    // Guard: only run once per mounted scene
    if (initialized.current) return
    initialized.current = true

    // Raw bounding box before scale
    const rawBox = new THREE.Box3().setFromObject(scene)
    const rawSize = new THREE.Vector3()
    rawBox.getSize(rawSize)
    const rawMax = Math.max(rawSize.x, rawSize.y, rawSize.z)

    // Auto-scale to 500 units target
    const TARGET = 500
    const autoScale = rawMax > 0 ? TARGET / rawMax : 1
    scene.scale.set(autoScale, autoScale, autoScale)
    scene.rotation.y = Math.PI / 2
    scene.updateMatrixWorld(true)

    // Center + ground after scale
    const box = new THREE.Box3().setFromObject(scene)
    const center = box.getCenter(new THREE.Vector3())
    const size = new THREE.Vector3()
    box.getSize(size)

    scene.position.set(-center.x, -box.min.y, -center.z)
    scene.updateMatrixWorld(true)
    scene.matrixAutoUpdate = false

    // Fit camera to model
    const maxDim = Math.max(size.x, size.y, size.z)
    const dist = maxDim * 1.5
    camera.position.set(dist, dist * 0.6, dist)
    camera.near = maxDim * 0.001
    camera.far = maxDim * 50
    camera.lookAt(0, size.y * 0.3, 0)
    camera.updateProjectionMatrix()

    if (controls) {
      controls.target.set(0, size.y * 0.3, 0)
      controls.minDistance = maxDim * 0.1
      controls.maxDistance = maxDim * 10
      controls.update()
    }

    onLoad()
  }, [scene, camera, controls, onLoad])

  return <primitive object={scene} />
}

class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error) {
    return { error }
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex',
          flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          color: '#ffcc88', fontFamily: 'sans-serif', background: '#1a0a00', gap: 12,
        }}>
          <div style={{ fontSize: 36 }}>⚠️</div>
          <div style={{ fontSize: 18 }}>3D viewer failed to load</div>
          <div style={{ fontSize: 13, opacity: 0.6, maxWidth: 400, textAlign: 'center' }}>
            {this.state.error.message}
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

function Loader() {
  return (
    <div style={{
      position: 'absolute', inset: 0, display: 'flex',
      flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      color: '#ffcc88', fontFamily: 'sans-serif', background: '#1a0a00',
      gap: 16, pointerEvents: 'none', zIndex: 10,
    }}>
      <div style={{
        width: 48, height: 48, border: '4px solid #4a2800',
        borderTop: '4px solid #ffcc88', borderRadius: '50%',
        animation: 'spin 1s linear infinite',
      }} />
      <div style={{ fontSize: 16 }}>Loading Egyptian City…</div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

export default function App() {
  const [loaded, setLoaded] = useState(false)
  // Stable callback reference — will not change between renders
  const handleLoad = useCallback(() => setLoaded(true), [])

  return (
    <ErrorBoundary>
      <div style={{ position: 'relative', width: '100vw', height: '100vh', background: '#1a0a00' }}>
        {!loaded && <Loader />}

        <Canvas
          style={{ width: '100%', height: '100%' }}
          gl={{
            antialias: true,
            failIfMajorPerformanceCaveat: false,
            powerPreference: 'high-performance',
          }}
          camera={{ position: [800, 480, 800], fov: 50, near: 0.1, far: 50000 }}
        >
          <ambientLight intensity={1.2} />
          <directionalLight position={[500, 800, 300]} intensity={2.5} castShadow />
          <hemisphereLight skyColor="#ffe0a0" groundColor="#4a3000" intensity={0.8} />

          <Suspense fallback={null}>
            <Scene onLoad={handleLoad} />
          </Suspense>

          <OrbitControls
            makeDefault
            enableDamping
            dampingFactor={0.05}
            maxPolarAngle={Math.PI * 0.88}
            target={[0, 0, 0]}
          />
        </Canvas>
      </div>
    </ErrorBoundary>
  )
}
