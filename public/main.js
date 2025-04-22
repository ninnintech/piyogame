// 3D箱庭バードガーデン
let coins = []; 
let move = { forward: 0, turn: 0, up: 0 };
let wingAngle = 0;
let wingDir = 1;
let camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 2000);
let npcs = [];
let chickens = []; 
// --- 衝突判定用のオブジェクトを格納する配列
const collisionObjects = [];

// --- ピア（他プレイヤー）管理 ---
let peers = {};

// --- 衝突判定用のオブジェクトを追加 ---
function addCollisionObject(object, radius) {
  // 衝突判定用のオブジェクト情報をcollisionObjects配列に追加
  // object: THREE.Object3D または {position: THREE.Vector3} など
  // radius: 衝突判定用半径
  collisionObjects.push({
    object: object,
    get position() {
      // objectがTHREE.Object3Dならワールド座標を返す
      if (object.position instanceof THREE.Vector3) return object.position;
      if (typeof object.getWorldPosition === 'function') {
        return object.getWorldPosition(new THREE.Vector3());
      }
      // それ以外はpositionプロパティを返す
      return object.position || new THREE.Vector3();
    },
    radius: radius
  });
}

// --- オンライン同期用ミサイル管理 ---
const allMissiles = {}; // id: { mesh, ownerId, life }
const missiles = [];    // ローカル用ミサイル管理
const NPC_TYPES = [
  { type: 'bird', color: 0x99ccff, scale: 1.1 },
  { type: 'bug', color: 0x333300, scale: 0.5 }
];
import * as THREE from 'https://cdn.skypack.dev/three@0.152.2';

const canvas = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x87ceeb); // 空色

const scene = new THREE.Scene();

// --- ライト ---
const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
dirLight.position.set(40, 80, 40);
dirLight.castShadow = true;
scene.add(dirLight);

// --- 起伏のある地形（より大きな起伏・緑基調で暗めの色） ---
const TERRAIN_SIZE = 1000;
const TERRAIN_SEGMENTS = 64;
const terrainGeo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS);
terrainGeo.rotateX(-Math.PI/2);
for (let i = 0; i < terrainGeo.attributes.position.count; i++) {
  const v = new THREE.Vector3().fromBufferAttribute(terrainGeo.attributes.position, i);
  // より大きな起伏
  const h = Math.sin(v.x*0.009)*Math.cos(v.z*0.012)*38 + Math.sin(v.x*0.025)*Math.cos(v.z*0.027)*16 + Math.random()*2;
  v.y = h;
  terrainGeo.attributes.position.setY(i, v.y);
}
terrainGeo.computeVertexNormals();
// 頂点カラー（緑基調で暗めの色）
const colors = [];
for (let i = 0; i < terrainGeo.attributes.position.count; i++) {
  const y = terrainGeo.attributes.position.getY(i);
  if (y > 30) {
    colors.push(0.25,0.32,0.18); // 高地：暗いオリーブ
  } else if (y > 12) {
    colors.push(0.18,0.36,0.13); // 丘：深緑
  } else {
    colors.push(0.13,0.23,0.09); // 低地：さらに暗い緑
  }
}
terrainGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
const terrainMat = new THREE.MeshLambertMaterial({ vertexColors: true });
const terrain = new THREE.Mesh(terrainGeo, terrainMat);
terrain.position.y = 0;
scene.add(terrain);

// --- 地形の高い＆中腹の頂点ごとに大きめの衝突判定球を追加 ---
for (let i = 0; i < terrainGeo.attributes.position.count; i++) {
  const v = new THREE.Vector3().fromBufferAttribute(terrainGeo.attributes.position, i);
  if (v.y > 10) { // 斜面や中腹も含める
    const pos = v.clone();
    pos.applyMatrix4(terrain.matrixWorld); // ワールド座標に変換
    addCollisionObject({position: pos}, 10); // 半径も拡大
  }
}

// --- 街エリアの生成 ---
// 既存の家・木の配置ループの直後に追加

// ビル群
for (let i = 0; i < 22; i++) {
  const floors = 5 + Math.floor(Math.random()*12);
  const w = 6 + Math.random()*5;
  const d = 6 + Math.random()*5;
  const h = floors * (2.5 + Math.random()*0.7);
  const geo = new THREE.BoxGeometry(w, h, d);
  const color = 0xcccccc + Math.floor(Math.random()*0x222222);
  const mat = new THREE.MeshLambertMaterial({ color });
  const bld = new THREE.Mesh(geo, mat);
  // 市街地エリア（中心寄り・やや平坦な場所）
  let x, z, y;
  let tries = 0;
  do {
    x = (Math.random()-0.5)*TERRAIN_SIZE*0.55;
    z = (Math.random()-0.5)*TERRAIN_SIZE*0.55;
    y = getTerrainHeight(x,z);
    tries++;
  } while ((y < 8 || y > 25) && tries < 10);
  bld.position.set(x, y + h/2, z);
  scene.add(bld);
  // --- 高さを考慮した判定半径で追加 ---
  addCollisionObject(bld, Math.max(w, d, h/2));
}

// 工場
for (let i = 0; i < 7; i++) {
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(13+Math.random()*6, 5+Math.random()*2, 11+Math.random()*5),
    new THREE.MeshLambertMaterial({ color: 0x888888 })
  );
  const chimney = new THREE.Mesh(
    new THREE.CylinderGeometry(0.9, 1.2, 9+Math.random()*3, 12),
    new THREE.MeshLambertMaterial({ color: 0x444444 })
  );
  chimney.position.set(3+Math.random()*3, 7, 2-Math.random()*4);
  const factory = new THREE.Group();
  factory.add(base);
  factory.add(chimney);
  let x, z, y, tries=0;
  do {
    x = (Math.random()-0.5)*TERRAIN_SIZE*0.7;
    z = (Math.random()-0.5)*TERRAIN_SIZE*0.7;
    y = getTerrainHeight(x,z);
    tries++;
  } while ((y < 5 || y > 22) && tries < 10);
  factory.position.set(x, y+5, z);
  scene.add(factory);
  addCollisionObject(factory, 5); // 衝突判定用のオブジェクトを追加
}

// 公園
for (let i = 0; i < 9; i++) {
  const park = new THREE.Group();
  // 芝生
  const grass = new THREE.Mesh(
    new THREE.CylinderGeometry(8+Math.random()*6, 8+Math.random()*6, 0.6, 24),
    new THREE.MeshLambertMaterial({ color: 0x4caf50 })
  );
  grass.position.y = 0.3;
  park.add(grass);
  // ベンチ
  for(let j=0;j<2;j++){
    const bench = new THREE.Mesh(
      new THREE.BoxGeometry(2.8,0.25,0.5),
      new THREE.MeshLambertMaterial({ color: 0x8d5524 })
    );
    bench.position.set(-2+j*4,0.55,2.7-Math.random()*5);
    park.add(bench);
  }
  // 木
  for(let j=0;j<3;j++){
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22,0.32,2.1,8),
      new THREE.MeshLambertMaterial({ color: 0x8B5A2B })
    );
    trunk.position.y = 1.1;
    const leaves = new THREE.Mesh(
      new THREE.SphereGeometry(1.1+Math.random(),8,8),
      new THREE.MeshLambertMaterial({ color: 0x388e3c })
    );
    leaves.position.y = 2.2;
    const tree = new THREE.Group();
    tree.add(trunk); tree.add(leaves);
    tree.position.set(-3+Math.random()*6,0, -2+Math.random()*4);
    park.add(tree);
    // --- 衝突判定用のオブジェクトを追加 ---
    tree.traverse(obj => {
      if (obj.isMesh) addCollisionObject(obj, 1.2);
    });
  }
  // 配置
  let x, z, y, tries=0;
  do {
    x = (Math.random()-0.5)*TERRAIN_SIZE*0.8;
    z = (Math.random()-0.5)*TERRAIN_SIZE*0.8;
    y = getTerrainHeight(x,z);
    tries++;
  } while ((y < 3 || y > 17) && tries < 10);
  park.position.set(x, y+0.3, z);
  scene.add(park);
  addCollisionObject(park, 4); // 衝突判定用のオブジェクトを追加
}

// 池
for (let i = 0; i < 7; i++) {
  const r = 5+Math.random()*7;
  const pond = new THREE.Mesh(
    new THREE.CylinderGeometry(r, r*0.8, 0.7, 28),
    new THREE.MeshLambertMaterial({ color: 0x4fc3f7, transparent:true, opacity:0.75 })
  );
  let x, z, y, tries=0;
  do {
    x = (Math.random()-0.5)*TERRAIN_SIZE*0.85;
    z = (Math.random()-0.5)*TERRAIN_SIZE*0.85;
    y = getTerrainHeight(x,z);
    tries++;
  } while ((y < 2 || y > 12) && tries < 10);
  pond.position.set(x, y+0.35, z);
  scene.add(pond);
  addCollisionObject(pond, 3); // 衝突判定用のオブジェクトを追加
}

// --- 衝突判定を行う関数
function checkCollision(position, radius) {
  // --- 地形との衝突判定（Y座標で判定） ---
  const terrainHeight = getTerrainHeight(position.x, position.z);
  if (position.y < terrainHeight + radius) {
    return {
      collided: true,
      object: terrain,
      position: new THREE.Vector3(position.x, terrainHeight + radius, position.z),
      radius: radius
    };
  }
  // --- 通常のオブジェクト衝突判定 ---
  for (const obj of collisionObjects) {
    // 自分自身との衝突は無視
    if (obj.object === bird) continue;
    // 距離を計算
    const distance = position.distanceTo(obj.position);
    // 衝突判定
    const minDistance = radius + obj.radius;
    if (distance < minDistance) {
      return {
        collided: true,
        object: obj.object,
        position: obj.position,
        radius: obj.radius
      };
    }
  }
  return { collided: false };
}

// --- 衝突応答（めり込み防止）を行う関数
function handleCollision(position, collision) {
  if (!collision.collided) return position;
  
  // 衝突オブジェクトの中心からプレイヤーへのベクトル
  const pushDir = position.clone().sub(collision.object.position).normalize();
  // 衝突オブジェクトの表面にプレイヤーを移動
  const safePos = collision.object.position.clone().add(pushDir.multiplyScalar(collision.radius + 2));
  return safePos;
}

