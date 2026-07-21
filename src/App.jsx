import { Suspense, useEffect } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls, useGLTF, Environment } from '@react-three/drei'
import * as THREE from 'three'

useGLTF.preload('/egyptian_city.glb')

function Scene() {
  const { scene } = useGLTF('/egyptian_city.glb')
  const { camera, controls } = useThree()

  useEffect(() => {
    // Step 1: raw bounding box (bina scale ke)
    const rawBox = new THREE.Box3().setFromObject(scene)
    const rawSize = new THREE.Vector3()
    rawBox.getSize(rawSize)
    const rawMax = Math.max(rawSize.x, rawSize.y, rawSize.z)

    // Step 2: 500 units target pe auto-scale karo
    const TARGET = 500
    const autoScale = rawMax > 0 ? TARGET / rawMax : 1
    scene.scale.set(autoScale, autoScale, autoScale)
    scene.rotation.y = Math.PI / 2
    scene.updateMatrixWorld(true)

    // Step 3: scale ke baad center + ground
    const box = new THREE.Box3().setFromObject(scene)
    const center = box.getCenter(new THREE.Vector3())
    const size = new THREE.Vector3()
    box.getSize(size)

    scene.position.set(-center.x, -box.min.y, -center.z)
    scene.updateMatrixWorld(true)
    scene.matrixAutoUpdate = false

    // Step 4: camera ko model ke hisaab se fit karo
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
  }, [scene, camera, controls])

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
      camera={{ position: [800, 480, 800], fov: 50, near: 0.1, far: 50000 }}
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
        maxPolarAngle={Math.PI * 0.88}
        target={[0, 0, 0]}
      />
    </Canvas>
  )
}
