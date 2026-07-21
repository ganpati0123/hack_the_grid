import { Suspense, useEffect } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, useGLTF } from '@react-three/drei'
import * as THREE from 'three'

// Page load hote hi GLB fetch shuru ho jaata hai
useGLTF.preload('/egyptian_city.glb')

function Scene() {
  const { scene } = useGLTF('/egyptian_city.glb')

  useEffect(() => {
    // Scale — model ko 5000x bada karo
    scene.scale.set(5000, 5000, 5000)

    // Rotation — 90° taaki sahi direction face kare
    scene.rotation.y = Math.PI / 2

    scene.updateMatrixWorld(true)

    // Bounding box se center nikalo
    const box0 = new THREE.Box3().setFromObject(scene)
    const center = box0.getCenter(new THREE.Vector3())

    // Center ko origin pe laao, Y ko ground pe rakho
    scene.position.set(-center.x, -box0.min.y, -center.z)

    scene.updateMatrixWorld(true)
    scene.matrixAutoUpdate = false  // performance ke liye freeze
  }, [scene])

  return <primitive object={scene} />
}

export default function App() {
  return (
    <Canvas
      style={{ width: '100vw', height: '100vh', background: '#1a1a1a' }}
      gl={{
        antialias: true,
        failIfMajorPerformanceCaveat: false,
        powerPreference: 'low-power',
      }}
      camera={{ position: [100, 60, 100], fov: 50, near: 0.01, far: 100000 }}
    >
      {/* Minimal lights — GLB mein koi embedded light nahi */}
      <ambientLight intensity={1.5} />
      <directionalLight position={[1, 2, 1]} intensity={2} />

      <Suspense fallback={null}>
        <Scene />
      </Suspense>

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.05}
        maxPolarAngle={Math.PI * 0.88}
      />
    </Canvas>
  )
}