// --- ピア（他プレイヤー）の鳥モデル生成 ---
function createPeerBird(state) {
  // 鳥モデルを生成（自機birdと同じ構造）
  const peerBird = new THREE.Group();
  // 体
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(1.1, 18, 18),
    new THREE.MeshLambertMaterial({ color: state.color || 0xffff66 })
  );
  peerBird.add(body);
  // 頭
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.6, 14, 14),
    new THREE.MeshLambertMaterial({ color: 0xffff99 })
  );
  head.position.set(0, 0.8, 0.7);
  peerBird.add(head);
  // くちばし
  const beak = new THREE.Mesh(
    new THREE.ConeGeometry(0.18, 0.5, 8),
    new THREE.MeshLambertMaterial({ color: 0xff9933 })
  );
  beak.position.set(0, 0.7, 1.25);
  peerBird.add(beak);
  // 羽
  const leftWing = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 1.3, 2.2),
    new THREE.MeshLambertMaterial({ color: 0xfff799 })
  );
  leftWing.position.set(-1.1, 0.3, 0);
  leftWing.rotation.z = Math.PI / 8;
  peerBird.add(leftWing);
  const rightWing = leftWing.clone();
  rightWing.position.x *= -1;
  rightWing.rotation.z *= -1;
  peerBird.add(rightWing);
  // しっぽ
  const tail = new THREE.Mesh(
    new THREE.ConeGeometry(0.18, 0.7, 8),
    new THREE.MeshLambertMaterial({ color: 0xcccc99 })
  );
  tail.position.set(0, -0.2, -1.2);
  tail.rotation.x = Math.PI;
  peerBird.add(tail);

  // 位置・回転の初期化
  peerBird.position.set(state.x || 0, state.y || 4, state.z || 0);
  peerBird.rotation.y = state.ry || 0;

  // 名前ラベル（hpも渡す）
  const nameObj = createNameObj(peerBird, state.name || '???', typeof state.hp === 'number' ? state.hp : 5);

  // 衝突判定用
  addCollisionObject(peerBird, 2);

  // peers用の情報
  return {
    group: peerBird,
    nameObj: nameObj,
    hp: typeof state.hp === 'number' ? state.hp : 5,
    score: typeof state.score === 'number' ? state.score : 0,
    color: state.color || 0xffff66,
    name: state.name || '???'
  };
}

// --- 鶏関連の定数はここで一度だけ定義 ---
const CHICKEN_COLORS = [0xf44336, 0x2196f3, 0x4caf50, 0xffeb3b, 0x9c27b0, 0xff9800, 0x00bcd4]; // 赤,青,緑,黄,紫,オレンジ,水色
const CHICKEN_COUNT = 10;
const CHICKEN_SPAWN_INTERVAL = 1500; // 1.5秒間隔で鶏を生成

// --- 鶏NPC生成・配置 ---
function createChicken(isGold = false) {
  const chicken = new THREE.Group();
  // 体
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(2.2, 18, 18),
    new THREE.MeshLambertMaterial({ color: isGold ? 0xffe066 : CHICKEN_COLORS[Math.floor(Math.random()*CHICKEN_COLORS.length)] })
  );
  chicken.add(body);
  // 頭
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(1.2, 14, 14),
    new THREE.MeshLambertMaterial({ color: isGold ? 0xffff99 : 0xffffff })
  );
  head.position.set(0, 1.6, 1.4);
  chicken.add(head);
  // くちばし
  const beak = new THREE.Mesh(
    new THREE.ConeGeometry(0.36, 1.0, 8),
    new THREE.MeshLambertMaterial({ color: 0xff9933 })
  );
  beak.position.set(0, 1.4, 2.5);
  chicken.add(beak);
  // 羽
  const leftWing = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 2.6, 4.4),
    new THREE.MeshLambertMaterial({ color: 0xffffff })
  );
  leftWing.position.set(-2.2, 0.6, 0);
  leftWing.rotation.z = Math.PI / 8;
  chicken.add(leftWing);
  const rightWing = leftWing.clone();
  rightWing.position.set(2.2, 0.6, 0);
  rightWing.rotation.z = -Math.PI / 8;
  chicken.add(rightWing);
  // 金色エフェクト
  if (isGold) {
    body.material.emissive = new THREE.Color(0xfff700);
    body.material.emissiveIntensity = 0.7;
  }
  chicken.userData.isGold = isGold;
  chicken.userData.type = 'chicken';
  return chicken;
}

function randomChickenPosition() {
  // X,Z: 中心±TERRAIN_SIZE*0.3, Y: 40〜80の空中
  return new THREE.Vector3(
    (Math.random() - 0.5) * TERRAIN_SIZE * 0.6,
    40 + Math.random() * 40,
    (Math.random() - 0.5) * TERRAIN_SIZE * 0.6
  );
}

function spawnChickens() {
  // 1体は金色、残りはランダム色
  for (let i = 0; i < CHICKEN_COUNT; i++) {
    const isGold = (i === 0); // 1体だけ金色
    const chicken = createChicken(isGold);
    chicken.position.copy(randomChickenPosition());
    chickens.push(chicken);
    scene.add(chicken);
    addCollisionObject(chicken, 4); // 衝突判定用のオブジェクトを追加
  }
}

function respawnChicken(chicken) {
  chicken.position.copy(randomChickenPosition());
}

// --- 鳥の消滅エフェクト ---
function spawnChickenEffect(pos, isGold) {
  // 小さな球体パーティクルを複数生成
  for (let i = 0; i < 10; i++) {
    const geo = new THREE.SphereGeometry(0.6 + Math.random()*0.5, 8, 8);
    const mat = new THREE.MeshBasicMaterial({
      color: isGold ? 0xffe066 : 0xffffff,
      transparent: true,
      opacity: 0.9
    });
    const eff = new THREE.Mesh(geo, mat);
    eff.position.copy(pos);
    scene.add(eff);
    // アニメーション
    const start = performance.now();
    function animateParticle() {
      const t = (performance.now() - start) / 600;
      eff.position.addScaledVector(new THREE.Vector3(
        (Math.random()-0.5)*2,
        Math.random()*2,
        (Math.random()-0.5)*2
      ), 0.15);
      eff.material.opacity = 0.9 * (1-t);
      if (t < 1) {
        requestAnimationFrame(animateParticle);
      } else {
        scene.remove(eff);
      }
    }
    animateParticle();
  }
}

// --- 毎フレーム：全ミサイルと全鶏の当たり判定 ---
function checkAllChickenHits() {
  for (const missileId in allMissiles) {
    const missile = allMissiles[missileId];
    if (!missile || !missile.mesh || missile.life <= 0) continue;
    // 通常鶏
    for (let i = chickens.length - 1; i >= 0; i--) {
      const chicken = chickens[i];
      const distance = missile.mesh.position.distanceTo(chicken.position);
      if (distance < 5.0) {
        score += chicken.userData.isGold ? 2 : 1;
        updateInfo();
        spawnChickenEffect(chicken.position, chicken.userData.isGold); // エフェクト追加
        playBakuhaSound(); // 爆発音再生
        scene.remove(chicken); // 鶏を一度消す
        chickens.splice(i, 1); // 鶏配列から削除
        respawnChicken(chicken); // ランダム位置に再配置
        scene.add(chicken); // 再度フィールドに追加
        // ミサイル消去
        scene.remove(missile.mesh);
        missile.life = 0;
        delete allMissiles[missileId]; // 完全削除
        break;
      }
    }
    // 虹色チキン
    if (rainbowChicken) {
      const distance = missile.mesh.position.distanceTo(rainbowChicken.position);
      if (distance < 7.0) {
        rainbowChicken.userData.hp--;
        rainbowChicken.userData.lastHitPlayer = myId; // 最後に当てたプレイヤー
        spawnChickenEffect(rainbowChicken.position, false);
        playBakuhaSound();
        scene.remove(missile.mesh);
        missile.life = 0;
        delete allMissiles[missileId];
        if (rainbowChicken.userData.hp <= 0) {
          // 5ポイント加算
          if (rainbowChicken.userData.lastHitPlayer === myId) {
            score += 5;
            updateInfo();
          }
          // 消滅＆5分後に再出現
          removeRainbowChicken();
          scheduleRainbowChickenRespawn();
        }
        break;
      }
    }
  }
}

// --- 爆発音再生 ---
function playBakuhaSound() {
  const bakuhaAudio = document.getElementById('bakuha-audio');
  if (bakuhaAudio) {
    bakuhaAudio.currentTime = 0;
    bakuhaAudio.volume = 0.7;
    bakuhaAudio.play().catch(()=>{});
  }
}

// --- 虹色チキン管理用 ---
let rainbowChicken = null;
let rainbowChickenTimeout = null;

function createRainbowChicken() {
  const chicken = new THREE.Group();
  // 体
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(4.4, 18, 18),
    new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 80 })
  );
  // 虹色グラデーション
  body.material.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      `
        float hue = mod((vUv.y + vUv.x) * 1.5 + time * 0.04, 1.0);
        vec3 rainbow = hsv2rgb(vec3(hue, 0.9, 1.0));
        gl_FragColor.rgb = rainbow;
        #include <dithering_fragment>
      `
    );
  };
  chicken.add(body);
  // 頭
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(2.4, 14, 14),
    new THREE.MeshLambertMaterial({ color: 0xffffff })
  );
  head.position.set(0, 3.2, 2.8);
  chicken.add(head);
  // くちばし
  const beak = new THREE.Mesh(
    new THREE.ConeGeometry(0.72, 2.0, 8),
    new THREE.MeshLambertMaterial({ color: 0xff9933 })
  );
  beak.position.set(0, 2.8, 5.0);
  chicken.add(beak);
  // 羽
  const leftWing = new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 5.2, 8.8),
    new THREE.MeshLambertMaterial({ color: 0xffffff })
  );
  leftWing.position.set(-4.4, 1.2, 0);
  leftWing.rotation.z = Math.PI / 8;
  chicken.add(leftWing);
  const rightWing = leftWing.clone();
  rightWing.position.set(4.4, 1.2, 0);
  rightWing.rotation.z = -Math.PI / 8;
  chicken.add(rightWing);
  chicken.userData.isRainbow = true;
  chicken.userData.type = 'rainbow';
  chicken.userData.hp = 2;
  chicken.userData.lastHitPlayer = null;
  return chicken;
}

