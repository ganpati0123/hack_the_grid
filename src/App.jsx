import { Canvas } from '@react-three/fiber'
import { OrbitControls, useGLTF } from '@react-three/drei'
import { Suspense, useEffect, useRef } from 'react'
import * as THREE from 'three'

function City() {
  const { scene } = useGLTF('/egyptian_city.glb')
  const ref = useRef()

  useEffect(() => {
    if (!ref.current) return

    // Compute bounding box
    const box = new THREE.Box3().setFromObject(ref.current)
    const center = new THREE.Vector3()
    box.getCenter(center)

    // Move model: center X/Z, sit base on Y=0
    ref.current.position.set(
      -center.x,
      -box.min.y,
      -center.z
    )
  }, [scene])

  return <primitive ref={ref} object={scene} />
}

export default function App() {
  return (
    <Canvas
      style={{ width: '100vw', height: '100vh' }}
      camera={{ position: [80, 50, 80], fov: 45, near: 0.1, far: 2000 }}
    >
      <Suspense fallback={null}>
        <City />
        <OrbitControls
          enableDamping
          dampingFactor={0.05}
          maxPolarAngle={Math.PI * 0.88}
          minDistance={5}
          maxDistance={600}
        />
      </Suspense>
    </Canvas>
  )
}
