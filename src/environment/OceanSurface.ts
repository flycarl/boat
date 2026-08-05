import * as THREE from 'three';

type OceanPalette = {
  deep: THREE.Color;
  mid: THREE.Color;
  shallow: THREE.Color;
  foam: THREE.Color;
};

const DEFAULT_PALETTE: OceanPalette = {
  deep: new THREE.Color('#05728f'),
  mid: new THREE.Color('#09a9bd'),
  shallow: new THREE.Color('#39d6cf'),
  foam: new THREE.Color('#d9ffff'),
};

export class OceanSurface extends THREE.Group {
  private readonly waterMaterial: THREE.ShaderMaterial;

  constructor(halfWidth: number, halfDepth: number) {
    super();
    this.name = 'ocean-surface';

    const oceanWidth = halfWidth * 7;
    const oceanDepth = halfDepth * 7;
    const foundation = new THREE.Mesh(
      new THREE.PlaneGeometry(oceanWidth, oceanDepth),
      new THREE.MeshStandardMaterial({ color: '#087f99', roughness: 0.62, metalness: 0.02 }),
    );
    foundation.name = 'ocean-shadow-foundation';
    foundation.rotation.x = -Math.PI / 2;
    foundation.position.y = -0.12;
    foundation.receiveShadow = true;

    this.waterMaterial = this.createWaterMaterial(DEFAULT_PALETTE);
    const water = new THREE.Mesh(new THREE.PlaneGeometry(oceanWidth, oceanDepth, 72, 56), this.waterMaterial);
    water.name = 'animated-water';
    water.rotation.x = -Math.PI / 2;
    water.position.y = -0.035;
    water.renderOrder = 1;

    this.add(foundation, water, this.createBoundaryBuoys(halfWidth, halfDepth));
  }

  update(elapsed: number): void {
    this.waterMaterial.uniforms.uTime.value = elapsed;
  }

  private createWaterMaterial(palette: OceanPalette): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      name: 'OceanSurfaceMaterial',
      transparent: true,
      depthWrite: false,
      fog: true,
      uniforms: {
        ...THREE.UniformsLib.fog,
        uTime: { value: 0 },
        uDeep: { value: palette.deep },
        uMid: { value: palette.mid },
        uShallow: { value: palette.shallow },
        uFoam: { value: palette.foam },
      },
      vertexShader: /* glsl */ `
        #include <fog_pars_vertex>
        uniform float uTime;
        varying vec3 vSeaPosition;

        void main() {
          vec3 displaced = position;
          vec4 world = modelMatrix * vec4(displaced, 1.0);
          float swellA = sin(world.x * 0.12 + world.z * 0.08 + uTime * 0.48);
          float swellB = sin(world.x * -0.07 + world.z * 0.15 - uTime * 0.36);
          displaced.z += (swellA + swellB) * 0.035;
          world = modelMatrix * vec4(displaced, 1.0);
          vSeaPosition = world.xyz;
          vec4 mvPosition = modelViewMatrix * vec4(displaced, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,
      fragmentShader: /* glsl */ `
        #include <common>
        #include <fog_pars_fragment>
        uniform float uTime;
        uniform vec3 uDeep;
        uniform vec3 uMid;
        uniform vec3 uShallow;
        uniform vec3 uFoam;
        varying vec3 vSeaPosition;

        float hash21(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }

        float noise21(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
            mix(hash21(i + vec2(0.0, 1.0)), hash21(i + 1.0), f.x),
            f.y
          );
        }

        float fbm(vec2 p) {
          float value = 0.0;
          float amplitude = 0.55;
          mat2 rotation = mat2(0.86, -0.51, 0.51, 0.86);
          for (int i = 0; i < 4; i++) {
            value += amplitude * noise21(p);
            p = rotation * p * 2.03 + 7.1;
            amplitude *= 0.48;
          }
          return value;
        }

        void main() {
          vec2 p = vSeaPosition.xz;
          vec2 drift = vec2(uTime * 0.055, -uTime * 0.038);
          float broad = fbm(p * 0.027 + drift * 0.22);
          float current = fbm(p * 0.085 + drift);
          float depthMix = smoothstep(0.23, 0.92, broad * 0.72 + current * 0.28);
          vec3 color = mix(uDeep, uMid, depthMix);
          color = mix(color, uShallow, smoothstep(0.7, 1.0, broad) * 0.42);

          float longWaveA = 0.5 + 0.5 * sin(p.x * 0.25 + p.y * 0.16 + uTime * 0.68 + current * 3.2);
          float longWaveB = 0.5 + 0.5 * sin(p.x * -0.18 + p.y * 0.34 - uTime * 0.51 + broad * 2.7);
          float crest = pow(max(longWaveA, longWaveB), 15.0);
          float fineA = pow(0.5 + 0.5 * sin(p.x * 0.82 + p.y * 0.46 + current * 5.0 + uTime * 0.88), 18.0);
          float fineB = pow(0.5 + 0.5 * sin(p.x * -0.53 + p.y * 1.08 + broad * 4.0 - uTime * 0.72), 20.0);
          float caustic = pow(0.5 + 0.5 * sin((p.x + p.y) * 0.66 + current * 7.0 - uTime * 0.92), 16.0);
          float sparkle = smoothstep(0.82, 1.0, noise21(p * 0.42 + drift * 1.8)) * crest;

          color = mix(color, uFoam, crest * 0.07 + (fineA + fineB) * 0.035 + caustic * 0.045 + sparkle * 0.12);
          float vignette = smoothstep(140.0, 250.0, length(p));
          color = mix(color, uDeep * 0.78, vignette);
          gl_FragColor = vec4(color, 0.82);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }
      `,
    });
  }

  private createBoundaryBuoys(halfWidth: number, halfDepth: number): THREE.Group {
    const group = new THREE.Group();
    group.name = 'playable-sea-boundary';
    const points: THREE.Vector3[] = [];
    const insetX = halfWidth - 0.55;
    const insetZ = halfDepth - 0.55;

    for (let z = -halfDepth + 5; z <= halfDepth - 5; z += 9) {
      points.push(new THREE.Vector3(-insetX, 0, z), new THREE.Vector3(insetX, 0, z));
    }
    for (let x = -halfWidth + 7; x <= halfWidth - 7; x += 11) {
      points.push(new THREE.Vector3(x, 0, -insetZ), new THREE.Vector3(x, 0, insetZ));
    }

    const bodyGeometry = new THREE.CylinderGeometry(0.11, 0.18, 0.3, 8);
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: '#173b49', roughness: 0.52, metalness: 0.08 });
    const bodies = new THREE.InstancedMesh(bodyGeometry, bodyMaterial, points.length);
    const topGeometry = new THREE.SphereGeometry(0.105, 8, 6);
    const topMaterial = new THREE.MeshStandardMaterial({ color: '#ef5b43', roughness: 0.45 });
    const tops = new THREE.InstancedMesh(topGeometry, topMaterial, points.length);
    const ringGeometry = new THREE.RingGeometry(0.18, 0.25, 18);
    const ringMaterial = new THREE.MeshBasicMaterial({ color: '#dffeff', transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });
    const rings = new THREE.InstancedMesh(ringGeometry, ringMaterial, points.length);
    const bodyMatrix = new THREE.Matrix4();
    const topMatrix = new THREE.Matrix4();
    const ringMatrix = new THREE.Matrix4();
    const ringQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));

    points.forEach((point, index) => {
      bodyMatrix.makeTranslation(point.x, 0.12, point.z);
      topMatrix.makeTranslation(point.x, 0.31, point.z);
      ringMatrix.compose(new THREE.Vector3(point.x, 0.035, point.z), ringQuaternion, new THREE.Vector3(1, 1, 1));
      bodies.setMatrixAt(index, bodyMatrix);
      tops.setMatrixAt(index, topMatrix);
      rings.setMatrixAt(index, ringMatrix);
      const accent = index % 2 === 0 ? new THREE.Color('#ef5b43') : new THREE.Color('#fff0a3');
      tops.setColorAt(index, accent);
    });

    bodies.castShadow = true;
    tops.castShadow = true;
    bodies.instanceMatrix.needsUpdate = true;
    tops.instanceMatrix.needsUpdate = true;
    tops.instanceColor!.needsUpdate = true;
    rings.instanceMatrix.needsUpdate = true;
    group.add(bodies, tops, rings);
    return group;
  }
}