function spawnRainbowChicken() {
  if (rainbowChicken) {
    scene.remove(rainbowChicken);
    rainbowChicken = null;
  }
  rainbowChicken = createRainbowChicken();
  rainbowChicken.position.copy(randomChickenPosition());
  scene.add(rainbowChicken);
}

function removeRainbowChicken() {
  if (rainbowChicken) {
    scene.remove(rainbowChicken);
    rainbowChicken = null;
  }
}

function scheduleRainbowChickenRespawn() {
  if (rainbowChickenTimeout) clearTimeout(rainbowChickenTimeout);
  rainbowChickenTimeout = setTimeout(() => {
    spawnRainbowChicken();
  }, 5 * 60 * 1000); // 5分後
}

// --- 鶏の移動関数 ---
function moveChickenSlowly(chicken) {
  // ゆっくり・ふわふわ飛び回る動き
  if (!chicken.userData.basePos) {
    chicken.userData.basePos = chicken.position.clone();
    chicken.userData.phase = Math.random() * Math.PI * 2;
    chicken.userData.radius = 55 + Math.random() * 60;
    // 通常の鶏はさらに遅く
    chicken.userData.speed = chicken.userData.isRainbow ? 0.00013 + Math.random() * 0.00007 : 0.00015 + Math.random() * 0.00009;
    chicken.userData.height = 38 + Math.random() * 20;
  }
  const now = performance.now();
  chicken.position.x = chicken.userData.basePos.x + Math.cos(now * chicken.userData.speed + chicken.userData.phase) * chicken.userData.radius;
  chicken.position.z = chicken.userData.basePos.z + Math.sin(now * chicken.userData.speed + chicken.userData.phase) * chicken.userData.radius;
  chicken.position.y = chicken.userData.height + Math.sin(now * 0.0008 + chicken.userData.phase) * 7;
  chicken.rotation.y = Math.PI/2 - (now * chicken.userData.speed + chicken.userData.phase);
}

// --- 飛行機・ヘリコプター生成 ---
const aircrafts = [];
function createAirplane() {
  const plane = new THREE.Group();
  // 胴体
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.7, 0.9, 7, 12),
    new THREE.MeshLambertMaterial({ color: 0xdddddd })
  );
  body.rotation.z = Math.PI/2;
  plane.add(body);
  // 翼
  const wing = new THREE.Mesh(
    new THREE.BoxGeometry(6, 0.2, 1.1),
    new THREE.MeshLambertMaterial({ color: 0x1976d2 })
  );
  plane.add(wing);
  // 尾翼
  const tail = new THREE.Mesh(
    new THREE.BoxGeometry(1.3, 0.15, 0.7),
    new THREE.MeshLambertMaterial({ color: 0x1976d2 })
  );
  tail.position.set(-3.2, 0.4, 0);
  tail.rotation.z = Math.PI/10;
  plane.add(tail);

  // 位置・回転の初期化
  plane.position.set((Math.random()-0.5)*TERRAIN_SIZE*0.7, 60+Math.random()*30, (Math.random()-0.5)*TERRAIN_SIZE*0.7);
  plane.userData = { type: 'airplane', baseY: plane.position.y, phase: Math.random()*Math.PI*2 };
  scene.add(plane);
  aircrafts.push(plane);
  addCollisionObject(plane, 6); // 衝突判定用のオブジェクトを追加
}
function createHelicopter() {
  const heli = new THREE.Group();
  // 胴体
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.7, 0.9, 4.5, 10),
    new THREE.MeshLambertMaterial({ color: 0x388e3c })
  );
  body.rotation.z = Math.PI/2;
  heli.add(body);
  // コックピット
  const cockpit = new THREE.Mesh(
    new THREE.SphereGeometry(0.9, 10, 10),
    new THREE.MeshLambertMaterial({ color: 0xb2dfdb })
  );
  cockpit.position.set(2.2, 0, 0);
  heli.add(cockpit);
  // メインローター
  const rotor = new THREE.Mesh(
    new THREE.BoxGeometry(5.5, 0.12, 0.22),
    new THREE.MeshLambertMaterial({ color: 0x222222 })
  );
  rotor.position.set(0, 0.7, 0);
  heli.add(rotor);
  // テールローター
  const tailRotor = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.8, 0.18),
    new THREE.MeshLambertMaterial({ color: 0x222222 })
  );
  tailRotor.position.set(-2.2, 0.15, 0.0);
  tailRotor.rotation.z = Math.PI/2;
  heli.add(tailRotor);
  // 位置・回転
  heli.position.set((Math.random()-0.5)*TERRAIN_SIZE*0.7, 38+Math.random()*30, (Math.random()-0.5)*TERRAIN_SIZE*0.7);
  heli.userData = { type: 'helicopter', baseY: heli.position.y, phase: Math.random()*Math.PI*2 };
  scene.add(heli);
  aircrafts.push(heli);
  addCollisionObject(heli, 5); // 衝突判定用のオブジェクトを追加
}
// 2機ずつ生成
for(let i=0;i<2;i++){ createAirplane(); createHelicopter(); }

// --- 色付きの山 ---
for (let i = 0; i < 16; i++) {
  const h = 30 + Math.random() * 35;
  const r = 12 + Math.random() * 22;
  const mountainGeo = new THREE.ConeGeometry(r, h, 18);
  // 高さで色を変える
  let color = 0x888866;
  if (h > 50) color = 0xe0e0e0; // 雪山
  else if (h > 40) color = 0x8d5524; // 茶色
  else color = 0x3d9140; // 緑
  const mountainMat = new THREE.MeshLambertMaterial({ color });
  const mountain = new THREE.Mesh(mountainGeo, mountainMat);
  // 地形上のランダム位置
  const mx = (Math.random() - 0.5) * (TERRAIN_SIZE-160);
  const mz = (Math.random() - 0.5) * (TERRAIN_SIZE-160);
  // 地形の高さに合わせて配置
  const my = getTerrainHeight(mx,mz) + h/2;
  mountain.position.set(mx, my, mz);
  scene.add(mountain);
  addCollisionObject(mountain, 8); // 衝突判定用のオブジェクトを追加

  // --- 洞窟をいくつか山の中に ---
  if (i % 4 === 0) {
    const caveGeo = new THREE.TorusGeometry(r*0.6, 3.5 + Math.random()*1.5, 14, 30, Math.PI*1.05);
    const caveMat = new THREE.MeshLambertMaterial({ color: 0xcccccc });
    const cave = new THREE.Mesh(caveGeo, caveMat);
    cave.position.set(mx, my-h*0.15, mz);
    cave.rotation.x = Math.PI/2 + (Math.random()-0.5)*0.5;
    cave.rotation.y = Math.random()*Math.PI*2;
    scene.add(cave);
    addCollisionObject(cave, 4); // 衝突判定用のオブジェクトを追加
  }
}

// --- 地形の高さを取得する関数 ---
function getTerrainHeight(x, z) {
  // Planeの中心座標系→頂点インデックスを推定
  const fx = (x + TERRAIN_SIZE/2) / TERRAIN_SIZE * TERRAIN_SEGMENTS;
  const fz = (z + TERRAIN_SIZE/2) / TERRAIN_SIZE * TERRAIN_SEGMENTS;
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  const idx = iz * (TERRAIN_SEGMENTS+1) + ix;
  return terrainGeo.attributes.position.getY(idx);
}

// --- 川 ---
for (let i = 0; i < 4; i++) {
  const riverGeo = new THREE.BoxGeometry(TERRAIN_SIZE * (0.5 + Math.random() * 0.3), 0.3, 12 + Math.random() * 10);
  const riverMat = new THREE.MeshLambertMaterial({ color: 0x3399ff });
  const river = new THREE.Mesh(riverGeo, riverMat);
  river.position.set(
    (Math.random() - 0.5) * (TERRAIN_SIZE - 200),
    0.2,
    (Math.random() - 0.5) * (TERRAIN_SIZE - 200)
  );
  river.rotation.y = Math.random() * Math.PI;
  scene.add(river);
  addCollisionObject(river, 6); // 衝突判定用のオブジェクトを追加
}

// --- 道路 ---
for (let i = 0; i < 5; i++) {
  const roadGeo = new THREE.BoxGeometry(TERRAIN_SIZE * (0.7 + Math.random() * 0.2), 0.4, 7 + Math.random() * 3);
  const roadMat = new THREE.MeshLambertMaterial({ color: 0x222222 });
  const road = new THREE.Mesh(roadGeo, roadMat);
  road.position.set(
    (Math.random() - 0.5) * (TERRAIN_SIZE - 100),
    0.25,
    (Math.random() - 0.5) * (TERRAIN_SIZE - 100)
  );
  road.rotation.y = Math.random() * Math.PI;
  scene.add(road);
  addCollisionObject(road, 4); // 衝突判定用のオブジェクトを追加
}

// --- 家 ---
for (let i = 0; i < 60; i++) {
  const house = new THREE.Group();
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(4 + Math.random() * 2, 3 + Math.random(), 4 + Math.random() * 2),
    new THREE.MeshLambertMaterial({ color: 0xffe4b5 + Math.floor(Math.random() * 0x2222) })
  );
  house.add(base);
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(3.2 + Math.random(), 2.5 + Math.random(), 4),
    new THREE.MeshLambertMaterial({ color: 0xb22222 + Math.floor(Math.random() * 0x2222) })
  );
  roof.position.y = base.geometry.parameters.height / 2 + (roof.geometry.parameters.height / 2);
  roof.rotation.y = Math.PI / 4;
  house.add(roof);
  house.position.set(
    (Math.random() - 0.5) * (TERRAIN_SIZE - 80),
    base.geometry.parameters.height / 2,
    (Math.random() - 0.5) * (TERRAIN_SIZE - 80)
  );
  scene.add(house);
  addCollisionObject(house, 4); // 衝突判定用のオブジェクトを追加
}

