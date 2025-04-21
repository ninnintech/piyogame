// 3D箱庭バードガーデン
console.log("main.js loaded");
import * as THREE from 'https://cdn.skypack.dev/three@0.152.2';

const canvas = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x87ceeb); // 空色

const scene = new THREE.Scene();

// 箱庭の地面
const groundGeo = new THREE.BoxGeometry(40, 1, 40);
const groundMat = new THREE.MeshLambertMaterial({ color: 0x228B22 });
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.position.y = -0.5;
scene.add(ground);

// ライト
const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(10, 20, 10);
scene.add(dirLight);

// 鳥のモデル（シンプルな球体＋円錐で表現）
const bird = new THREE.Group();
const body = new THREE.Mesh(
  new THREE.SphereGeometry(0.7, 16, 16),
  new THREE.MeshLambertMaterial({ color: 0xffff66 })
);
bird.add(body);
const beak = new THREE.Mesh(
  new THREE.ConeGeometry(0.2, 0.5, 8),
  new THREE.MeshLambertMaterial({ color: 0xff9933 })
);
beak.position.set(0, 0, 0.8);
bird.add(beak);
bird.position.set(0, 2, 0);
scene.add(bird);

// カメラ
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 4, 8);
camera.lookAt(bird.position);

// 鳥の移動制御
const move = { forward: 0, turn: 0, up: 0 };
window.addEventListener('keydown', (e) => {
  switch (e.code) {
    case 'KeyW': case 'ArrowUp': move.forward = 1; break;
    case 'KeyS': case 'ArrowDown': move.forward = -1; break;
    case 'KeyA': case 'ArrowLeft': move.turn = 1; break;
    case 'KeyD': case 'ArrowRight': move.turn = -1; break;
    case 'Space': move.up = 1; break;
    case 'ShiftLeft': case 'ShiftRight': move.up = -1; break;
  }
});
window.addEventListener('keyup', (e) => {
  switch (e.code) {
    case 'KeyW': case 'ArrowUp': if (move.forward === 1) move.forward = 0; break;
    case 'KeyS': case 'ArrowDown': if (move.forward === -1) move.forward = 0; break;
    case 'KeyA': case 'ArrowLeft': if (move.turn === 1) move.turn = 0; break;
    case 'KeyD': case 'ArrowRight': if (move.turn === -1) move.turn = 0; break;
    case 'Space': if (move.up === 1) move.up = 0; break;
    case 'ShiftLeft': case 'ShiftRight': if (move.up === -1) move.up = 0; break;
  }
});

function animate() {
  requestAnimationFrame(animate);
  // 鳥の移動
  bird.rotation.y -= move.turn * 0.04;
  const dir = new THREE.Vector3(
    Math.sin(bird.rotation.y),
    0,
    Math.cos(bird.rotation.y)
  );
  bird.position.addScaledVector(dir, move.forward * 0.12);
  bird.position.y += move.up * 0.09;
  // 箱庭の範囲内に制限
  bird.position.x = Math.max(-19, Math.min(19, bird.position.x));
  bird.position.y = Math.max(1, Math.min(10, bird.position.y));
  bird.position.z = Math.max(-19, Math.min(19, bird.position.z));
  // カメラ追従
  camera.position.lerp(
    new THREE.Vector3(
      bird.position.x - 6 * Math.sin(bird.rotation.y),
      bird.position.y + 3,
      bird.position.z - 6 * Math.cos(bird.rotation.y)
    ),
    0.12
  );
  camera.lookAt(bird.position);
  renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
