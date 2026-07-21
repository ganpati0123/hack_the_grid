import { Suspense, useEffect } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, useGLTF } from '@react-three/drei'
import * as THREE from 'three'

useGLTF.preload('/egyptian_city.glb')

function Scene() {
  const { scene } = useGLTF('/egyptian_city.glb')

  useEffect(() => {
    scene.scale.set(5000, 5000, 5000)
    scene.rotation.y = Math.PI / 2
    scene.updateMatrixWorld(true)

    const box0 = new THREE.Box3().setFromObject(scene)
    const center = box0.getCenter(new THREE.Vector3())

    scene.position.set(-center.x, -box0.min.y, -center.z)
    scene.updateMatrixWorld(true)
    scene.matrixAutoUpdate = false
  }, [scene])

  return <primitive object={scene} />
}

export default function App() {
  return (
    <Canvas
      style={{ width: '100vw', height: '100vh', background: '#1a0a00' }}
      gl={{
        antialias: true,
        failIfMajorPerformanceCaveat: false,
        powerPreference: 'high-performance',
      }}
      camera={{ position: [200, 120, 200], fov: 50, near: 0.01, far: 200000 }}
    >
      <ambientLight intensity={1.2} />
      <directionalLight position={[500, 800, 300]} intensity={2.5} castShadow />
      <hemisphereLight skyColor="#ffe0a0" groundColor="#4a3000" intensity={0.8} />

      <Suspense fallback={null}>
        <Scene />
      </Suspense>

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.05}
        minDistance={50}
        maxDistance={5000}
        maxPolarAngle={Math.PI * 0.88}
        target={[0, 0, 0]}
      />
    </Canvas>
  )
}