// --- 木 ---
for (let i = 0; i < 200; i++) {
  const tree = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.3, 0.5, 3 + Math.random() * 2, 8),
    new THREE.MeshLambertMaterial({ color: 0x8B5A2B })
  );
  trunk.position.y = trunk.geometry.parameters.height / 2;
  tree.add(trunk);
  const leaves = new THREE.Mesh(
    new THREE.SphereGeometry(1.5 + Math.random(), 10, 10),
    new THREE.MeshLambertMaterial({ color: 0x228B22 + Math.floor(Math.random() * 0x1000) })
  );
  leaves.position.y = trunk.geometry.parameters.height + 1.2;
  tree.add(leaves);
  tree.position.set(
    (Math.random() - 0.5) * (TERRAIN_SIZE - 40),
    0,
    (Math.random() - 0.5) * (TERRAIN_SIZE - 40)
  );
  scene.add(tree);
  addCollisionObject(tree, 3); // 衝突判定用のオブジェクトを追加
}

// --- 雲 ---
for (let i = 0; i < 40; i++) {
  const cloud = new THREE.Group();
  for (let j = 0; j < 3 + Math.floor(Math.random() * 4); j++) {
    const part = new THREE.Mesh(
      new THREE.SphereGeometry(2 + Math.random() * 2, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 })
    );
    part.position.set(
      (Math.random() - 0.5) * 6,
      (Math.random() - 0.5) * 2,
      (Math.random() - 0.5) * 5
    );
    cloud.add(part);
  }
  cloud.position.set(
    (Math.random() - 0.5) * (TERRAIN_SIZE - 100),
    40 + Math.random() * 40,
    (Math.random() - 0.5) * (TERRAIN_SIZE - 100)
  );
  scene.add(cloud);
  addCollisionObject(cloud, 8); // 衝突判定用のオブジェクトを追加
}

// --- 車 ---
const cars = [];
for (let i = 0; i < 60; i++) {
  const car = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(3.5, 1.2, 1.8),
    new THREE.MeshLambertMaterial({ color: 0x4444ff + Math.floor(Math.random()*0x8888) })
  );
  car.add(body);
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x222222 });
  for (let j = 0; j < 4; j++) {
    const wheel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.35, 0.6, 12),
      wheelMat
    );
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(j < 2 ? -1.2 : 1.2, -0.7, j % 2 === 0 ? -0.75 : 0.75);
    car.add(wheel);
  }
  // 道路上に配置
  car.position.set(
    (Math.random() - 0.5) * (TERRAIN_SIZE * 0.9),
    0.7,
    (Math.random() - 0.5) * (TERRAIN_SIZE * 0.9)
  );
  car.userData = { dir: (Math.random() < 0.5 ? 1 : -1) * (Math.random() * Math.PI) };
  cars.push(car);
  scene.add(car);
  addCollisionObject(car, 3); // 衝突判定用のオブジェクトを追加
}

// --- 鳥モデル ---
const bird = new THREE.Group();
// 体
const body = new THREE.Mesh(
  new THREE.SphereGeometry(1.1, 18, 18),
  new THREE.MeshLambertMaterial({ color: 0xffff66 })
);
bird.add(body);
// 頭
const head = new THREE.Mesh(
  new THREE.SphereGeometry(0.6, 14, 14),
  new THREE.MeshLambertMaterial({ color: 0xffff99 })
);
head.position.set(0, 0.8, 0.7);
bird.add(head);
// くちばし
const beak = new THREE.Mesh(
  new THREE.ConeGeometry(0.18, 0.5, 8),
  new THREE.MeshLambertMaterial({ color: 0xff9933 })
);
beak.position.set(0, 0.7, 1.25);
bird.add(beak);
// 羽
const leftWing = new THREE.Mesh(
  new THREE.BoxGeometry(0.2, 1.3, 2.2),
  new THREE.MeshLambertMaterial({ color: 0xfff799 })
);
leftWing.position.set(-1.1, 0.3, 0);
leftWing.rotation.z = Math.PI / 8;
bird.add(leftWing);
const rightWing = leftWing.clone();
rightWing.position.x *= -1;
rightWing.rotation.z *= -1;
bird.add(rightWing);
// しっぽ
const tail = new THREE.Mesh(
  new THREE.ConeGeometry(0.18, 0.7, 8),
  new THREE.MeshLambertMaterial({ color: 0xcccc99 })
);
tail.position.set(0, -0.2, -1.2);
tail.rotation.x = Math.PI;
bird.add(tail);

bird.position.set(0, 4, 0);
scene.add(bird);
addCollisionObject(bird, 2); // 衝突判定用のオブジェクトを追加

// --- 鳥の色変更 ---
function setBirdColor(birdGroup, color) {
  birdGroup.children[0].material.color.set(color); // 体
  if (birdGroup.children[1]) birdGroup.children[1].material.color.set('#ffff99'); // 頭
  // 羽やしっぽはそのまま
}

// --- 名前ラベル（DOM）+ハート ---
function createNameObj(birdGroup, name, hp = 5) {
  let div = document.createElement('div');
  div.className = 'bird-name-label';
  div.style.position = 'absolute';
  div.style.fontSize = '15px';
  div.style.fontWeight = 'bold';
  div.style.color = '#333';
  div.style.background = 'rgba(255,255,255,0.8)';
  div.style.borderRadius = '6px';
  div.style.padding = '2px 8px';
  div.style.pointerEvents = 'none';
  // ハート部
  let heartDiv = document.createElement('div');
  heartDiv.className = 'bird-hp-hearts';
  heartDiv.style.textAlign = 'center';
  heartDiv.style.fontSize = '18px';
  heartDiv.style.marginBottom = '-2px';
  div.appendChild(heartDiv);
  // 名前部
  let nameSpan = document.createElement('span');
  nameSpan.textContent = name;
  div.appendChild(nameSpan);
  document.body.appendChild(div);
  birdGroup.userData = { nameObj: { element: div, group: birdGroup, heartDiv, nameSpan } };
  updateHeartDisplay(birdGroup, hp);
  return birdGroup.userData.nameObj;
}

// --- ハート表示更新 ---
function updateHeartDisplay(birdOrPeer, hpVal) {
  var nameObj = (birdOrPeer.userData && birdOrPeer.userData.nameObj) ? birdOrPeer.userData.nameObj : birdOrPeer.nameObj;
  if (!nameObj || !nameObj.heartDiv) return;
  var hearts = '';
  for (var i = 0; i < 5; i++) {
    hearts += i < hpVal ? '♥' : '♡';
  }
  nameObj.heartDiv.innerHTML = "<span style='color:#e53935;text-shadow:0 0 2px #fff;'>" + hearts + "</span>";
}

// --- 名前ラベル位置同期時にHPも反映 ---
// function updateNameObjPosition(peer) {
//   var pos = peer.group.position.clone();
//   pos.y += 2.2;
//   pos.project(camera);
//   var x = (pos.x * 0.5 + 0.5) * window.innerWidth;
//   var y = (-pos.y * 0.5 + 0.5) * window.innerHeight;
//   peer.nameObj.element.style.left = (x - 32) + "px";
//   peer.nameObj.element.style.top = (y - 18) + "px";
//   updateHeartDisplay(peer, peer.hp);
// }
function updateMyNameObjPosition() {
  if (!bird.userData.nameObj) return;
  var pos = bird.position.clone();
  pos.y += 2.2;
  pos.project(camera);
  var x = (pos.x * 0.5 + 0.5) * window.innerWidth;
  var y = (-pos.y * 0.5 + 0.5) * window.innerHeight;
  bird.userData.nameObj.element.style.left = (x - 32) + "px";
  bird.userData.nameObj.element.style.top = (y - 18) + "px";
  updateHeartDisplay(bird, hp);
}

async function initAbly() {
  try {
    // 本番 or ローカルでAPIエンドポイントを切り替え
    const apiBase =
      location.hostname === 'localhost' || location.hostname === '127.0.0.1'
        ? 'http://localhost:3000'
        : '';
    const response = await fetch(`${apiBase}/api/token`);
    if (!response.ok) {
      throw new Error('トークン取得エラー');
    }
    const tokenRequest = await response.json();

    // Ablyクライアント初期化 (トークン認証)
    return new Ably.Realtime({
      authCallback: (_, callback) => {
        callback(null, tokenRequest);
      }
    });
  } catch (error) {
    console.error('Ably初期化エラー:', error);
    alert('サーバー接続エラー: 認証サーバーが起動しているか確認してください');
    return null;
  }
}

// グローバル変数
let ably, channel;

// 非同期処理でAblyを初期化
async function setupRealtimeConnection() {
  ably = await initAbly();
  if (!ably) return;
  
  channel = ably.channels.get('bird-garden-3d');
  
  // 状態同期のサブスクライブ
  channel.subscribe('state', (msg) => {
    const s = msg.data;
    if (s.id === myId) return; // 自分は除外
    
    if (!peers[s.id]) {
      peers[s.id] = createPeerBird(s);
      scene.add(peers[s.id].group);
    }
    const peer = peers[s.id];
    peer.group.position.set(s.x, s.y, s.z);
    peer.group.rotation.y = s.ry;
    setBirdColor(peer.group, s.color);
    peer.nameObj.element.textContent = s.name;
    peer.hp = s.hp;
    peer.score = s.score;
    updateNameObjPosition(peer);
  });
  
  // ミサイル同期のサブスクライブ
  channel.subscribe('fire', (msg) => {
    const m = msg.data;
    if (m.id === myId) return; // 自分はローカルで処理済み
    
    const pos = new THREE.Vector3(m.x, m.y, m.z);
    const dir = new THREE.Vector3(m.dx, m.dy, m.dz);
    
    launchOnlineMissile(m.id, pos, dir);
  });
  
  // --- Ably Presence: join and count active users ---
  channel.presence.enter({ id: myId, name: myName, color: myColor });

  // Listen for presence updates
  function updateActiveUserCount() {
    channel.presence.get((err, members) => {
      if (!err && members) {
        userCount = members.length;
        updateInfo();
      }
    });
  }
  channel.presence.subscribe('enter', updateActiveUserCount);
  channel.presence.subscribe('leave', updateActiveUserCount);
  channel.presence.subscribe('update', updateActiveUserCount);
  // Initial count
  updateActiveUserCount();

  // ユーザーID生成
  myId = Math.random().toString(36).substr(2, 9);
}

// --- ユーザーIDの生成 ---
let myId = null; // 既存のmyIdを再利用
myId = Math.random().toString(36).substr(2, 9); // 仮の一意ID

