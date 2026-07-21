import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls, useGLTF, useProgress, Html } from '@react-three/drei'
import { Suspense, useEffect, useRef } from 'react'
import * as THREE from 'three'

function Loader() {
  const { progress } = useProgress()
  return (
    <Html center>
      <div style={{
        color: '#fff',
        fontSize: '16px',
        fontFamily: 'sans-serif',
        background: 'rgba(0,0,0,0.75)',
        padding: '14px 32px',
        borderRadius: '8px',
        whiteSpace: 'nowrap',
      }}>
        Loading {Math.round(progress)}%
      </div>
    </Html>
  )
}

function City() {
  const { scene } = useGLTF('/egyptian_city.glb')
  const { camera, controls } = useThree()
  const groupRef = useRef()

  useEffect(() => {
    if (!groupRef.current) return
    const box = new THREE.Box3().setFromObject(groupRef.current)
    const size = new THREE.Vector3()
    const center = new THREE.Vector3()
    box.getSize(size)
    box.getCenter(center)
    const maxDim = Math.max(size.x, size.y, size.z)

    groupRef.current.position.set(-center.x, -box.min.y, -center.z)

    const fov = camera.fov * (Math.PI / 180)
    const camDist = (maxDim / 2) / Math.tan(fov / 2) * 1.6
    camera.position.set(camDist * 0.7, camDist * 0.5, camDist * 0.7)
    camera.near = maxDim * 0.001
    camera.far = maxDim * 100
    camera.lookAt(0, size.y * 0.3, 0)
    camera.updateProjectionMatrix()

    if (controls) {
      controls.target.set(0, size.y * 0.3, 0)
      controls.minDistance = maxDim * 0.05
      controls.maxDistance = maxDim * 10
      controls.update()
    }
  }, [scene, camera, controls])

  return (
    <group ref={groupRef}>
      <primitive object={scene} />
    </group>
  )
}

export default function App() {
  return (
    <Canvas
      style={{ width: '100vw', height: '100vh', background: '#1a1a1a' }}
      gl={{ antialias: true, failIfMajorPerformanceCaveat: false, powerPreference: 'low-power' }}
      camera={{ position: [100, 60, 100], fov: 50, near: 0.01, far: 100000 }}
    >
      <ambientLight intensity={1.5} />
      <directionalLight position={[1, 2, 1]} intensity={2} />
      <Suspense fallback={<Loader />}>
        <City />
      </Suspense>
      <OrbitControls makeDefault enableDamping dampingFactor={0.05} maxPolarAngle={Math.PI * 0.88} />
    </Canvas>
  )
}