// --- 状態送信 ---
function sendState() {
  if (!channel) return;
  
  channel.publish('state', {
    id: myId,
    x: bird.position.x,
    y: bird.position.y,
    z: bird.position.z,
    ry: bird.rotation.y,
    name: myName,
    color: myColor,
    hp,
    score
  });
}
setInterval(sendState, 100);

// --- サブスクライブ: 他プレイヤーの状態反映 ---
// channel.subscribe('state', (msg) => {
//   const s = msg.data;
//   if (s.id === myId) return; // 自分は除外
//   if (!peers[s.id]) {
//     peers[s.id] = createPeerBird(s);
//     scene.add(peers[s.id].group);
//   }
//   const peer = peers[s.id];
//   peer.group.position.set(s.x, s.y, s.z);
//   peer.group.rotation.y = s.ry;
//   setBirdColor(peer.group, s.color);
//   peer.nameObj.element.textContent = s.name;
//   updateNameObjPosition(peer);
//   // HP/スコア
//   if (typeof msg.hp === 'number') peer.hp = msg.hp;
//   if (typeof msg.score === 'number') peer.score = msg.score;
});

// --- ミサイル発射 ---
function fireMissile() {
  if (!channel) return; // チャンネルが初期化されていなければ処理しない
  
  playShotSound();
  const dir = new THREE.Vector3(Math.sin(bird.rotation.y), 0, Math.cos(bird.rotation.y));
  launchLocalMissile(bird.position, dir);
  channel.publish('fire', {
    id: myId,
    x: bird.position.x,
    y: bird.position.y,
    z: bird.position.z,
    dx: dir.x,
    dy: dir.y,
    dz: dir.z
  });
}

// --- ログイン処理 ---
let myName = null;
let myColor = '#ffff66';
function showLogin() {
  document.getElementById('login-modal').style.display = 'flex';
  document.getElementById('login-btn').onclick = function() {
    const name = document.getElementById('login-name').value.trim();
    const color = document.getElementById('login-color').value;
    if (!name) { alert('ユーザー名を入力してください'); return; }
    myName = name;
    myColor = color;
    document.getElementById('login-modal').style.display = 'none';
    startGame();
  };
}
window.addEventListener('DOMContentLoaded', showLogin);

// --- ゲーム開始 ---
function startGame() {
  // 一意なIDを最初に生成
  myId = Math.random().toString(36).substr(2, 9);
  // 鳥の色を反映
  setBirdColor(bird, myColor);
  createNameObj(bird, myName);
  spawnGameObjects(); // ゲーム開始時にコイン＆鶏を必ず出現させる
  try {
    const result = setupRealtimeConnection();
    if (result && typeof result.then === 'function') {
      result.finally(() => {
        if (typeof animate === 'function') animate();
      });
    } else {
      if (typeof animate === 'function') animate();
    }
  } catch (e) {
    if (typeof animate === 'function') animate();
  }
}

// --- ゲーム開始時にコインと鶏を必ず出現させる関数 ---
function spawnGameObjects() {
  // コイン・鶏を初期化し出現させる
  // 既存オブジェクトを消去
  for (const c of coins) scene.remove(c);
  coins.length = 0;
  for (const c of chickens) scene.remove(c);
  chickens.length = 0;
  // コイン
  if (typeof spawnCoinsAtSky === 'function') {
    spawnCoinsAtSky(16);
  } else if (typeof spawnCoin === 'function') {
    for (let i = 0; i < 16; i++) spawnCoin();
  }
  // 鶏
  if (typeof spawnChickens === 'function') spawnChickens();
}

// --- サーバーからのイベント受信 ---
// function handleServerMessage(event) {
//   const msg = JSON.parse(event.data);
//   if (msg.type === 'welcome') {
//     myId = msg.id;
//     sendState();
//   } else if (msg.type === 'peer') {
//     if (!peers[msg.id]) {
//       peers[msg.id] = createPeerBird(msg.state);
//       scene.add(peers[msg.id].group);
//     }
//     const s = msg.state;
//     const peer = peers[msg.id];
//     peer.group.position.set(s.x, s.y, s.z);
//     peer.group.rotation.y = s.ry;
//     setBirdColor(peer.group, s.color);
//     peer.nameObj.element.textContent = s.name;
//     updateNameObjPosition(peer);
//     // HP/スコア
//     if (typeof msg.hp === 'number') peer.hp = msg.hp;
//     if (typeof msg.score === 'number') peer.score = msg.score;
//   } else if (msg.type === 'missile') {
//     console.log('missile event received', msg);
//     // ミサイル生成
//     const m = msg.missile;
//     if (allMissiles[m.id]) return; // 二重生成防止
//     const mesh = new THREE.Mesh(
//       new THREE.CylinderGeometry(0.13, 0.13, 1.5, 8),
//       new THREE.MeshLambertMaterial({ color: m.ownerId === myId ? 0xff3333 : 0x3333ff })
//     );
//     mesh.position.set(m.x, m.y, m.z);
//     mesh.rotation.x = Math.PI / 2;
//     scene.add(mesh);
//     allMissiles[m.id] = {
//       mesh,
//       ownerId: m.ownerId,
//       dir: new THREE.Vector3(m.dx, m.dy, m.dz),
//       life: 0
//     };
//   } else if (msg.type === 'hp_score') {
//     if (msg.id === myId) {
//       hp = msg.hp;
//       score = msg.score;
//       updateInfo();
//       updateHeartDisplay(bird, hp);
//     } else if (peers[msg.id]) {
//       peers[msg.id].hp = msg.hp;
//       peers[msg.id].score = msg.score;
//       updateHeartDisplay(peers[msg.id], peers[msg.id].hp);
//     }
//   } else if (msg.type === 'respawn') {
//     bird.position.set(msg.x, msg.y, msg.z);
//     hp = maxHP;
//       updateInfo();
//       updateHeartDisplay(bird, hp);
//   } else if (msg.type === 'leave') {
//     if (peers[msg.id]) {
//       scene.remove(peers[msg.id].group);
//       document.body.removeChild(peers[msg.id].nameObj.element);
//       delete peers[msg.id];
//     }
//   } else if (msg.type === 'user_count') {
//     userCount = msg.count;
//     updateInfo();
//   } else if (msg.type === 'ranking') {
//     top3 = msg.top3;
//     updateRanking();
//   }
// }

// --- 左右分割ボタン初期化 ---
// 削除

// --- バーチャルジョイスティック（nipplejs） ---
import 'https://cdnjs.cloudflare.com/ajax/libs/nipplejs/0.9.0/nipplejs.min.js';

window.addEventListener('DOMContentLoaded', () => {
  // ジョイスティック初期化
  const joystick = nipplejs.create({
    zone: document.getElementById('joystick-zone'),
    mode: 'static',
    position: { left: '60px', bottom: '60px' },
    color: 'blue',
    size: 110
  });
  joystick.on('move', (evt, data) => {
    if (data && data.vector) {
      // x: -1(左)～1(右) → 左右旋回
      // y: -1(上)～1(下) → 上昇/下降
      move.turn = data.vector.x;
      move.up = -data.vector.y;
    }
  });
  joystick.on('end', () => {
    move.turn = 0;
    move.up = 0;
  });

  // 新しいボタン構成に対応
  const fbtn = document.getElementById('forward-btn');
  const missileBtn = document.getElementById('missile-btn');
  const dashBtn = document.getElementById('dash-btn');

  // 前進ボタン
  if (fbtn) {
    fbtn.addEventListener('touchstart', () => move.forward = 1);
    fbtn.addEventListener('touchend', () => move.forward = 0);
    fbtn.addEventListener('mousedown', () => move.forward = 1);
    fbtn.addEventListener('mouseup', () => move.forward = 0);
    fbtn.addEventListener('mouseleave', () => move.forward = 0);
  }

  // ミサイルボタン
  if (missileBtn) {
    // テキスト選択・コピー・シェア等のダイアログ抑制
    missileBtn.addEventListener('touchstart', function(e) {
      fireMissile();
      e.preventDefault();
      e.stopPropagation();
    }, { passive: false });
    missileBtn.addEventListener('mousedown', fireMissile);
    // 長押し時のコンテキストメニュー抑制
    missileBtn.addEventListener('contextmenu', function(e) { e.preventDefault(); });
  }

  // 突撃ボタン
  if (dashBtn) {
    dashBtn.addEventListener('touchstart', startDash);
    dashBtn.addEventListener('mousedown', startDash);
  }
});

// --- 突撃ゲージ ---
let dashGauge = 1.0; // 0.0〜1.0
let dashActive = false;
let dashKeyHeld = false;
const DASH_DECREASE_PER_FRAME = 1 / (2.0 * 60); // 2秒で0になる
const DASH_RECOVER_PER_FRAME = 0.012;

// ボタン押下・離上イベント
function startDash() {
  if (!dashActive && dashGauge > 0) {
    dashActive = true;
    dashKeyHeld = true;
    playDashSound();
    // Add any other dash activation logic here
  }
}

// --- ダッシュ音再生 ---
function playDashSound() {
  const dashAudio = document.getElementById('dash-audio');
  if (dashAudio) {
    dashAudio.currentTime = 0;
    dashAudio.volume = 0.7;
    dashAudio.play().catch(()=>{});
  }
}

// --- ダッシュゲージUI更新 ---
function updateDashGaugeUI() {
  const gauge = document.getElementById('dash-gauge');
  if (gauge) {
    gauge.style.width = Math.max(0, Math.min(1, dashGauge)) * 100 + '%';
    if (dashGauge > 0.7) {
      gauge.style.background = 'linear-gradient(90deg, #6fdc4b 0%, #ffe066 100%)';
    } else if (dashGauge > 0.3) {
      gauge.style.background = 'linear-gradient(90deg, #ff9800 0%, #ffe066 100%)';
    } else {
      gauge.style.background = 'linear-gradient(90deg, #ff4444 0%, #ffe066 100%)';
    }
  }
}

// --- スコア表示用UI更新 ---
let score = 0;
let hp = 5;
const maxHP = 5;
let userCount = 1;
let infoDiv;

// DOMロード時にinfoDiv要素を取得
window.addEventListener('DOMContentLoaded', () => {
  infoDiv = document.getElementById('info');
  // スコア表示を直接更新
  const scoreElement = document.getElementById('score');
  if (scoreElement) {
    scoreElement.textContent = score;
  }
});

function updateInfo() {
  // スコア表示を直接更新
  const scoreElement = document.getElementById('score');
  if (scoreElement) {
    scoreElement.textContent = score;
  }
  
  // 詳細情報表示（オプション）
  if (infoDiv) {
    infoDiv.innerHTML = `スコア: <b>${score}</b>　体力: <b>${hp}</b> / ${maxHP}<br>アクティブユーザー: <b>${userCount}</b><br>WASD/矢印キー：移動・旋回　Space：上昇　Shift：下降`;
  }
}

// --- 右上ランキング表示用divを追加 ---
let rankingDiv;
window.addEventListener('DOMContentLoaded', () => {
  rankingDiv = document.createElement('div');
  rankingDiv.style.position = 'fixed';
  rankingDiv.style.top = '100px';
  rankingDiv.style.right = '10px';
  rankingDiv.style.background = 'rgba(255,255,255,0.85)';
  rankingDiv.style.color = '#333';
  rankingDiv.style.padding = '8px 16px';
  rankingDiv.style.zIndex = 9999;
  rankingDiv.style.fontSize = '16px';
  rankingDiv.style.borderRadius = '8px';
  rankingDiv.style.minWidth = '180px';
  rankingDiv.innerHTML = '<b>ランキング</b><br>---';
  document.body.appendChild(rankingDiv);
});

// --- サーバーからランキング受信 ---
let top3 = [];
function updateRanking() {
  if (!rankingDiv) return;
  let html = '<b>ランキング</b><br>';
  
  if (top3.length === 0) {
    html += '---';
  } else {
    top3.forEach((ent, i) => {
      html += `${i+1}. ${ent.name} <b>${ent.score}</b><br>`;
    });
  }
  
  rankingDiv.innerHTML = html;
}

// --- 鳥の移動制御 ---
window.addEventListener('keydown', (e) => {
  switch (e.code) {
    case 'KeyW': case 'ArrowUp': move.forward = 1; break;
    case 'KeyS': case 'ArrowDown': move.forward = -1; break;
    case 'KeyA': case 'ArrowLeft': move.turn = -1; break;
    case 'KeyD': case 'ArrowRight': move.turn = 1; break;
    case 'Space': move.up = 1; break;
    case 'ShiftLeft': case 'ShiftRight': move.up = -1; break;
    case 'KeyX': fireMissile(); break;
    case 'KeyZ': startDash(); break;
  }
});
window.addEventListener('keyup', (e) => {
  switch (e.code) {
    case 'KeyW': case 'ArrowUp': if (move.forward === 1) move.forward = 0; break;
    case 'KeyS': case 'ArrowDown': if (move.forward === -1) move.forward = 0; break;
    case 'KeyA': case 'ArrowLeft': if (move.turn === -1) move.turn = 0; break;
    case 'KeyD': case 'ArrowRight': if (move.turn === 1) move.turn = 0; break;
    case 'Space': if (move.up === 1) move.up = 0; break;
    case 'ShiftLeft': case 'ShiftRight': if (move.up === -1) move.up = 0; break;
  }
});

// --- 突撃ボタン長押しダッシュモード ---
function dashStart() { startDash(); }

// --- ダッシュ音再生 ---
// function playDashSound() は770行目に定義済み

// --- ダッシュゲージUI更新 ---
// function updateDashGaugeUI() は780行目に定義済み

// --- ミサイル発射音再生 ---
function playShotSound() {
  const shotAudio = document.getElementById('shot-audio');
  if (shotAudio) {
    shotAudio.currentTime = 0;
    shotAudio.volume = 0.5;
    shotAudio.play().catch(()=>{});
  }
}

// --- BGM再生 ---
window.addEventListener('DOMContentLoaded', () => {
  const bgmAudio = document.getElementById('bgm-audio');
  if (bgmAudio) {
    bgmAudio.volume = 1.0; // 2倍(最大値)
    bgmAudio.play().catch(()=>{});
    document.body.addEventListener('click', () => bgmAudio.play(), { once: true });
  }
});

// --- Audioタグ注意 ---
// public/index.html内に <audio id="bgm-audio" src="bgm.mp3"></audio> が存在し、public/bgm.mp3 ファイルも存在するか確認してください。
// 他のAudioも同様にid, src, ファイル名の一致を確認してください。

// --- ミサイル発射処理 ---
function launchLocalMissile(position, direction) {
  const missile = createMissile(position, direction);
  missiles.push(missile);
  scene.add(missile.mesh);
  
  // ミサイルIDを生成
  const missileId = 'missile_' + Math.random().toString(36).substr(2, 9);
  allMissiles[missileId] = {
    mesh: missile.mesh,
    dir: direction.clone(),
    ownerId: myId,
    life: 0
  };
  
  // ミサイルが一定時間後に消えるようにタイマー設定
  setTimeout(() => {
    scene.remove(missile.mesh);
    delete allMissiles[missileId]; // 完全削除
  }, 3000);
  
  return missile;
}

// 他プレイヤーのミサイル発射を処理
function launchOnlineMissile(ownerId, position, direction) {
  const missile = createMissile(position, direction);
  scene.add(missile.mesh);
  
  // ミサイルIDを生成
  const missileId = 'missile_' + Math.random().toString(36).substr(2, 9);
  allMissiles[missileId] = {
    mesh: missile.mesh,
    dir: direction.clone(),
    ownerId: ownerId,
    life: 0
  };
  
  // ミサイルが一定時間後に消えるようにタイマー設定
  setTimeout(() => {
    scene.remove(missile.mesh);
    delete allMissiles[missileId]; // 完全削除
  }, 3000);
}

// ミサイルオブジェクトを作成
function createMissile(position, direction) {
  const geometry = new THREE.CylinderGeometry(0.1, 0.1, 0.8, 8);
  geometry.rotateX(Math.PI / 2);
  const material = new THREE.MeshPhongMaterial({ color: 0xff0000 });
  
  const mesh = new THREE.Mesh(geometry, material);
  
  mesh.position.copy(position);
  mesh.position.y += 0.5; // 少し上から発射
  
  // 方向に合わせて回転
  mesh.lookAt(position.clone().add(direction));
  
  return {
    mesh,
    direction: direction.clone(),
    speed: 1.5,
    life: 0
  };
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- ローカルミサイルの移動
function updateLocalMissiles() {
  for (let i = missiles.length - 1; i >= 0; i--) {
    const m = missiles[i];
    m.mesh.position.addScaledVector(m.direction, m.speed);
    m.life++;
    if (m.life > 60) {
      scene.remove(m.mesh);
      missiles.splice(i, 1);
    }
  }
}

// --- ピア（他プレイヤー）の鳥モデル生成 ---
// function createPeerBird(state) { ... } ← 既存の重複定義を削除

// --- HP/スコア同期時にもハート更新 ---
if (channel) {
  channel.subscribe('hp_score', (msg) => {
    if (msg.data.id === myId) {
      hp = msg.data.hp;
      score = msg.data.score;
      updateInfo();
      updateHeartDisplay(bird, hp);
    } else if (peers[msg.data.id]) {
      peers[msg.data.id].hp = msg.data.hp;
      peers[msg.data.id].score = msg.data.score;
      updateHeartDisplay(peers[msg.data.id], peers[msg.data.id].hp);
      // HPが1以上なら必ず再表示
      if (peers[msg.data.id].hp > 0) {
        peers[msg.data.id].group.visible = true;
      }
    }
  });
}

// --- プレイヤーの可視性管理 ---
function updatePeerVisibility() {
  for (const pid in peers) {
    const peer = peers[pid];
    if (peer) {
      peer.group.visible = peer.hp > 0;
    }
  }
}

// --- プレイヤーがミサイルでヒットしたか判定し、必要に応じて処理を行う ---
function checkPlayerHitByMissile() {
  // ローカルミサイルが自分自身に当たったか判定（多重処理防止のためhp>0のみ）
  if (typeof hp !== 'number' || hp <= 0) return;
  for (let i = missiles.length - 1; i >= 0; i--) {
    const m = missiles[i];
    if (m.mesh.position.distanceTo(bird.position) < 1.8) {
      // サーバーにヒット通知
      if (channel) channel.publish('hit', { targetId: myId });
      scene.remove(m.mesh);
      missiles.splice(i, 1);
      handlePlayerHit(myId); // 自分が撃墜された時の処理
      break;
    }
  }
}

// --- Ably: ヒットイベント受信 ---
if (channel) {
  channel.subscribe('hit', (msg) => {
    const { targetId } = msg.data;
    handlePlayerHit(targetId);
  });
}

animate();

// --- メインゲームループ ---
function animate() {
  try {
    // コイン演出
    const nowRaw = performance.now();
    const now = nowRaw * 0.002;
    for (const c of coins) {
      c.rotation.y += 0.23;
      c.rotation.z += 0.04;
      const h = 0.13 + 0.08 * Math.sin(now + c.position.x);
      if (c.material && c.material.color) {
        c.material.color.setHSL(h, 1.0, 0.7 + 0.12 * Math.sin(now + c.position.z));
        c.material.emissiveIntensity = 1.0 + 0.7 * Math.abs(Math.sin(now*2 + c.position.y));
        c.material.opacity = 0.93 + 0.05 * Math.abs(Math.sin(now*3 + c.position.x));
      }
    }
    // ダッシュモード管理
    if (typeof dashActive !== 'undefined' && typeof dashGauge !== 'undefined') {
      if (dashActive && dashGauge > 0) {
        dashGauge -= DASH_DECREASE_PER_FRAME;
        if (dashGauge <= 0) {
          dashGauge = 0;
          dashActive = false;
          dashKeyHeld = false;
        }
      } else if (!dashActive && dashGauge < 1.0) {
        dashGauge += DASH_RECOVER_PER_FRAME;
        if (dashGauge > 1.0) dashGauge = 1.0;
      }
      if (typeof updateDashGaugeUI === 'function') updateDashGaugeUI();
    }
    // 鳥の移動
    let speed = 0.22;
    if (typeof dashActive !== 'undefined' && dashActive) speed *= 3.0;
    // 旋回慣性用変数
    if (typeof turnSpeed === 'undefined') window.turnSpeed = 0;
    const TURN_ACCEL = 0.0005;
    const TURN_DECAY = 0.92;
    const TURN_MAX = 0.005;
    if (move.turn !== 0) {
      window.turnSpeed += move.turn * TURN_ACCEL;
      if (window.turnSpeed > TURN_MAX) window.turnSpeed = TURN_MAX;
      if (window.turnSpeed < -TURN_MAX) window.turnSpeed = -TURN_MAX;
    } else {
      window.turnSpeed *= TURN_DECAY;
      if (Math.abs(window.turnSpeed) < 0.00005) window.turnSpeed = 0;
    }
    if (typeof bird !== 'undefined') {
      bird.rotation.y -= window.turnSpeed;
      const dir = new THREE.Vector3(Math.sin(bird.rotation.y), 0, Math.cos(bird.rotation.y));
      bird.position.addScaledVector(dir, move.forward * speed);
      bird.position.y += move.up * 0.13;
      bird.position.x = Math.max(-TERRAIN_SIZE/2+2, Math.min(TERRAIN_SIZE/2-2, bird.position.x));
      bird.position.y = Math.max(2, Math.min(80, bird.position.y));
      bird.position.z = Math.max(-TERRAIN_SIZE/2+2, Math.min(TERRAIN_SIZE/2-2, bird.position.z));
      // 衝突判定と多重補正（最大10回）
      let fixCount = 0;
      while (fixCount < 10) {
        const collision = checkCollision(bird.position, 2);
        if (!collision.collided) break;
        let pushDir = bird.position.clone().sub(collision.object.position);
        if (pushDir.lengthSq() < 1e-6) pushDir.set(0, 1, 0);
        pushDir.normalize();
        const safePos = collision.object.position.clone().add(pushDir.multiplyScalar(collision.radius + 2));
        bird.position.copy(safePos);
        fixCount++;
      }
      // カメラ追従
      camera.position.lerp(
        new THREE.Vector3(
          bird.position.x - 12 * Math.sin(bird.rotation.y),
          bird.position.y + 6,
          bird.position.z - 12 * Math.cos(bird.rotation.y)
        ),
        0.15
      );
      camera.lookAt(bird.position);
      // 羽ばたきアニメーション
      if (typeof leftWing !== 'undefined' && typeof rightWing !== 'undefined') {
        wingAngle += 0.15 * wingDir;
        if (wingAngle > 0.7 || wingAngle < -0.7) wingDir *= -1;
        leftWing.rotation.x = wingAngle;
        rightWing.rotation.x = -wingAngle;
      }
    }
    // 車の移動
    if (typeof cars !== 'undefined') {
      cars.forEach((car, i) => {
        car.position.x += 0.45 * Math.cos(car.userData.dir);
        car.position.z += 0.45 * Math.sin(car.userData.dir);
        if (car.position.x > TERRAIN_SIZE/2) car.position.x = -TERRAIN_SIZE/2;
        if (car.position.x < -TERRAIN_SIZE/2) car.position.x = TERRAIN_SIZE/2;
        if (car.position.z > TERRAIN_SIZE/2) car.position.z = -TERRAIN_SIZE/2;
        if (car.position.z < -TERRAIN_SIZE/2) car.position.z = TERRAIN_SIZE/2;
      });
    }
    // 飛行機・ヘリコプターの移動
    if (typeof aircrafts !== 'undefined') {
      for(const a of aircrafts){
        if(a.userData.type==='airplane'){
          const rad = 260 + 110*Math.sin(a.userData.phase);
          const spd = 0.00018 + 0.00012*Math.cos(a.userData.phase);
          a.position.x = Math.cos(nowRaw*spd + a.userData.phase)*rad;
          a.position.z = Math.sin(nowRaw*spd + a.userData.phase)*rad;
          a.position.y = a.userData.baseY + Math.sin(nowRaw*0.001 + a.userData.phase)*6;
          a.rotation.y = Math.PI/2 - (nowRaw*spd + a.userData.phase);
        } else if(a.userData.type==='helicopter'){
          const rad = 120 + 30*Math.sin(a.userData.phase);
          const spd = 0.00023 + 0.00015*Math.cos(a.userData.phase);
          a.position.x = Math.cos(nowRaw*spd + a.userData.phase)*rad;
          a.position.z = Math.sin(nowRaw*spd + a.userData.phase)*rad;
          a.position.y = a.userData.baseY + Math.sin(nowRaw*0.0017 + a.userData.phase)*5;
          a.rotation.y = Math.PI/2 - (nowRaw*spd + a.userData.phase);
          a.children[2].rotation.y = nowRaw*0.04;
          a.children[3].rotation.x = nowRaw*0.12;
        }
      }
    }
    // NPC生成・移動
    if (typeof maintainNPCs === 'function') maintainNPCs();
    if (typeof npcs !== 'undefined') {
      for (const n of npcs) {
        n.position.addScaledVector(n.userData.dir, n.userData.speed);
        if (n.position.x < -TERRAIN_SIZE/2 || n.position.x > TERRAIN_SIZE/2) n.userData.dir.x *= -1;
        if (n.position.y < 3 || n.position.y > 35) n.userData.dir.y *= -1;
        if (n.position.z < -TERRAIN_SIZE/2 || n.position.z > TERRAIN_SIZE/2) n.userData.dir.z *= -1;
      }
    }
    // オンライン同期ミサイルの移動＆当たり判定
    if (typeof allMissiles !== 'undefined') {
      for (const [mid, m] of Object.entries(allMissiles)) {
        m.mesh.position.addScaledVector(m.dir, 1.5);
        m.life++;
        if (m.ownerId !== myId && m.mesh.position.distanceTo(bird.position) < 1.2 && hp > 0) {
          channel && channel.publish('hit', { targetId: myId });
          scene.remove(m.mesh);
          delete allMissiles[mid];
          handlePlayerHit(myId);
          continue;
        }
        if (m.ownerId === myId) {
          for (const pid in peers) {
            const peer = peers[pid];
            if (peer && peer.group && peer.hp > 0 && m.mesh.position.distanceTo(peer.group.position) < 1.2) {
              channel && channel.publish('hit', { targetId: pid });
              scene.remove(m.mesh);
              delete allMissiles[mid];
              break;
            }
          }
        }
        if (m.life > 60) {
          scene.remove(m.mesh);
          delete allMissiles[mid];
        }
      }
    }
    // ローカルミサイルの移動
    if (typeof updateLocalMissiles === 'function') updateLocalMissiles();
    if (typeof checkAllChickenHits === 'function') checkAllChickenHits();
    // 鶏の移動
    if (typeof chickens !== 'undefined') {
      for (const chicken of chickens) {
        if (typeof moveChickenSlowly === 'function') moveChickenSlowly(chicken);
      }
    }
    if (typeof updateMyNameObjPosition === 'function') updateMyNameObjPosition();
    if (typeof updateNameObjPosition === 'function') Object.values(peers).forEach(updateNameObjPosition);
    if (typeof checkCoinCollision === 'function') checkCoinCollision();
    if (typeof checkPlayerHitByMissile === 'function') checkPlayerHitByMissile();
    renderer.render(scene, camera);
  } catch (e) {
    if (!animate.lastError || animate.lastError !== String(e)) {
      animate.lastError = String(e);
      console.error("[animate] エラー発生:", e);
      let errDiv = document.getElementById('error-log');
      if (!errDiv) {
        errDiv = document.createElement('div');
        errDiv.id = 'error-log';
        errDiv.style.position = 'fixed';
        errDiv.style.bottom = '10px';
        errDiv.style.left = '10px';
        errDiv.style.background = 'rgba(255,0,0,0.85)';
        errDiv.style.color = '#fff';
        errDiv.style.padding = '12px 24px';
        errDiv.style.zIndex = 9999;
        errDiv.style.fontSize = '16px';
        errDiv.style.borderRadius = '8px';
        document.body.appendChild(errDiv);
      }
      errDiv.textContent = '[animate] エラー: ' + (e && e.stack ? e.stack : e);
    }
  } finally {
    requestAnimationFrame(animate);
  }
}

animate();

// --- スマホで画面切り替えや閉じる時に通信/BGMを止める ---
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // 通信切断
    if (channel) {
      channel.presence.leave && channel.presence.leave();
      channel.detach && channel.detach();
    }
    if (ably) ably.close && ably.close();
    // BGM停止
    const bgmAudio = document.getElementById('bgm-audio');
    if (bgmAudio && !bgmAudio.paused) bgmAudio.pause();
  }
});
window.addEventListener('beforeunload', () => {
  if (channel) {
    channel.presence.leave && channel.presence.leave();
    channel.detach && channel.detach();
  }
  if (ably) ably.close && ably.close();
  const bgmAudio = document.getElementById('bgm-audio');
  if (bgmAudio && !bgmAudio.paused) bgmAudio.pause();
});

// --- ヒット効果音再生 ---
function playHitSound() {
  const hitAudio = document.getElementById('hit-audio');
  if (hitAudio) {
    hitAudio.currentTime = 0;
    hitAudio.volume = 0.7;
    hitAudio.play().catch(()=>{});
  }
}

// --- 大きなハート回復アイテム管理 ---
const BIG_HEART_COUNT = 2;
let bigHearts = [];

function createBigHeartMesh() {
  const group = new THREE.Group();
  // Heart shape (2 spheres + cone)
  const mat = new THREE.MeshLambertMaterial({ color: 0xff1744, emissive: 0xff1744, emissiveIntensity: 0.6 });
  const left = new THREE.Mesh(new THREE.SphereGeometry(0.6, 20, 20), mat);
  left.position.set(-0.4, 0.6, 0);
  const right = new THREE.Mesh(new THREE.SphereGeometry(0.6, 20, 20), mat);
  right.position.set(0.4, 0.6, 0);
  const bottom = new THREE.Mesh(new THREE.ConeGeometry(0.85, 1.2, 24), mat);
  bottom.position.set(0, -0.15, 0);
  bottom.rotation.x = Math.PI;
  group.add(left); group.add(right); group.add(bottom);
  group.castShadow = true;
  group.receiveShadow = true;
  // Add a glow effect
  const glow = new THREE.Mesh(new THREE.SphereGeometry(1.1, 16, 16), new THREE.MeshBasicMaterial({ color: 0xff8fa3, transparent: true, opacity: 0.28 }));
  group.add(glow);
  return group;
}

function randomBigHeartPosition() {
  let tries = 0, x, z, y;
  do {
    // 安全な範囲でリスポーン（中心±TERRAIN_SIZE*0.45、地形の高さ8-35の範囲）
    x = (Math.random() - 0.5) * TERRAIN_SIZE * 0.9;
    z = (Math.random() - 0.5) * TERRAIN_SIZE * 0.9;
    y = getTerrainHeight(x, z);
    tries++;
  } while ((y < 8 || y > 35) && tries < 10);
  return new THREE.Vector3(x, y + 3.5, z); // 少し浮かせる
}

function spawnBigHearts() {
  // Remove existing
  for (const h of bigHearts) scene.remove(h.mesh);
  bigHearts = [];
  for (let i = 0; i < BIG_HEART_COUNT; i++) {
    const mesh = createBigHeartMesh();
    const pos = randomBigHeartPosition();
    mesh.position.copy(pos);
    mesh.userData = { type: 'bigHeart' };
    scene.add(mesh);
    bigHearts.push({ mesh });
  }
}

function respawnBigHeart(index) {
  const mesh = bigHearts[index].mesh;
  const pos = randomBigHeartPosition();
  mesh.position.copy(pos);
}

function checkBigHeartCollision() {
  for (let i = 0; i < bigHearts.length; i++) {
    const heart = bigHearts[i];
    if (!heart.mesh.visible) continue;
    // Check distance to player
    if (bird.position.distanceTo(heart.mesh.position) < 2.1 && hp < maxHP) {
      hp = maxHP;
      updateInfo();
      updateHeartDisplay(bird, hp);
      // Optionally play a sound
      const audio = document.getElementById('coin-audio');
      if (audio) { audio.currentTime = 0; audio.play().catch(()=>{}); }
      respawnBigHeart(i);
      // Optionally, notify others (multiplayer sync)
    }
  }
}

// --- ゲーム開始時に大ハートも生成 ---
const origStartGame = startGame;
startGame = function() {
  origStartGame();
  spawnBigHearts();
};

// --- 毎フレーム：大ハートの当たり判定 ---
function animate() {
  checkBigHeartCollision();
  // ... (animate関数の残りの部分)
}

// --- ピア（他プレイヤー）のHPラベルは常に表示（HP0でも消さない） ---
function updateNameObjPosition(peer) {
  var pos = peer.group.position.clone();
  pos.y += 2.2;
  pos.project(camera);
  var x = (pos.x * 0.5 + 0.5) * window.innerWidth;
  var y = (-pos.y * 0.5 + 0.5) * window.innerHeight;
  peer.nameObj.element.style.left = (x - 32) + "px";
  peer.nameObj.element.style.top = (y - 18) + "px";
  updateHeartDisplay(peer, peer.hp);
  // HP0でもラベルは非表示にしない
  peer.nameObj.element.style.display = '';
}

// --- ダッシュ用雷エフェクト管理 ---
let dashEffect = null;
function addDashEffect() {
  if (dashEffect) return;
  dashEffect = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffff66, emissive: 0xffffff, emissiveIntensity: 1, transparent: true, opacity: 0.82 });
    const geo = new THREE.CylinderGeometry(0.07, 0.14, 2.4 + Math.random(), 5, 1, true);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(Math.sin(i*1.26)*1.5, 0.7 + Math.random()*1.1, Math.cos(i*1.26)*1.5);
    mesh.rotation.x = Math.PI/2 * Math.random();
    mesh.rotation.z = Math.PI*2 * Math.random();
    dashEffect.add(mesh);
  }
  bird.add(dashEffect);
}
function removeDashEffect() {
  if (dashEffect) {
    bird.remove(dashEffect);
    dashEffect = null;
  }
}

      // --- ダッシュ中の攻撃判定（鶏） ---
      if (dashActive && Array.isArray(chickens)) {
        for (let i = chickens.length - 1; i >= 0; i--) {
          const chicken = chickens[i];
          if (chicken && chicken.position.distanceTo(bird.position) < 3.2) {
            // スコア加算・鶏消滅
            score += chicken.userData.isGold ? 2 : 1;
            updateInfo();
            spawnChickenEffect(chicken.position, chicken.userData.isGold);
            playBakuhaSound();
            scene.remove(chicken);
            chickens.splice(i, 1);
          }
        }
      }
      // カメラ追従
      camera.position.lerp(
        new THREE.Vector3(
          bird.position.x - 12 * Math.sin(bird.rotation.y),
          bird.position.y + 6,
          bird.position.z - 12 * Math.cos(bird.rotation.y)
        ),
        0.15
      );
      camera.lookAt(bird.position);
      // 羽ばたきアニメーション
      if (typeof leftWing !== 'undefined' && typeof rightWing !== 'undefined') {
        wingAngle += 0.15 * wingDir;
        if (wingAngle > 0.7 || wingAngle < -0.7) wingDir *= -1;
        leftWing.rotation.x = wingAngle;
        rightWing.rotation.x = -wingAngle;
      }
    }
    // 車の移動
    if (typeof cars !== 'undefined') {
      cars.forEach((car, i) => {
        car.position.x += 0.45 * Math.cos(car.userData.dir);
        car.position.z += 0.45 * Math.sin(car.userData.dir);
        if (car.position.x > TERRAIN_SIZE/2) car.position.x = -TERRAIN_SIZE/2;
        if (car.position.x < -TERRAIN_SIZE/2) car.position.x = TERRAIN_SIZE/2;
        if (car.position.z > TERRAIN_SIZE/2) car.position.z = -TERRAIN_SIZE/2;
        if (car.position.z < -TERRAIN_SIZE/2) car.position.z = TERRAIN_SIZE/2;
      });
    }
    // 飛行機・ヘリコプターの移動
    if (typeof aircrafts !== 'undefined') {
      for(const a of aircrafts){
        if(a.userData.type==='airplane'){
          const rad = 260 + 110*Math.sin(a.userData.phase);
          const spd = 0.00018 + 0.00012*Math.cos(a.userData.phase);
          a.position.x = Math.cos(nowRaw*spd + a.userData.phase)*rad;
          a.position.z = Math.sin(nowRaw*spd + a.userData.phase)*rad;
          a.position.y = a.userData.baseY + Math.sin(nowRaw*0.001 + a.userData.phase)*6;
          a.rotation.y = Math.PI/2 - (nowRaw*spd + a.userData.phase);
        } else if(a.userData.type==='helicopter'){
          const rad = 120 + 30*Math.sin(a.userData.phase);
          const spd = 0.00023 + 0.00015*Math.cos(a.userData.phase);
          a.position.x = Math.cos(nowRaw*spd + a.userData.phase)*rad;
          a.position.z = Math.sin(nowRaw*spd + a.userData.phase)*rad;
          a.position.y = a.userData.baseY + Math.sin(nowRaw*0.0017 + a.userData.phase)*5;
          a.rotation.y = Math.PI/2 - (nowRaw*spd + a.userData.phase);
          a.children[2].rotation.y = nowRaw*0.04;
          a.children[3].rotation.x = nowRaw*0.12;
        }
      }
    }
    // NPC生成・移動
    if (typeof maintainNPCs === 'function') maintainNPCs();
    if (typeof npcs !== 'undefined') {
      for (const n of npcs) {
        n.position.addScaledVector(n.userData.dir, n.userData.speed);
        if (n.position.x < -TERRAIN_SIZE/2 || n.position.x > TERRAIN_SIZE/2) n.userData.dir.x *= -1;
        if (n.position.y < 3 || n.position.y > 35) n.userData.dir.y *= -1;
        if (n.position.z < -TERRAIN_SIZE/2 || n.position.z > TERRAIN_SIZE/2) n.userData.dir.z *= -1;
      }
    }
    // オンライン同期ミサイルの移動＆当たり判定
    if (typeof allMissiles !== 'undefined') {
      for (const [mid, m] of Object.entries(allMissiles)) {
        m.mesh.position.addScaledVector(m.dir, 1.5);
        m.life++;
        if (m.ownerId !== myId && m.mesh.position.distanceTo(bird.position) < 1.2 && hp > 0) {
          channel && channel.publish('hit', { targetId: myId });
          scene.remove(m.mesh);
          delete allMissiles[mid];
          handlePlayerHit(myId);
          continue;
        }
        if (m.ownerId === myId) {
          for (const pid in peers) {
            const peer = peers[pid];
            if (peer && peer.group && peer.hp > 0 && m.mesh.position.distanceTo(peer.group.position) < 1.2) {
              channel && channel.publish('hit', { targetId: pid });
              scene.remove(m.mesh);
              delete allMissiles[mid];
              break;
            }
          }
        }
        if (m.life > 60) {
          scene.remove(m.mesh);
          delete allMissiles[mid];
        }
      }
    }
    // ローカルミサイルの移動
    if (typeof updateLocalMissiles === 'function') updateLocalMissiles();
    if (typeof checkAllChickenHits === 'function') checkAllChickenHits();
    // 鶏の移動
    if (typeof chickens !== 'undefined') {
      for (const chicken of chickens) {
        if (typeof moveChickenSlowly === 'function') moveChickenSlowly(chicken);
      }
    }
    if (typeof updateMyNameObjPosition === 'function') updateMyNameObjPosition();
    if (typeof updateNameObjPosition === 'function') Object.values(peers).forEach(updateNameObjPosition);
    if (typeof checkCoinCollision === 'function') checkCoinCollision();
    if (typeof checkPlayerHitByMissile === 'function') checkPlayerHitByMissile();
    renderer.render(scene, camera);
  } catch (e) {
    if (!animate.lastError || animate.lastError !== String(e)) {
      animate.lastError = String(e);
      console.error("[animate] エラー発生:", e);
      let errDiv = document.getElementById('error-log');
      if (!errDiv) {
        errDiv = document.createElement('div');
        errDiv.id = 'error-log';
        errDiv.style.position = 'fixed';
        errDiv.style.bottom = '10px';
        errDiv.style.left = '10px';
        errDiv.style.background = 'rgba(255,0,0,0.85)';
        errDiv.style.color = '#fff';
        errDiv.style.padding = '12px 24px';
        errDiv.style.zIndex = 9999;
        errDiv.style.fontSize = '16px';
        errDiv.style.borderRadius = '8px';
        document.body.appendChild(errDiv);
      }
      errDiv.textContent = '[animate] エラー: ' + (e && e.stack ? e.stack : e);
    }
  } finally {
    requestAnimationFrame(animate);
  }
}
