// 3D箱庭バードガーデン
import * as THREE from 'https://cdn.skypack.dev/three@0.152.2';
import 'https://cdnjs.cloudflare.com/ajax/libs/nipplejs/0.9.0/nipplejs.min.js'; // nipplejsをインポート

// --- グローバル変数・定数 ---
const TERRAIN_SIZE = 1000;
const TERRAIN_SEGMENTS = 64;
const MAX_HP = 5;
const DASH_DECREASE_PER_FRAME = 1 / (2.0 * 60); // 2秒で0になる
const DASH_RECOVER_PER_FRAME = 0.012;
const CHICKEN_COLORS = [0xf44336, 0x2196f3, 0x4caf50, 0xffeb3b, 0x9c27b0, 0xff9800, 0x00bcd4];
const CHICKEN_COUNT = 10;
const BIG_HEART_COUNT = 2;

let scene, camera, renderer, canvas;
let terrain;
let bird; // 自プレイヤーの鳥
let peers = {}; // 他プレイヤー { id: { group, nameObj, hp, score, color, name } }
let chickens = []; // 通常・金の鶏
let rainbowChicken = null;
let rainbowChickenTimeout = null;
let coins = [];
let cars = [];
let aircrafts = [];
let npcs = []; // その他のNPC (未使用？)
let bigHearts = []; // 回復ハート

let move = { forward: 0, turn: 0, up: 0 };
let wingAngle = 0;
let wingDir = 1;
let turnSpeed = 0; // 旋回慣性用

let myId = null;
let myName = null;
let myColor = '#ffff66';
let score = 0;
let hp = MAX_HP;
let userCount = 1;
let top3 = []; // ランキング用

let dashGauge = 1.0;
let dashActive = false;
let dashEffect = null;

let ably, channel;

const collisionObjects = []; // 衝突判定用 { object, positionGetter, radius }
const allMissiles = {}; // 同期用ミサイル { id: { mesh, ownerId, dir, life } }
// ローカル専用ミサイル配列は廃止し、allMissilesに統一

// --- DOM要素 ---
let infoDiv, rankingDiv, dashGaugeElement;

// --- 初期化処理 ---

function initGraphics() {
  canvas = document.getElementById('game-canvas');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x87ceeb); // 空色
  renderer.shadowMap.enabled = true; // 影を有効化

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 2000);

  // ライト
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
  scene.add(ambientLight);
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
  dirLight.position.set(40, 80, 40);
  dirLight.castShadow = true; // 影を生成
  // 影の設定 (オプション)
  dirLight.shadow.mapSize.width = 1024;
  dirLight.shadow.mapSize.height = 1024;
  dirLight.shadow.camera.near = 0.5;
  dirLight.shadow.camera.far = 500;
  scene.add(dirLight);
}

function createTerrain() {
  const terrainGeo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS);
  terrainGeo.rotateX(-Math.PI/2);
  const positions = terrainGeo.attributes.position;
  const colors = [];

  for (let i = 0; i < positions.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(positions, i);
    const h = Math.sin(v.x*0.009)*Math.cos(v.z*0.012)*38 + Math.sin(v.x*0.025)*Math.cos(v.z*0.027)*16 + Math.random()*2;
    v.y = h;
    positions.setY(i, v.y);

    // 頂点カラー
    if (h > 30) { colors.push(0.25,0.32,0.18); } // 高地
    else if (h > 12) { colors.push(0.18,0.36,0.13); } // 丘
    else { colors.push(0.13,0.23,0.09); } // 低地
  }
  terrainGeo.computeVertexNormals();
  terrainGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

  const terrainMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  terrain = new THREE.Mesh(terrainGeo, terrainMat);
  terrain.receiveShadow = true; // 地面が影を受ける
  scene.add(terrain);

  // 地形の衝突判定オブジェクト追加
  for (let i = 0; i < positions.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(positions, i);
    if (v.y > 10) { // 中腹以上
      const pos = v.clone().applyMatrix4(terrain.matrixWorld);
      addCollisionObject({position: pos}, 10);
    }
  }
}

// 地形の高さを取得
function getTerrainHeight(x, z) {
    if (!terrain || !terrain.geometry) return 0; // 地形が未生成の場合は0を返す
    const terrainGeo = terrain.geometry;
    // Planeの中心座標系→頂点インデックスを推定
    const fx = (x + TERRAIN_SIZE / 2) / TERRAIN_SIZE * TERRAIN_SEGMENTS;
    const fz = (z + TERRAIN_SIZE / 2) / TERRAIN_SIZE * TERRAIN_SEGMENTS;
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);

    // 範囲チェック
    if (ix < 0 || ix >= TERRAIN_SEGMENTS || iz < 0 || iz >= TERRAIN_SEGMENTS) {
        return 0; // 地形範囲外
    }

    const idx = iz * (TERRAIN_SEGMENTS + 1) + ix;
    if (idx >= 0 && idx < terrainGeo.attributes.position.count) {
        return terrainGeo.attributes.position.getY(idx);
    }
    return 0; // インデックスが無効な場合
}


// --- オブジェクト生成 ---

function placeObjects() {
  // ビル
  for (let i = 0; i < 22; i++) {
    const floors = 5 + Math.floor(Math.random()*12);
    const w = 6 + Math.random()*5;
    const d = 6 + Math.random()*5;
    const h = floors * (2.5 + Math.random()*0.7);
    const geo = new THREE.BoxGeometry(w, h, d);
    const color = 0xcccccc + Math.floor(Math.random()*0x222222);
    const mat = new THREE.MeshLambertMaterial({ color });
    const bld = new THREE.Mesh(geo, mat);
    bld.castShadow = true;
    bld.receiveShadow = true;

    let x, z, y;
    let tries = 0;
    do {
      x = (Math.random()-0.5)*TERRAIN_SIZE*0.55;
      z = (Math.random()-0.5)*TERRAIN_SIZE*0.55;
      y = getTerrainHeight(x,z);
      tries++;
    } while ((y < 8 || y > 25) && tries < 10); // 平坦な場所に

    bld.position.set(x, y + h/2, z);
    scene.add(bld);
    addCollisionObject(bld, Math.max(w, d, h/2));
  }

  // 工場
  for (let i = 0; i < 7; i++) {
    const factory = new THREE.Group();
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(13+Math.random()*6, 5+Math.random()*2, 11+Math.random()*5),
      new THREE.MeshLambertMaterial({ color: 0x888888 })
    );
    base.castShadow = true; base.receiveShadow = true;
    factory.add(base);
    const chimney = new THREE.Mesh(
      new THREE.CylinderGeometry(0.9, 1.2, 9+Math.random()*3, 12),
      new THREE.MeshLambertMaterial({ color: 0x444444 })
    );
    chimney.position.set(3+Math.random()*3, 7, 2-Math.random()*4);
    chimney.castShadow = true;
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
    addCollisionObject(factory, 8); // 半径を少し大きめに
  }

    // 公園
    for (let i = 0; i < 9; i++) {
        const park = new THREE.Group();
        const parkRadius = 8 + Math.random() * 6;
        // 芝生
        const grass = new THREE.Mesh(
            new THREE.CylinderGeometry(parkRadius, parkRadius, 0.6, 24),
            new THREE.MeshLambertMaterial({ color: 0x4caf50 })
        );
        grass.position.y = 0.3;
        grass.receiveShadow = true;
        park.add(grass);
        // ベンチ
        for (let j = 0; j < 2; j++) {
            const bench = new THREE.Mesh(
                new THREE.BoxGeometry(2.8, 0.25, 0.5),
                new THREE.MeshLambertMaterial({ color: 0x8d5524 })
            );
            bench.position.set(-2 + j * 4, 0.55, 2.7 - Math.random() * 5);
            bench.castShadow = true;
            park.add(bench);
        }
        // 木
        for (let j = 0; j < 3; j++) {
            const tree = new THREE.Group();
            const trunk = new THREE.Mesh(
                new THREE.CylinderGeometry(0.22, 0.32, 2.1, 8),
                new THREE.MeshLambertMaterial({ color: 0x8B5A2B })
            );
            trunk.position.y = 1.1;
            trunk.castShadow = true;
            const leaves = new THREE.Mesh(
                new THREE.SphereGeometry(1.1 + Math.random(), 8, 8),
                new THREE.MeshLambertMaterial({ color: 0x388e3c })
            );
            leaves.position.y = 2.2;
            leaves.castShadow = true;
            tree.add(trunk); tree.add(leaves);
            tree.position.set(-3 + Math.random() * 6, 0, -2 + Math.random() * 4);
            park.add(tree);
            addCollisionObject(tree, 1.5); // 木の衝突判定
        }
        // 配置
        let x, z, y, tries = 0;
        do {
            x = (Math.random() - 0.5) * TERRAIN_SIZE * 0.8;
            z = (Math.random() - 0.5) * TERRAIN_SIZE * 0.8;
            y = getTerrainHeight(x, z);
            tries++;
        } while ((y < 3 || y > 17) && tries < 10);
        park.position.set(x, y + 0.3, z);
        scene.add(park);
        addCollisionObject(park, parkRadius); // 公園全体の衝突判定
    }

    // 池
    for (let i = 0; i < 7; i++) {
        const r = 5 + Math.random() * 7;
        const pond = new THREE.Mesh(
            new THREE.CylinderGeometry(r, r * 0.8, 0.7, 28),
            new THREE.MeshLambertMaterial({ color: 0x4fc3f7, transparent: true, opacity: 0.75 })
        );
        let x, z, y, tries = 0;
        do {
            x = (Math.random() - 0.5) * TERRAIN_SIZE * 0.85;
            z = (Math.random() - 0.5) * TERRAIN_SIZE * 0.85;
            y = getTerrainHeight(x, z);
            tries++;
        } while ((y < 2 || y > 12) && tries < 10); // 低地に
        pond.position.set(x, y + 0.35, z);
        scene.add(pond);
        addCollisionObject(pond, r * 0.8); // 半径を形状に合わせる
    }

    // 山
    for (let i = 0; i < 16; i++) {
        const h = 30 + Math.random() * 35;
        const r = 12 + Math.random() * 22;
        const mountainGeo = new THREE.ConeGeometry(r, h, 18);
        let color = 0x888866; // デフォルト
        if (h > 50) color = 0xe0e0e0; // 雪山
        else if (h > 40) color = 0x8d5524; // 茶色
        else color = 0x3d9140; // 緑
        const mountainMat = new THREE.MeshLambertMaterial({ color });
        const mountain = new THREE.Mesh(mountainGeo, mountainMat);
        mountain.castShadow = true;
        mountain.receiveShadow = true;

        const mx = (Math.random() - 0.5) * (TERRAIN_SIZE - 160);
        const mz = (Math.random() - 0.5) * (TERRAIN_SIZE - 160);
        const my = getTerrainHeight(mx, mz) + h / 2 - 2; // 少しめり込ませる
        mountain.position.set(mx, my, mz);
        scene.add(mountain);
        addCollisionObject(mountain, r * 0.8); // 半径を調整

        // 洞窟 (4つに1つ)
        if (i % 4 === 0) {
            const caveGeo = new THREE.TorusGeometry(r * 0.6, 3.5 + Math.random() * 1.5, 14, 30, Math.PI * 1.05);
            const caveMat = new THREE.MeshLambertMaterial({ color: 0x666666, side: THREE.DoubleSide }); // 内側も見えるように
            const cave = new THREE.Mesh(caveGeo, caveMat);
            cave.position.set(mx, my - h * 0.15 + 5, mz); // 少し高めに
            cave.rotation.x = Math.PI / 2 + (Math.random() - 0.5) * 0.5;
            cave.rotation.y = Math.random() * Math.PI * 2;
            scene.add(cave);
            // 洞窟の衝突判定は省略（見た目だけ）
        }
    }

    // 川 (見た目のみ、浅く)
    for (let i = 0; i < 4; i++) {
        const riverGeo = new THREE.BoxGeometry(TERRAIN_SIZE * (0.5 + Math.random() * 0.3), 0.3, 12 + Math.random() * 10);
        const riverMat = new THREE.MeshLambertMaterial({ color: 0x3399ff, transparent: true, opacity: 0.8 });
        const river = new THREE.Mesh(riverGeo, riverMat);
        const rx = (Math.random() - 0.5) * (TERRAIN_SIZE - 200);
        const rz = (Math.random() - 0.5) * (TERRAIN_SIZE - 200);
        const ry = getTerrainHeight(rx, rz) + 0.1; // 地形に沿わせる
        river.position.set(rx, ry, rz);
        river.rotation.y = Math.random() * Math.PI;
        scene.add(river);
        // 川の衝突判定は省略
    }

    // 道路 (見た目のみ、浅く)
    for (let i = 0; i < 5; i++) {
        const roadGeo = new THREE.BoxGeometry(TERRAIN_SIZE * (0.7 + Math.random() * 0.2), 0.2, 7 + Math.random() * 3);
        const roadMat = new THREE.MeshLambertMaterial({ color: 0x444444 });
        const road = new THREE.Mesh(roadGeo, roadMat);
        const rx = (Math.random() - 0.5) * (TERRAIN_SIZE - 100);
        const rz = (Math.random() - 0.5) * (TERRAIN_SIZE - 100);
        const ry = getTerrainHeight(rx, rz) + 0.15; // 地形に沿わせる
        road.position.set(rx, ry, rz);
        road.rotation.y = Math.random() * Math.PI;
        scene.add(road);
        // 道路の衝突判定は省略
    }


  // 家
  for (let i = 0; i < 60; i++) {
    const house = new THREE.Group();
    const baseW = 4 + Math.random() * 2;
    const baseH = 3 + Math.random();
    const baseD = 4 + Math.random() * 2;
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(baseW, baseH, baseD),
      new THREE.MeshLambertMaterial({ color: 0xffe4b5 + Math.floor(Math.random() * 0x2222) })
    );
    base.castShadow = true; base.receiveShadow = true;
    house.add(base);
    const roofH = 2.5 + Math.random();
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(Math.max(baseW, baseD) * 0.6 + Math.random(), roofH, 4),
      new THREE.MeshLambertMaterial({ color: 0xb22222 + Math.floor(Math.random() * 0x2222) })
    );
    roof.position.y = baseH / 2 + roofH / 2;
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    house.add(roof);

    const hx = (Math.random() - 0.5) * (TERRAIN_SIZE - 80);
    const hz = (Math.random() - 0.5) * (TERRAIN_SIZE - 80);
    const hy = getTerrainHeight(hx, hz);
    house.position.set(hx, hy + baseH / 2, hz);
    scene.add(house);
    addCollisionObject(house, Math.max(baseW, baseD, baseH + roofH) / 2 * 0.9); // 半径調整
  }

  // 木
  for (let i = 0; i < 200; i++) {
    const tree = new THREE.Group();
    const trunkH = 3 + Math.random() * 2;
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.5, trunkH, 8),
      new THREE.MeshLambertMaterial({ color: 0x8B5A2B })
    );
    trunk.castShadow = true;
    tree.add(trunk);
    const leavesR = 1.5 + Math.random();
    const leaves = new THREE.Mesh(
      new THREE.SphereGeometry(leavesR, 10, 10),
      new THREE.MeshLambertMaterial({ color: 0x228B22 + Math.floor(Math.random() * 0x1000) })
    );
    leaves.position.y = trunkH / 2 + leavesR * 0.7; // 葉の位置調整
    leaves.castShadow = true;
    tree.add(leaves);

    const tx = (Math.random() - 0.5) * (TERRAIN_SIZE - 40);
    const tz = (Math.random() - 0.5) * (TERRAIN_SIZE - 40);
    const ty = getTerrainHeight(tx, tz);
    tree.position.set(tx, ty + trunkH / 2, tz); // 地表に合わせる
    scene.add(tree);
    addCollisionObject(tree, leavesR); // 葉の半径で判定
  }

  // 雲 (衝突判定は不要かも)
  for (let i = 0; i < 40; i++) {
    const cloud = new THREE.Group();
    for (let j = 0; j < 3 + Math.floor(Math.random() * 4); j++) {
      const part = new THREE.Mesh(
        new THREE.SphereGeometry(2 + Math.random() * 3, 12, 12), // サイズ感を少し大きく
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }) // 少し濃く
      );
      part.position.set(
        (Math.random() - 0.5) * 8, // 広がりを大きく
        (Math.random() - 0.5) * 3,
        (Math.random() - 0.5) * 7
      );
      cloud.add(part);
    }
    cloud.position.set(
      (Math.random() - 0.5) * (TERRAIN_SIZE), // 配置範囲を広げる
      60 + Math.random() * 50, // 高さを少し上げる
      (Math.random() - 0.5) * (TERRAIN_SIZE)
    );
    scene.add(cloud);
    // addCollisionObject(cloud, 8); // 雲との衝突判定はゲーム性に応じて
  }

  // 車
  for (let i = 0; i < 60; i++) {
    const car = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(3.5, 1.2, 1.8),
      new THREE.MeshLambertMaterial({ color: 0x4444ff + Math.floor(Math.random()*0xdddd) }) // 色のバリエーション増加
    );
    body.castShadow = true;
    car.add(body);
    const wheelMat = new THREE.MeshLambertMaterial({ color: 0x222222 });
    for (let j = 0; j < 4; j++) {
      const wheel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.35, 0.35, 0.6, 12),
        wheelMat
      );
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(j < 2 ? -1.2 : 1.2, -0.4, j % 2 === 0 ? -0.9 : 0.9); // タイヤ位置調整
      car.add(wheel);
    }
    const cx = (Math.random() - 0.5) * (TERRAIN_SIZE * 0.9);
    const cz = (Math.random() - 0.5) * (TERRAIN_SIZE * 0.9);
    const cy = getTerrainHeight(cx, cz) + 0.6; // 地表に合わせる
    car.position.set(cx, cy, cz);
    car.rotation.y = Math.random() * Math.PI * 2; // 初期方向をランダムに
    car.userData = { speed: 0.3 + Math.random() * 0.4 }; // 速度もランダムに
    cars.push(car);
    scene.add(car);
    addCollisionObject(car, 2.0); // 車の衝突半径
  }

    // 飛行機
    for (let i = 0; i < 2; i++) {
        const plane = new THREE.Group();
        const body = new THREE.Mesh(
            new THREE.CylinderGeometry(0.7, 0.9, 7, 12),
            new THREE.MeshLambertMaterial({ color: 0xdddddd })
        );
        body.rotation.z = Math.PI / 2;
        body.castShadow = true;
        plane.add(body);
        const wing = new THREE.Mesh(
            new THREE.BoxGeometry(6, 0.2, 1.1),
            new THREE.MeshLambertMaterial({ color: 0x1976d2 })
        );
        wing.castShadow = true;
        plane.add(wing);
        const tail = new THREE.Mesh(
            new THREE.BoxGeometry(1.3, 0.15, 0.7),
            new THREE.MeshLambertMaterial({ color: 0x1976d2 })
        );
        tail.position.set(-3.2, 0.4, 0);
        tail.rotation.z = Math.PI / 10;
        tail.castShadow = true;
        plane.add(tail);
        plane.position.set((Math.random() - 0.5) * TERRAIN_SIZE * 0.7, 80 + Math.random() * 40, (Math.random() - 0.5) * TERRAIN_SIZE * 0.7); // 高く
        plane.userData = { type: 'airplane', baseY: plane.position.y, phase: Math.random() * Math.PI * 2, speedFactor: 0.8 + Math.random() * 0.4 };
        scene.add(plane);
        aircrafts.push(plane);
        addCollisionObject(plane, 4); // 衝突半径調整
    }

    // ヘリコプター
    for (let i = 0; i < 2; i++) {
        const heli = new THREE.Group();
        const body = new THREE.Mesh(
            new THREE.CylinderGeometry(0.7, 0.9, 4.5, 10),
            new THREE.MeshLambertMaterial({ color: 0x388e3c })
        );
        body.rotation.z = Math.PI / 2;
        body.castShadow = true;
        heli.add(body);
        const cockpit = new THREE.Mesh(
            new THREE.SphereGeometry(0.9, 10, 10),
            new THREE.MeshLambertMaterial({ color: 0xb2dfdb })
        );
        cockpit.position.set(2.2, 0, 0);
        cockpit.castShadow = true;
        heli.add(cockpit);
        const rotor = new THREE.Mesh( // メインローター
            new THREE.BoxGeometry(5.5, 0.12, 0.22),
            new THREE.MeshLambertMaterial({ color: 0x222222 })
        );
        rotor.position.y = 0.7;
        heli.add(rotor);
        const tailRotor = new THREE.Mesh( // テールローター
            new THREE.BoxGeometry(0.12, 0.8, 0.18),
            new THREE.MeshLambertMaterial({ color: 0x222222 })
        );
        tailRotor.position.set(-2.2, 0.15, 0.0);
        tailRotor.rotation.z = Math.PI / 2;
        heli.add(tailRotor);
        heli.position.set((Math.random() - 0.5) * TERRAIN_SIZE * 0.7, 55 + Math.random() * 35, (Math.random() - 0.5) * TERRAIN_SIZE * 0.7); // 高く
        heli.userData = { type: 'helicopter', baseY: heli.position.y, phase: Math.random() * Math.PI * 2, speedFactor: 0.7 + Math.random() * 0.6 };
        scene.add(heli);
        aircrafts.push(heli);
        addCollisionObject(heli, 3.5); // 衝突半径調整
    }
}


// --- 鳥モデル生成 (共通化) ---
function createBirdModel(color = 0xffff66) {
    const birdGroup = new THREE.Group();
    // 体
    const bodyMat = new THREE.MeshLambertMaterial({ color: color });
    const body = new THREE.Mesh(new THREE.SphereGeometry(1.1, 18, 18), bodyMat);
    body.castShadow = true;
    birdGroup.add(body);
    // 頭
    const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.6, 14, 14),
        new THREE.MeshLambertMaterial({ color: 0xffff99 }) // 頭の色は固定
    );
    head.position.set(0, 0.8, 0.7);
    head.castShadow = true;
    birdGroup.add(head);
    // くちばし
    const beak = new THREE.Mesh(
        new THREE.ConeGeometry(0.18, 0.5, 8),
        new THREE.MeshLambertMaterial({ color: 0xff9933 })
    );
    beak.position.set(0, 0.7, 1.25);
    beak.castShadow = true;
    birdGroup.add(beak);
    // 羽
    const wingMat = new THREE.MeshLambertMaterial({ color: 0xfff799 }); // 羽の色は固定
    const leftWing = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.3, 2.2), wingMat);
    leftWing.position.set(-1.1, 0.3, 0);
    leftWing.rotation.z = Math.PI / 8;
    leftWing.castShadow = true;
    birdGroup.add(leftWing);
    const rightWing = leftWing.clone();
    rightWing.position.x *= -1;
    rightWing.rotation.z *= -1;
    birdGroup.add(rightWing);
    // しっぽ
    const tail = new THREE.Mesh(
        new THREE.ConeGeometry(0.18, 0.7, 8),
        new THREE.MeshLambertMaterial({ color: 0xcccc99 }) // しっぽの色は固定
    );
    tail.position.set(0, -0.2, -1.2);
    tail.rotation.x = Math.PI;
    tail.castShadow = true;
    birdGroup.add(tail);

    // userDataにウィングへの参照を保存
    birdGroup.userData.leftWing = leftWing;
    birdGroup.userData.rightWing = rightWing;

    return birdGroup;
}

function setupPlayerBird() {
    bird = createBirdModel(myColor); // 初期色で生成
    bird.position.set(0, 40, 0); // 初期高度を上げる
    scene.add(bird);
    addCollisionObject(bird, 1.5); // プレイヤーの衝突半径
    // 名前ラベル作成
    createNameObj(bird, myName, hp);
}

function setBirdColor(birdGroup, color) {
    if (birdGroup && birdGroup.children[0] && birdGroup.children[0].material) {
        birdGroup.children[0].material.color.set(color); // 体の色のみ変更
    }
}


// --- 衝突判定 ---
function addCollisionObject(object, radius) {
    collisionObjects.push({
        object: object,
        // positionGetter を使って常に最新のワールド座標を取得
        get position() {
            if (this.object.isObject3D) { // THREE.Object3Dかチェック
                return this.object.getWorldPosition(new THREE.Vector3());
            }
            return this.object.position || new THREE.Vector3(); // フォールバック
        },
        radius: radius
    });
}


function checkCollision(position, radius) {
    // 地形との衝突判定 (Y座標のみ)
    const terrainHeight = getTerrainHeight(position.x, position.z);
    if (position.y < terrainHeight + radius) {
        return {
            collided: true,
            object: terrain, // 衝突相手は地形
            position: new THREE.Vector3(position.x, terrainHeight, position.z), // 衝突点のY座標
            radius: radius, // プレイヤーの半径
            isTerrain: true
        };
    }

    // 他のオブジェクトとの衝突判定
    for (const objInfo of collisionObjects) {
        // 自分自身、または非表示オブジェクトとの衝突は無視
        if (!objInfo.object || objInfo.object === bird || (objInfo.object.isObject3D && !objInfo.object.visible)) {
            continue;
        }

        const objPosition = objInfo.position; // getterで最新位置取得
        const distanceSq = position.distanceToSquared(objPosition); // 平方距離で比較
        const minDistance = radius + objInfo.radius;

        if (distanceSq < minDistance * minDistance) {
            return {
                collided: true,
                object: objInfo.object,
                position: objPosition, // 衝突相手の位置
                radius: objInfo.radius, // 衝突相手の半径
                isTerrain: false
            };
        }
    }
    return { collided: false };
}


function handleCollisionResponse(currentPos, collisionInfo, playerRadius) {
    if (!collisionInfo.collided) return currentPos;

    const pushStrength = 1.05; // 押し出しの強さ（めり込み防止）
    let safePos;

    if (collisionInfo.isTerrain) {
        // 地形との衝突：単純に Y 座標を押し上げる
        safePos = currentPos.clone();
        safePos.y = collisionInfo.position.y + playerRadius * pushStrength; // 地面より少し上に
    } else {
        // オブジェクトとの衝突：衝突点から離れる方向に押し出す
        const collisionPoint = collisionInfo.position;
        const objectRadius = collisionInfo.radius;
        const pushDir = currentPos.clone().sub(collisionPoint);

        // ゼロベクトル回避
        if (pushDir.lengthSq() < 1e-6) {
            pushDir.set(0, 1, 0); // 真上方向に押し出す
        }
        pushDir.normalize();

        // 安全な位置 = 相手の中心 + (自分の半径 + 相手の半径) * 方向ベクトル * 押し出し係数
        safePos = collisionPoint.clone().addScaledVector(pushDir, (playerRadius + objectRadius) * pushStrength);

        // 地形より下にめり込まないように Y 座標を再チェック
        const terrainHeight = getTerrainHeight(safePos.x, safePos.z);
        if (safePos.y < terrainHeight + playerRadius) {
            safePos.y = terrainHeight + playerRadius;
        }
    }
    return safePos;
}


// --- 名前ラベル & HP表示 ---
function createNameObj(targetGroup, name, initialHp = MAX_HP) {
    let div = document.createElement('div');
    div.className = 'bird-name-label';
    // スタイル設定 (CSSで管理推奨)
    div.style.position = 'absolute';
    div.style.fontSize = '14px'; // 少し小さく
    div.style.fontWeight = 'bold';
    div.style.color = '#ffffff'; // 白文字
    div.style.background = 'rgba(0,0,0,0.6)'; // 半透明黒背景
    div.style.borderRadius = '4px';
    div.style.padding = '3px 8px';
    div.style.pointerEvents = 'none';
    div.style.textAlign = 'center';
    div.style.textShadow = '1px 1px 2px rgba(0,0,0,0.8)'; // テキストシャドウ

    let heartDiv = document.createElement('div');
    heartDiv.className = 'bird-hp-hearts';
    heartDiv.style.fontSize = '16px'; // ハートサイズ調整
    heartDiv.style.lineHeight = '1';
    heartDiv.style.marginBottom = '2px';
    div.appendChild(heartDiv);

    let nameSpan = document.createElement('span');
    nameSpan.textContent = name;
    div.appendChild(nameSpan);

    document.body.appendChild(div);

    // userDataに格納
    const nameObj = {
        element: div,
        target: targetGroup, // 参照するオブジェクト
        heartDiv: heartDiv,
        nameSpan: nameSpan
    };
    targetGroup.userData.nameObj = nameObj;

    updateHeartDisplay(nameObj, initialHp); // 初期HP表示
    return nameObj;
}

function updateHeartDisplay(nameObj, hpVal) {
    if (!nameObj || !nameObj.heartDiv) return;

    let hearts = '';
    const currentHp = Math.max(0, Math.min(MAX_HP, hpVal)); // HPを範囲内に収める
    for (let i = 0; i < MAX_HP; i++) {
        hearts += i < currentHp ? '&#x2764;' : '&#x2661;';
    }
    // スタイルを直接指定する代わりにクラスで管理も可能
    nameObj.heartDiv.innerHTML = `<span style='color:#ff6b6b; text-shadow: 0 0 3px #ffffff;'>${hearts}</span>`;
}


function updateNameObjPosition(nameObj) {
    if (!nameObj || !nameObj.target || !nameObj.element) return;

    const target = nameObj.target;
    const element = nameObj.element;

    // オブジェクトが非表示、またはHPが0以下ならラベルも非表示 (自分のラベルは除く)
    if (target !== bird && (!target.visible || (target.userData && target.userData.hp <= 0))) {
        element.style.display = 'none';
        return;
    }
    element.style.display = ''; // 表示状態に戻す

    // スクリーン座標に変換
    const pos = target.position.clone();
    pos.y += 2.5; // オブジェクトの上方に表示
    pos.project(camera);

    // [-1, 1] の範囲外なら表示しない (画面外)
    if (Math.abs(pos.x) > 1 || Math.abs(pos.y) > 1 || pos.z > 1) {
         element.style.display = 'none';
         return;
    }

    const x = (pos.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-pos.y * 0.5 + 0.5) * window.innerHeight;

    // 要素の中央が (x, y) に来るように調整
    element.style.left = `${x - element.offsetWidth / 2}px`;
    element.style.top = `${y - element.offsetHeight / 2}px`;
}


function updateAllNameObjPositions() {
    // 自分のラベル更新
    if (bird && bird.userData.nameObj) {
        updateNameObjPosition(bird.userData.nameObj);
        // 自分のHPも更新
        updateHeartDisplay(bird.userData.nameObj, hp);
    }
    // 他プレイヤーのラベル更新
    for (const peerId in peers) {
        const peer = peers[peerId];
        if (peer && peer.nameObj) {
            updateNameObjPosition(peer.nameObj);
            // ピアのHPも更新
            updateHeartDisplay(peer.nameObj, peer.hp);
        }
    }
}


// --- 鶏 ---
function createChicken(isGold = false) {
    const chicken = new THREE.Group();
    const color = isGold ? 0xffe066 : CHICKEN_COLORS[Math.floor(Math.random() * CHICKEN_COLORS.length)];
    const headColor = isGold ? 0xffff99 : 0xffffff;

    // 体
    const bodyMat = new THREE.MeshLambertMaterial({ color: color });
    if (isGold) {
        bodyMat.emissive = new THREE.Color(0xfff700);
        bodyMat.emissiveIntensity = 0.6;
    }
    const body = new THREE.Mesh(new THREE.SphereGeometry(2.2, 18, 18), bodyMat);
    body.castShadow = true;
    chicken.add(body);
    // 頭
    const head = new THREE.Mesh(
        new THREE.SphereGeometry(1.2, 14, 14),
        new THREE.MeshLambertMaterial({ color: headColor })
    );
    head.position.set(0, 1.6, 1.4);
    head.castShadow = true;
    chicken.add(head);
    // くちばし
    const beak = new THREE.Mesh(
        new THREE.ConeGeometry(0.36, 1.0, 8),
        new THREE.MeshLambertMaterial({ color: 0xff9933 })
    );
    beak.position.set(0, 1.4, 2.5);
    beak.castShadow = true;
    chicken.add(beak);
    // 羽
    const wingMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const leftWing = new THREE.Mesh(new THREE.BoxGeometry(0.4, 2.6, 4.4), wingMat);
    leftWing.position.set(-2.2, 0.6, 0);
    leftWing.rotation.z = Math.PI / 8;
    leftWing.castShadow = true;
    chicken.add(leftWing);
    const rightWing = leftWing.clone();
    rightWing.position.set(2.2, 0.6, 0);
    rightWing.rotation.z = -Math.PI / 8;
    chicken.add(rightWing);

    chicken.userData = {
        type: 'chicken',
        isGold: isGold,
        // 移動用パラメータ
        basePos: null,
        phase: Math.random() * Math.PI * 2,
        radius: 55 + Math.random() * 60,
        speed: 0.00015 + Math.random() * 0.00009,
        height: 38 + Math.random() * 20
    };
    return chicken;
}


function randomChickenPosition() {
    // X,Z: 中心±TERRAIN_SIZE*0.4, Y: 40〜80の空中
    const x = (Math.random() - 0.5) * TERRAIN_SIZE * 0.8;
    const z = (Math.random() - 0.5) * TERRAIN_SIZE * 0.8;
    const y = 40 + Math.random() * 40;
    return new THREE.Vector3(x, y, z);
}

function spawnChickens() {
    // 既存の鶏を削除
    for (let i = chickens.length - 1; i >= 0; i--) {
        scene.remove(chickens[i]);
        // collisionObjectsからも削除 (より安全な方法を検討)
        const index = collisionObjects.findIndex(co => co.object === chickens[i]);
        if (index > -1) collisionObjects.splice(index, 1);
    }
    chickens = [];

    // 新しく生成
    for (let i = 0; i < CHICKEN_COUNT; i++) {
        const isGold = (i === 0); // 1体だけ金色
        const chicken = createChicken(isGold);
        chicken.position.copy(randomChickenPosition());
        chicken.userData.basePos = chicken.position.clone(); // 初期位置をベース位置に
        chickens.push(chicken);
        scene.add(chicken);
        addCollisionObject(chicken, 3.5); // 鶏の衝突半径
    }
}

function moveChicken(chicken) {
    const userData = chicken.userData;
    if (!userData.basePos) return; // 初期化前は無視

    const now = performance.now();
    const angle = now * userData.speed + userData.phase;
    chicken.position.x = userData.basePos.x + Math.cos(angle) * userData.radius;
    chicken.position.z = userData.basePos.z + Math.sin(angle) * userData.radius;
    chicken.position.y = userData.height + Math.sin(now * 0.0008 + userData.phase) * 7;

    // 進行方向を向くように回転 (atan2で角度計算)
    const nextX = userData.basePos.x + Math.cos(angle + 0.01) * userData.radius; // 少し先のX
    const nextZ = userData.basePos.z + Math.sin(angle + 0.01) * userData.radius; // 少し先のZ
    chicken.rotation.y = Math.atan2(nextX - chicken.position.x, nextZ - chicken.position.z);
}


function spawnHitEffect(pos, color = 0xffffff, count = 8, size = 0.5, duration = 500) {
    for (let i = 0; i < count; i++) {
        const geo = new THREE.SphereGeometry(size * (0.8 + Math.random() * 0.4), 6, 6);
        const mat = new THREE.MeshBasicMaterial({
            color: color,
            transparent: true,
            opacity: 0.9
        });
        const particle = new THREE.Mesh(geo, mat);
        particle.position.copy(pos);
        // ランダムな方向に飛び散る速度ベクトル
        const velocity = new THREE.Vector3(
            (Math.random() - 0.5),
            (Math.random() - 0.5),
            (Math.random() - 0.5)
        ).normalize().multiplyScalar(0.1 + Math.random() * 0.2);

        scene.add(particle);

        const startTime = performance.now();
        function animateParticle() {
            const elapsed = performance.now() - startTime;
            const progress = elapsed / duration;

            if (progress >= 1) {
                scene.remove(particle);
                return;
            }

            particle.position.add(velocity);
            velocity.y -= 0.005; // 重力っぽく落下
            particle.material.opacity = 0.9 * (1 - progress); // 徐々に消える

            requestAnimationFrame(animateParticle);
        }
        animateParticle();
    }
}

// --- 虹色チキン ---
function createRainbowChicken() {
  const chicken = new THREE.Group();
  // 体 (大きく、虹色マテリアル)
  const bodyMat = new THREE.MeshPhongMaterial({
      color: 0xffffff,
      shininess: 90,
      vertexColors: false // 頂点色は使わない
  });
  // onBeforeCompileでシェーダーをカスタマイズ
  bodyMat.onBeforeCompile = shader => {
      shader.uniforms.time = { value: 0 }; // 時間uniform追加
      shader.vertexShader = 'varying vec2 vUv;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvUv = uv;'
      );
      shader.fragmentShader = 'uniform float time;\nvarying vec2 vUv;\n' + shader.fragmentShader;
      // HSV to RGB 変換関数 (GLSL)
      shader.fragmentShader = `
          vec3 hsv2rgb(vec3 c) {
              vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
              vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
              return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
          }
      ` + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
          'vec4 diffuseColor = vec4( diffuse, opacity );',
          `
          float hue = mod((vUv.y - vUv.x) * 2.5 + time * 0.1, 1.0); // 虹色の計算
          vec3 rainbow = hsv2rgb(vec3(hue, 0.9, 1.0)); // 彩度・明度調整
          vec4 diffuseColor = vec4( rainbow, opacity );
          `
      );
      // マテリアルにuniformsをアタッチ
      chicken.userData.shader = shader;
  };

  const body = new THREE.Mesh(new THREE.SphereGeometry(4.4, 24, 24), bodyMat); // 大きく滑らかに
  body.castShadow = true;
  chicken.add(body);

  // 頭
  const head = new THREE.Mesh(
      new THREE.SphereGeometry(2.4, 18, 18),
      new THREE.MeshLambertMaterial({ color: 0xffffff })
  );
  head.position.set(0, 3.2, 2.8);
  head.castShadow = true;
  chicken.add(head);
  // くちばし
  const beak = new THREE.Mesh(
      new THREE.ConeGeometry(0.72, 2.0, 10),
      new THREE.MeshLambertMaterial({ color: 0xff9933 })
  );
  beak.position.set(0, 2.8, 5.0);
  beak.castShadow = true;
  chicken.add(beak);
  // 羽
  const wingMat = new THREE.MeshLambertMaterial({ color: 0xf0f0f0 }); // 少しグレーがかった白
  const leftWing = new THREE.Mesh(new THREE.BoxGeometry(0.8, 5.2, 8.8), wingMat);
  leftWing.position.set(-4.4, 1.2, 0);
  leftWing.rotation.z = Math.PI / 8;
  leftWing.castShadow = true;
  chicken.add(leftWing);
  const rightWing = leftWing.clone();
  rightWing.position.set(4.4, 1.2, 0);
  rightWing.rotation.z = -Math.PI / 8;
  chicken.add(rightWing);

  chicken.userData = {
      type: 'rainbow',
      isRainbow: true,
      hp: 2, // 耐久力
      lastHitPlayer: null, // 最後に攻撃したプレイヤーID
      shader: null, // シェーダー参照用 (onBeforeCompileで設定)
      // 移動用パラメータ (少し速く、異なるパターン)
      basePos: null,
      phase: Math.random() * Math.PI * 2,
      radius: 80 + Math.random() * 70,
      speed: 0.00013 + Math.random() * 0.00007,
      height: 45 + Math.random() * 25
  };
  return chicken;
}

function spawnRainbowChicken() {
  if (rainbowChicken) removeRainbowChicken(); // 既存のがあれば削除

  rainbowChicken = createRainbowChicken();
  rainbowChicken.position.copy(randomChickenPosition()); // 通常チキンと同じ出現ロジック
  rainbowChicken.userData.basePos = rainbowChicken.position.clone();
  scene.add(rainbowChicken);
  addCollisionObject(rainbowChicken, 6.0); // 虹色チキンの衝突半径
  console.log("虹色チキン出現！");
}


function removeRainbowChicken() {
    if (rainbowChicken) {
        scene.remove(rainbowChicken);
        // collisionObjectsからも削除
        const index = collisionObjects.findIndex(co => co.object === rainbowChicken);
        if (index > -1) collisionObjects.splice(index, 1);
        rainbowChicken = null;
        console.log("虹色チキン消滅...");
    }
}

function scheduleRainbowChickenRespawn() {
    if (rainbowChickenTimeout) clearTimeout(rainbowChickenTimeout);
    const respawnDelay = 5 * 60 * 1000; // 5分後
    console.log(`次の虹色チキンは ${respawnDelay / 1000 / 60} 分後に出現します`);
    rainbowChickenTimeout = setTimeout(() => {
        spawnRainbowChicken();
    }, respawnDelay);
}

// --- 回復ハート ---
function createBigHeartMesh() {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ // StandardMaterialで見栄え良く
      color: 0xff1744,
      emissive: 0xcc0033, // 発光色を少し暗めに
      emissiveIntensity: 0.5,
      roughness: 0.4, // 少しざらついた質感
      metalness: 0.1
  });

  const heartShape = new THREE.Shape();
  const x = 0, y = -0.5; // 基準点調整
  heartShape.moveTo(x, y + 0.5);
  heartShape.bezierCurveTo(x, y + 0.8, x - 0.6, y + 1.2, x - 0.8, y + 0.8);
  heartShape.arc(0.4, 0, 0.4, Math.PI, 0, false); // 上の丸み(右)
  heartShape.bezierCurveTo(x + 0.6, y + 1.2, x, y + 0.8, x, y + 0.5); // 対象性はないかも？微調整

    // 別の方法：押し出しジオメトリ
    const extrudeSettings = { depth: 0.3, bevelEnabled: true, bevelSegments: 2, steps: 2, bevelSize: 0.1, bevelThickness: 0.1 };
    const geometry = new THREE.ExtrudeGeometry( heartShape, extrudeSettings );
    geometry.center(); // 中心を原点に
    geometry.rotateX(Math.PI); // 上下反転させる

    const heartMesh = new THREE.Mesh( geometry, mat );
    heartMesh.scale.set(1.3, 1.3, 1.3); // 少し大きく
    heartMesh.castShadow = true;
    group.add( heartMesh );

    // グロー効果 (ポイントライトで代用も可)
    const glow = new THREE.Mesh(
        new THREE.SphereGeometry(1.4, 16, 16), // 大きめ
        new THREE.MeshBasicMaterial({
            color: 0xff8fa3,
            transparent: true,
            opacity: 0.25,
            depthWrite: false // 他のオブジェクトに隠れないように
        })
    );
    group.add(glow);

    group.userData.type = 'bigHeart';
    return group;
}

function randomBigHeartPosition() {
  let tries = 0, x, z, y;
  do {
    // X,Z: 中心±TERRAIN_SIZE*0.45, Y: 地形高さ 8～35 の範囲
    x = (Math.random() - 0.5) * TERRAIN_SIZE * 0.9;
    z = (Math.random() - 0.5) * TERRAIN_SIZE * 0.9;
    y = getTerrainHeight(x, z);
    tries++;
    // 条件: 地形が見つかり、高さが範囲内で、かつ水面(y<2など)でない
  } while ((y < 8 || y > 35 || y < 2) && tries < 20);

  // もし適切な場所が見つからなければデフォルト位置
  if (tries >= 20) return new THREE.Vector3(0, 20, 0);

  return new THREE.Vector3(x, y + 3.5, z); // 地表から少し浮かせる
}


function spawnBigHearts() {
    // 既存のハートを削除
    for (let i = bigHearts.length - 1; i >= 0; i--) {
        scene.remove(bigHearts[i].mesh);
        // collisionObjectsからも削除
        const index = collisionObjects.findIndex(co => co.object === bigHearts[i].mesh);
        if (index > -1) collisionObjects.splice(index, 1);
    }
    bigHearts = [];

    // 新しく生成
    for (let i = 0; i < BIG_HEART_COUNT; i++) {
        const mesh = createBigHeartMesh();
        const pos = randomBigHeartPosition();
        mesh.position.copy(pos);
        scene.add(mesh);
        const heartData = { mesh: mesh, respawnTimer: null };
        bigHearts.push(heartData);
        addCollisionObject(mesh, 1.8); // ハートの衝突半径
    }
}

function respawnBigHeart(index) {
    if (index < 0 || index >= bigHearts.length) return;

    const heartData = bigHearts[index];
    heartData.mesh.visible = false; // 一時的に非表示

    // 既にリスポーンタイマーが設定されていればクリア
    if (heartData.respawnTimer) clearTimeout(heartData.respawnTimer);

    const respawnDelay = 20000; // 20秒後に再出現
    heartData.respawnTimer = setTimeout(() => {
        const newPos = randomBigHeartPosition();
        heartData.mesh.position.copy(newPos);
        heartData.mesh.visible = true; // 再表示
        heartData.respawnTimer = null; // タイマーリセット
        console.log(`ハート #${index} 再出現`);
    }, respawnDelay);
    console.log(`ハート #${index} 取得。${respawnDelay / 1000}秒後に再出現`);
}


// --- ミサイル ---
function createMissileMesh(isOwner) {
    const color = isOwner ? 0xff4444 : 0x4444ff; // 自分:赤, 他:青
    const geometry = new THREE.CylinderGeometry(0.12, 0.12, 1.0, 8); // 少し太く短く
    geometry.rotateX(Math.PI / 2); // 前方を向くように回転
    const material = new THREE.MeshPhongMaterial({ // Phongで見栄え良く
        color: color,
        emissive: color, // 発光
        emissiveIntensity: 0.6,
        shininess: 60
     });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    return mesh;
}

function launchMissile(ownerId, position, direction) {
    const isOwner = (ownerId === myId);
    const missileId = `m_${ownerId}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
    const mesh = createMissileMesh(isOwner);

    // 初期位置: プレイヤーの前方少し上
    const offsetDir = direction.clone().normalize();
    const startPos = position.clone().addScaledVector(offsetDir, 1.5); // 前方へ
    startPos.y += 0.5; // 少し上へ
    mesh.position.copy(startPos);

    // 進行方向に向ける
    mesh.lookAt(startPos.clone().add(direction));

    scene.add(mesh);

    allMissiles[missileId] = {
        id: missileId,
        mesh: mesh,
        ownerId: ownerId,
        dir: direction.clone().normalize(), // 正規化して保存
        speed: 2.0, // ミサイル速度
        life: 0, // 経過フレーム数 or 経過時間
        maxLife: 120 // 生存フレーム数 (約2秒)
    };

    if (isOwner) {
        playShotSound();
        // Ablyで送信 (自プレイヤーの場合のみ)
        if (channel) {
            channel.publish('fire', {
                id: missileId, // 生成したIDを送る
                owner: ownerId,
                x: startPos.x,
                y: startPos.y,
                z: startPos.z,
                dx: direction.x,
                dy: direction.y,
                dz: direction.z
            });
        }
    }
}

function updateMissiles() {
    const missileIdsToDelete = [];
    for (const missileId in allMissiles) {
        const m = allMissiles[missileId];
        if (!m || !m.mesh) {
            missileIdsToDelete.push(missileId);
            continue;
        }

        // 移動
        m.mesh.position.addScaledVector(m.dir, m.speed);
        m.life++;

        // 寿命 or 地形衝突判定
        const terrainHeight = getTerrainHeight(m.mesh.position.x, m.mesh.position.z);
        if (m.life > m.maxLife || m.mesh.position.y < terrainHeight + 0.2) {
            missileIdsToDelete.push(missileId);
            spawnHitEffect(m.mesh.position, 0xffaa00, 5, 0.3, 300); // 地面ヒットエフェクト
            playBakuhaSound(0.4); // 小さめの爆発音
            continue;
        }

        // --- 当たり判定 ---
        let hit = false;

        // プレイヤーへの当たり判定 (自分以外が撃ったミサイル)
        if (m.ownerId !== myId && hp > 0) {
            if (m.mesh.position.distanceToSquared(bird.position) < (1.5 + 0.5)**2) { // 半径和の2乗で比較
                handlePlayerHit(myId, m.ownerId); // 誰に撃たれたかを渡す
                missileIdsToDelete.push(missileId);
                hit = true;
            }
        }

        // 他プレイヤーへの当たり判定 (自分が撃ったミサイル)
        if (m.ownerId === myId && !hit) {
            for (const peerId in peers) {
                const peer = peers[peerId];
                // peerが存在し、HPがあり、表示されているかチェック
                if (peer && peer.hp > 0 && peer.group && peer.group.visible) {
                   if (m.mesh.position.distanceToSquared(peer.group.position) < (1.5 + 0.5)**2) {
                        // Ablyでヒット通知 (誰が誰に当てたか)
                        if (channel) {
                            channel.publish('hit', { targetId: peerId, attackerId: myId });
                        }
                        // ミサイル削除のみ (実際のHP減少は受信側で)
                        missileIdsToDelete.push(missileId);
                        hit = true;
                        spawnHitEffect(m.mesh.position, 0xff0000, 8, 0.4, 400); // ヒットエフェクト
                        break; // 1発で複数には当たらない
                    }
                }
            }
        }

        // 鶏への当たり判定
        if (!hit) {
           // 通常・金の鶏
           for (let i = chickens.length - 1; i >= 0; i--) {
               const chicken = chickens[i];
               if (m.mesh.position.distanceToSquared(chicken.position) < (3.5 + 0.5)**2) {
                    const points = chicken.userData.isGold ? 2 : 1;
                    if (m.ownerId === myId) { // 自分で当てた場合のみスコア加算
                       score += points;
                       updateInfo(); // UI更新
                    }
                    spawnHitEffect(chicken.position, chicken.userData.isGold ? 0xffe066 : 0xffffff, 10, 0.6, 600);
                    playBakuhaSound();
                    scene.remove(chicken);
                    const colIdx = collisionObjects.findIndex(co => co.object === chicken);
                    if (colIdx > -1) collisionObjects.splice(colIdx, 1);
                    chickens.splice(i, 1);
                    // TODO: 鶏のリスポーン処理を追加？
                    missileIdsToDelete.push(missileId);
                    hit = true;
                    break;
               }
           }
           // 虹色チキン
           if (!hit && rainbowChicken && rainbowChicken.visible) {
               if (m.mesh.position.distanceToSquared(rainbowChicken.position) < (6.0 + 0.5)**2) {
                    // Ablyで虹色チキンヒット通知 (誰が当てたか)
                    if (channel) {
                        channel.publish('hit_rainbow', { attackerId: m.ownerId });
                    }
                    // ミサイル削除のみ
                    missileIdsToDelete.push(missileId);
                    hit = true;
                    spawnHitEffect(rainbowChicken.position, 0xffaaff, 12, 0.7, 700);
                    playBakuhaSound(0.8);
               }
           }
        }
    }

    // マークされたミサイルを削除
    for (const id of missileIdsToDelete) {
        if (allMissiles[id] && allMissiles[id].mesh) {
            scene.remove(allMissiles[id].mesh);
        }
        delete allMissiles[id];
    }
}


// --- プレイヤー被弾処理 ---
function handlePlayerHit(targetId, attackerId = null) {
    playHitSound(); // 被弾音

    if (targetId === myId) {
        if (hp <= 0) return; // すでにHP0なら何もしない
        hp--;
        updateInfo();
        updateHeartDisplay(bird.userData.nameObj, hp);
        spawnHitEffect(bird.position, 0xff0000, 10, 0.5, 500); // 赤いエフェクト

        if (hp <= 0) {
            console.log("プレイヤーが撃墜されました！");
            bird.visible = false; // 一時的に非表示
            if (bird.userData.nameObj) bird.userData.nameObj.element.style.display = 'none';
            // リスポーンタイマー
            setTimeout(respawnPlayer, 3000); // 3秒後にリスポーン
        }
        // AblyでHP変更を通知 (自分のHPが変わったことを伝える)
        if (channel) {
            channel.publish('hp_update', { id: myId, hp: hp, score: score }); // スコアも一緒に送る
        }
    } else if (peers[targetId]) {
        // 他プレイヤーの被弾処理 (HP減少は 'hp_update' 受信時に行う)
        const peer = peers[targetId];
        if (peer.group) {
             spawnHitEffect(peer.group.position, 0xff0000, 10, 0.5, 500);
             // HPが0になったら非表示にする処理は 'hp_update' 受信時に行う
        }
    }
}

function respawnPlayer() {
    if (!bird) return;
    const safePos = findSafeRespawnPosition();
    bird.position.copy(safePos);
    hp = MAX_HP; // HP全回復
    bird.visible = true; // 再表示
    if (bird.userData.nameObj) bird.userData.nameObj.element.style.display = '';
    updateInfo();
    updateHeartDisplay(bird.userData.nameObj, hp);
    console.log("プレイヤーリスポーン！");
    // AblyでリスポーンとHP回復を通知
    if (channel) {
        channel.publish('respawn', { id: myId, x: safePos.x, y: safePos.y, z: safePos.z, hp: hp });
    }
}

function findSafeRespawnPosition() {
    let tries = 0;
    let x, z, y;
    const minDistSq = 50 * 50; // 他プレイヤーから最低50離れる

    while (tries < 30) {
        tries++;
        // ランダムな空中位置
        x = (Math.random() - 0.5) * TERRAIN_SIZE * 0.8;
        z = (Math.random() - 0.5) * TERRAIN_SIZE * 0.8;
        y = 30 + Math.random() * 40;
        const candidatePos = new THREE.Vector3(x, y, z);

        // 他プレイヤーとの距離チェック
        let tooClose = false;
        for (const peerId in peers) {
            if (peers[peerId] && peers[peerId].group && peers[peerId].hp > 0) {
                if (candidatePos.distanceToSquared(peers[peerId].group.position) < minDistSq) {
                    tooClose = true;
                    break;
                }
            }
        }

        // 地形との衝突チェック（低すぎないか）
        const terrainHeight = getTerrainHeight(x, z);
        if (y < terrainHeight + 5) { // 地形から最低5は離す
            tooClose = true;
        }

        if (!tooClose) return candidatePos; // 安全な場所が見つかった
    }
    // 見つからなかったらデフォルト位置
    return new THREE.Vector3(0, 50, 0);
}


// --- ダッシュ ---
function startDash() {
    if (!dashActive && dashGauge >= 0.1) { // 少しゲージがあれば発動可能に
        dashActive = true;
        playDashSound();
        addDashEffect(); // エフェクト追加
    }
}

function stopDash() {
    // キー/ボタンを離した時に呼ばれる想定だが、現状の実装では自動で止まる
    // 必要であれば dashActive = false; をここで行う
    removeDashEffect(); // エフェクト削除
}

function updateDash() {
    if (dashActive) {
        dashGauge -= DASH_DECREASE_PER_FRAME;
        if (dashGauge <= 0) {
            dashGauge = 0;
            dashActive = false;
            removeDashEffect();
        }
        // ダッシュ中の体当たり判定 (鶏)
        if (bird && bird.visible) { // プレイヤーが存在し表示されている場合のみ更新
           for (let i = chickens.length - 1; i >= 0; i--) {
               const chicken = chickens[i];
               if (bird.position.distanceToSquared(chicken.position) < (3.0 + 3.5)**2) { // 半径和で判定
                    const points = chicken.userData.isGold ? 2 : 1;
                    score += points;
                    updateInfo();
                    spawnHitEffect(chicken.position, chicken.userData.isGold ? 0xffe066 : 0xffffff, 10, 0.6, 600);
                    playBakuhaSound();
                    scene.remove(chicken);
                    const colIdx = collisionObjects.findIndex(co => co.object === chicken);
                    if (colIdx > -1) collisionObjects.splice(colIdx, 1);
                    chickens.splice(i, 1);
                    // TODO: 鶏のリスポーン処理を追加？
               }
           }
           // 虹色チキンへの体当たり
           if (rainbowChicken && rainbowChicken.visible) {
              if (bird.position.distanceToSquared(rainbowChicken.position) < (3.0 + 6.0)**2) {
                   if (channel) {
                       // 体当たりでもヒット通知 (attackerId は自分)
                       channel.publish('hit_rainbow', { attackerId: myId });
                   }
                   // エフェクトと音
                   spawnHitEffect(rainbowChicken.position, 0xffaaff, 12, 0.7, 700);
                   playBakuhaSound(0.8);
                   // HP減少などは 'hit_rainbow' 受信時に行う
              }
           }
        }

    } else if (dashGauge < 1.0) {
        dashGauge += DASH_RECOVER_PER_FRAME;
        dashGauge = Math.min(dashGauge, 1.0);
    }
    updateDashGaugeUI();
}

function addDashEffect() {
    if (dashEffect) return; // 既に存在すれば何もしない
    dashEffect = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({
        color: 0xffff66,
        // emissive: 0xffffff,
        // emissiveIntensity: 1,
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
        depthWrite: false
    });
    for (let i = 0; i < 5; i++) {
        const len = 2.0 + Math.random() * 1.5;
        const geo = new THREE.CylinderGeometry(0.05, 0.12, len, 5, 1, true); // 細長く
        const mesh = new THREE.Mesh(geo, mat);
        // 鳥の周りにランダムに配置
        const angle = Math.random() * Math.PI * 2;
        const radius = 1.2 + Math.random() * 0.5;
        mesh.position.set(Math.cos(angle) * radius, (Math.random() - 0.5) * 1.5, Math.sin(angle) * radius);
        mesh.lookAt(bird.position); // 鳥の中心を向くように
        mesh.rotation.y += Math.PI / 2; // 進行方向と垂直っぽく
        dashEffect.add(mesh);
    }
    bird.add(dashEffect); // 鳥の子オブジェクトとして追加
}

function removeDashEffect() {
    if (dashEffect) {
        bird.remove(dashEffect); // 鳥から削除
        // メモリ解放 (Three.jsが自動で行うことが多いが念のため)
        dashEffect.traverse(child => {
            if (child.isMesh) {
                child.geometry.dispose();
                child.material.dispose();
            }
        });
        dashEffect = null;
    }
}


// --- UI 更新 ---
function updateInfo() {
    // スコア表示
    const scoreElement = document.getElementById('score');
    if (scoreElement) {
        scoreElement.textContent = score;
    }
    // 詳細情報 (オプション)
    if (infoDiv) {
        infoDiv.innerHTML = `スコア: <b style="color: #ffd700;">${score}</b><br>体力: <b style="color: ${hp > 2 ? '#90ee90' : '#ff6b6b'};">${hp}</b> / ${MAX_HP}<br>接続: <b>${userCount}</b>`;
    }
}

function updateDashGaugeUI() {
    if (dashGaugeElement) {
        const percentage = Math.max(0, Math.min(1, dashGauge)) * 100;
        dashGaugeElement.style.width = `${percentage}%`;
        // 色変更
        if (percentage > 70) {
            dashGaugeElement.style.background = 'linear-gradient(90deg, #6fdc4b 0%, #ffe066 100%)';
        } else if (percentage > 30) {
            dashGaugeElement.style.background = 'linear-gradient(90deg, #ff9800 0%, #ffe066 100%)';
        } else {
            dashGaugeElement.style.background = 'linear-gradient(90deg, #ff4444 0%, #ffe066 100%)';
        }
    }
}

function updateRanking() {
    if (!rankingDiv) return;
    let html = '<b>ランキング</b><div style="margin-top: 5px;">'; // 少し間隔を空ける

    // 自分とピアの情報を結合してソート
    const allPlayers = [{ id: myId, name: myName, score: score }];
    for (const pid in peers) {
        allPlayers.push({ id: pid, name: peers[pid].name, score: peers[pid].score });
    }
    // スコアで降順ソート
    allPlayers.sort((a, b) => b.score - a.score);

    // 上位3名（または存在する全員）を表示
    const displayCount = Math.min(allPlayers.length, 3);
    if (displayCount === 0) {
        html += '---';
    } else {
        for (let i = 0; i < displayCount; i++) {
            const p = allPlayers[i];
            // 自分をハイライト (オプション)
            const isMe = p.id === myId;
            html += `<div style="margin-bottom: 3px; ${isMe ? 'color: #ff8c00; font-weight: bold;' : ''}">`;
            html += `${i + 1}. ${escapeHTML(p.name || '???')} : <b>${p.score}</b>`;
            html += `</div>`;
        }
    }

    html += '</div>';
    rankingDiv.innerHTML = html;
}

// HTMLエスケープ関数 (XSS対策)
function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, function(match) {
        return {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[match];
    });
}


// --- Ably (オンライン同期) ---
async function initAbly() {
    try {
        const apiBase = (location.hostname === 'localhost' || location.hostname === '127.0.0.1') ? 'http://localhost:3000' : '';
        const authUrl = `${apiBase}/api/token`;
        // authUrl方式で初期化（SDKが自動でトークン取得）
        return new Ably.Realtime({ authUrl, clientId: 'user-' + Math.random().toString(36).substring(2, 9) });
    } catch (error) {
        console.error('Ably初期化エラー:', error);
        alert('サーバー接続エラー: 認証トークンの取得に失敗しました。\nサーバーが動作していて、URLが正しいか確認してください。');
        return null;
    }
}


async function setupRealtimeConnection() {
    ably = await initAbly();
    if (!ably) return; // 初期化失敗

    channel = ably.channels.get('bird-garden-3d-v2'); // チャンネル名変更推奨

    // --- Presence (入退室管理) ---
    await channel.presence.enter({ id: myId, name: myName, color: myColor, score: score, hp: hp });
    console.log("Presence Enter 完了");

    // 在室メンバー取得とUI更新
    const updatePresenceInfo = async () => {
        try {
            const members = await channel.presence.get();
            console.log("[DEBUG] presence.get result:", members, "typeof:", typeof members, "channel:", channel, "ably.connection.state:", ably && ably.connection ? ably.connection.state : undefined);
            if (!Array.isArray(members)) {
                console.error("Presence情報の取得エラー: membersが配列ではありません", members);
                userCount = 0;
                updateInfo();
                return;
            }
            userCount = members.length;
            updateInfo(); // 接続人数表示更新

            // 既存ピアの更新と新規ピアの追加
            const currentPeerIds = new Set(Object.keys(peers));
            for (const member of members) {
                if (!member || typeof member !== 'object') continue;
                if (member.clientId === ably.auth.clientId) continue; // 自分は無視 (myId比較が望ましい場合あり)

                // Ably SDKのPresence.get()の戻り値が {clientId, data} でない場合の防御
                if (!('data' in member) || !('clientId' in member)) {
                    console.warn("Presenceメンバー形式が不正", member);
                    continue;
                }

                if (!peers[member.data.id]) { // 新規ピア
                    console.log(`新規ピア参加: ${member.data.name}(${member.data.id})`);
                    peers[member.data.id] = createPeerBird(member.data); // createPeerBirdはstateを引数に取る
                    scene.add(peers[member.data.id].group);
                } else { // 既存ピアの情報更新
                    const peer = peers[member.data.id];
                    peer.group.position.set(member.data.x || 0, member.data.y || 10, member.data.z || 0); // 位置も同期？
                    peer.group.rotation.y = member.data.ry || 0; // 回転も同期？
                    setBirdColor(peer.group, member.data.color || '#ffffff');
                    peer.name = member.data.name || '???';
                    peer.hp = typeof member.data.hp === 'number' ? member.data.hp : MAX_HP;
                    peer.score = typeof member.data.score === 'number' ? member.data.score : 0;
                    if (peer.nameObj) {
                        peer.nameObj.nameSpan.textContent = peer.name;
                        updateHeartDisplay(peer.nameObj, peer.hp);
                    }
                    peer.group.visible = peer.hp > 0; // HPが0なら非表示
                }
                currentPeerIds.delete(member.data.id); // 処理済みピアIDをセットから削除
            }

            // Presenceにはいるがpeersにいない場合（エラーケース）はログ表示
            // presenceにいなくなったがpeersに残っているピアを削除
            for (const oldPeerId of currentPeerIds) {
                if (peers[oldPeerId]) {
                    console.log(`ピア退出: ${peers[oldPeerId].name}(${oldPeerId})`);
                    removePeer(oldPeerId);
                }
            }
            updateRanking(); // ランキング更新
        } catch (err) {
            console.error("Presence情報の取得/更新エラー:", err);
        }
    };

    // 定期的に Presence 情報で同期 (例: 5秒ごと)
    setInterval(updatePresenceInfo, 5000);
    await updatePresenceInfo(); // 初回実行

    // Presence イベントリスナー
    channel.presence.subscribe(['enter', 'leave', 'update'], updatePresenceInfo);


    // --- メッセージ購読 ---

    // 状態同期 (軽量化のため位置情報はPresence Updateに任せるか検討)
    channel.subscribe('state', (msg) => {
        const s = msg.data;
        if (!s || s.id === myId || !peers[s.id]) return;
        const peer = peers[s.id];
        // 位置と回転は頻繁に変わるので、別イベント or Presence update が良いかも
        peer.group.position.lerp(new THREE.Vector3(s.x, s.y, s.z), 0.5); // Lerpで滑らかに
        peer.group.rotation.y = s.ry; // 回転は即時反映 or Lerp
        // 色、名前、HP、スコアは Presence update で同期されるはずだが、念のため更新
        // setBirdColor(peer.group, s.color);
        // peer.name = s.name;
        // peer.hp = s.hp;
        // peer.score = s.score;
        // if(peer.nameObj) { /* ... */ }
        // peer.group.visible = peer.hp > 0;
    });


    // ミサイル発射同期
    channel.subscribe('fire', (msg) => {
        const m = msg.data;
        if (!m || m.owner === myId || allMissiles[m.id]) return; // 自分 or 既に存在する場合は無視
        const pos = new THREE.Vector3(m.x, m.y, m.z);
        const dir = new THREE.Vector3(m.dx, m.dy, m.dz);
        // 他プレイヤーのミサイルを生成 (launchMissileは自他判定するのでそのまま使える)
        launchMissile(m.owner, pos, dir);
        // 受信したミサイルIDで管理
        if (allMissiles[m.id]) { // launchMissile内で生成されたオブジェクトに正しいIDを再設定
             const createdMissile = Object.values(allMissiles).find(missile =>
                  missile.ownerId === m.owner && missile.mesh.position.distanceTo(pos) < 0.1);
             if (createdMissile) {
                  delete allMissiles[createdMissile.id]; // 仮IDのものを削除
                  allMissiles[m.id] = createdMissile; // 正しいIDで登録
                  createdMissile.id = m.id;
             }
        } else {
            // launchMissile が allMissiles に追加しなかった場合のエラー処理
            console.warn(`受信したミサイル ${m.id} がローカルで生成/管理されませんでした。`);
        }

    });

    // 被弾同期
    channel.subscribe('hit', (msg) => {
        const { targetId, attackerId } = msg.data;
        if (!targetId) return;
        // 実際の被弾処理 (HP減少、エフェクトなど)
        handlePlayerHit(targetId, attackerId);
    });

    // HP/スコア更新同期
    channel.subscribe('hp_update', (msg) => {
        const data = msg.data;
        if (!data || !data.id) return;
        if (data.id === myId) {
            // 自分のHP/スコアがサーバーから来た場合 (通常は不要だが念のため)
            // hp = data.hp;
            // score = data.score;
            // updateInfo();
            // updateHeartDisplay(bird.userData.nameObj, hp);
        } else if (peers[data.id]) {
            const peer = peers[data.id];
            peer.hp = data.hp;
            peer.score = data.score;
            peer.group.visible = peer.hp > 0; // HPに応じて表示設定
            if (peer.nameObj) {
                updateHeartDisplay(peer.nameObj, peer.hp);
            }
            updateRanking(); // スコアが変わった可能性があるのでランキング更新
        }
    });

    // リスポーン同期
    channel.subscribe('respawn', (msg) => {
         const data = msg.data;
         if (!data || data.id === myId || !peers[data.id]) return;
         const peer = peers[data.id];
         peer.group.position.set(data.x, data.y, data.z);
         peer.hp = data.hp; // リスポーン時のHPに設定
         peer.group.visible = true; // 必ず表示
         if (peer.nameObj) {
             peer.nameObj.element.style.display = ''; // ラベルも表示
             updateHeartDisplay(peer.nameObj, peer.hp);
         }
    });

    // 虹色チキン被弾同期
    channel.subscribe('hit_rainbow', (msg) => {
        const { attackerId } = msg.data;
        if (!rainbowChicken || !rainbowChicken.visible) return;

        rainbowChicken.userData.hp--;
        rainbowChicken.userData.lastHitPlayer = attackerId; // 最後に当てた人
        console.log(`虹色チキン被弾！ 残りHP: ${rainbowChicken.userData.hp} (攻撃者: ${attackerId})`);
        spawnHitEffect(rainbowChicken.position, 0xffaaff, 15, 0.8, 800); // 派手なエフェクト
        playBakuhaSound(0.9);

        if (rainbowChicken.userData.hp <= 0) {
            console.log(`虹色チキン撃破！ by ${attackerId}`);
            // スコア加算 (撃破者のみ)
            if (attackerId === myId) {
                score += 5; // 5点ゲット
                updateInfo();
                // HP/スコア更新を送信
                if (channel) {
                     channel.publish('hp_update', { id: myId, hp: hp, score: score });
                }
            }
            removeRainbowChicken();
            scheduleRainbowChickenRespawn();
        }
    });

    // 定期的な状態送信 (位置情報など頻繁に変わるもの)
    setInterval(sendState, 100); // 100msごと (負荷に応じて調整)
}

function createPeerBird(state) {
    const peerBird = createBirdModel(state.color || '#ffffff'); // 共通関数を使用
    peerBird.position.set(state.x || 0, state.y || 10, state.z || 0); // 初期位置
    peerBird.rotation.y = state.ry || 0; // 初期回転

    const peerData = {
        group: peerBird,
        name: state.name || '???',
        hp: typeof state.hp === 'number' ? state.hp : MAX_HP,
        score: typeof state.score === 'number' ? state.score : 0,
        color: state.color || '#ffffff',
        nameObj: null // 後で作成
    };

    // 名前ラベル作成
    peerData.nameObj = createNameObj(peerBird, peerData.name, peerData.hp);
    peerBird.visible = peerData.hp > 0; // 初期HPに応じて表示設定

    addCollisionObject(peerBird, 1.5); // ピアの衝突半径
    return peerData;
}

function removePeer(peerId) {
    if (peers[peerId]) {
        const peer = peers[peerId];
        scene.remove(peer.group);
        if (peer.nameObj && peer.nameObj.element) {
            document.body.removeChild(peer.nameObj.element);
        }
        // collisionObjects からも削除
        const index = collisionObjects.findIndex(co => co.object === peer.group);
        if (index > -1) collisionObjects.splice(index, 1);
        delete peers[peerId];
    }
}


function sendState() {
    if (!channel || !bird || hp <= 0) return; // 送信条件

    // 位置、回転、HP、スコアを送信 (名前や色はPresenceで同期)
    channel.publish('state', {
        id: myId,
        x: bird.position.x,
        y: bird.position.y,
        z: bird.position.z,
        ry: bird.rotation.y,
        // hp: hp,       // hp_updateで送信
        // score: score,   // hp_updateで送信
        // name: myName,   // Presenceで同期
        // color: myColor  // Presenceで同期
    });
}


// --- ゲームロジック ---

function startGame() {
    myId = `player_${Math.random().toString(36).slice(2, 11)}`; // よりユニークなID
    console.log(`My ID: ${myId}, Name: ${myName}, Color: ${myColor}`);

    initGraphics();
    createTerrain();
    placeObjects();
    setupPlayerBird(); // プレイヤー生成・設定
    spawnChickens();
    spawnBigHearts();
    spawnRainbowChicken(); // 最初から虹色チキン出現

    setupInput(); // 入力設定を呼び出し

    // UI要素取得
    infoDiv = document.getElementById('info');
    rankingDiv = document.getElementById('ranking');
    dashGaugeElement = document.getElementById('dash-gauge');

    updateInfo(); // 初期UI表示
    updateRanking();

    // Ably接続開始
    setupRealtimeConnection().then(() => {
       console.log("Ably接続セットアップ完了");
       requestAnimationFrame(animate); // 接続後にアニメーション開始
    }).catch(err => {
        console.error("Ably接続プロセスエラー:", err);
        // オフラインモードやエラー表示など
        alert("オンライン接続に失敗しました。");
        requestAnimationFrame(animate); // エラーでもゲームループは開始する (オフラインモード)
    });
}


function setupInput() {
    // キーボード入力
    window.addEventListener('keydown', (e) => {
        switch (e.code) {
            case 'KeyW': case 'ArrowUp': move.forward = 1; break;
            case 'KeyS': case 'ArrowDown': move.forward = -1; break;
            case 'KeyA': case 'ArrowLeft': move.turn = -1; break;
            case 'KeyD': case 'ArrowRight': move.turn = 1; break;
            case 'Space': move.up = 1; break;
            case 'ShiftLeft': case 'ShiftRight': move.up = -1; break;
            case 'KeyX': if (hp > 0) launchMissile(myId, bird.position, bird.getWorldDirection(new THREE.Vector3())); break;
            case 'KeyZ': if (hp > 0) startDash(); break;
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

    // バーチャルジョイスティック (nipplejs)
    const joystickZone = document.getElementById('joystick-zone');
    if (joystickZone && typeof nipplejs !== 'undefined') {
        const joystick = nipplejs.create({
            zone: joystickZone,
            mode: 'static',
            position: { left: '70px', bottom: '70px' }, // 位置調整
            color: 'rgba(0, 120, 255, 0.7)', // 色と透明度
            size: 120 // サイズ調整
        });
        joystick.on('move', (evt, data) => {
            if (data && data.vector && hp > 0) {
                const angle = data.angle.radian;
                const force = data.force;
                // y: 前後進 (-1:後, 1:前) -> forceで強度調整
                // x: 左右旋回 (-1:左, 1:右)
                move.forward = Math.sin(angle) * force * 1.5; // 前後進の感度調整
                move.turn = Math.cos(angle) * force * 1.5;    // 旋回の感度調整
                move.forward = Math.max(-1, Math.min(1, move.forward));
                move.turn = Math.max(-1, Math.min(1, move.turn));
            }
        });
        joystick.on('end', () => {
            move.forward = 0;
            move.turn = 0;
        });
    } else if (!joystickZone) {
        console.warn("要素 #joystick-zone が見つかりません。");
    } else if (typeof nipplejs === 'undefined') {
        console.warn("nipplejs がロードされていません。");
    }


    // ボタン入力 (タッチとマウス)
    const setupButton = (id, downCallback, upCallback = null) => {
        const btn = document.getElementById(id);
        if (!btn) return;
        btn.addEventListener('touchstart', (e) => { if(hp > 0) downCallback(); e.preventDefault(); }, { passive: false });
        if (upCallback) btn.addEventListener('touchend', upCallback);
        btn.addEventListener('mousedown', () => { if(hp > 0) downCallback() });
        if (upCallback) btn.addEventListener('mouseup', upCallback);
        if (upCallback) btn.addEventListener('mouseleave', upCallback); // 範囲外でも離す
        btn.addEventListener('contextmenu', (e) => e.preventDefault()); // 右クリックメニュー阻止
    };

    setupButton('missile-btn', () => { if(hp > 0) launchMissile(myId, bird.position, bird.getWorldDirection(new THREE.Vector3())) });
    setupButton('dash-btn', () => { if(hp > 0) startDash() });
    setupButton('up-btn', () => { move.up = 1; }, () => { move.up = 0; });
    setupButton('down-btn', () => { move.up = -1; }, () => { move.up = 0; });
    // 例: 前進ボタン
    // setupButton('forward-btn', () => move.forward = 1, () => move.forward = 0);
}


// --- 音声再生 ---
function playSound(audioId, volume = 0.6, reset = true) {
    const audio = document.getElementById(audioId);
    if (audio instanceof HTMLAudioElement) { // HTMLAudioElementか確認
        try {
            if (reset) audio.currentTime = 0;
            audio.volume = Math.max(0, Math.min(1, volume));
            audio.play().catch(e => {
                // 再生失敗時のログ（デバッグ用）
                // console.warn(`Audio play failed for ${audioId}:`, e.name, e.message);
            });
        } catch (err) {
            console.error(`Error playing sound ${audioId}:`, err);
        }
    }
}

function playShotSound() { playSound('shot-audio', 0.4); }
function playDashSound() { playSound('dash-audio', 0.7); }
function playBakuhaSound(volume = 0.7) { playSound('bakuha-audio', volume); }
function playHitSound() { playSound('hit-audio', 0.6); }
function playCoinSound() { playSound('coin-audio', 0.5); }

function startBGM() {
    const bgm = document.getElementById('bgm-audio');
    if (bgm) {
        bgm.loop = true;
        bgm.volume = 0.3; // BGM音量調整
        // ユーザー操作後に再生開始
        const playBGM = () => {
            bgm.play().then(() => {
                 document.removeEventListener('click', playBGM);
                 document.removeEventListener('touchstart', playBGM);
            }).catch(()=>{}); // エラーは無視
        };
        document.addEventListener('click', playBGM);
        document.addEventListener('touchstart', playBGM);
    }
}

// --- ログイン画面 ---
function showLogin() {
    const loginModal = document.getElementById('login-modal');
    const loginBtn = document.getElementById('login-btn');
    const nameInput = document.getElementById('login-name');
    const colorInput = document.getElementById('login-color');

    if (!loginModal || !loginBtn || !nameInput || !colorInput) {
        console.error("ログイン要素が見つかりません。HTMLを確認してください。");
        // フォールバック: デフォルト名で即開始
        myName = `Guest_${Math.random().toString(36).slice(2, 7)}`;
        myColor = '#ffff66';
        startGame();
        return;
    }


    loginModal.style.display = 'flex';

    loginBtn.onclick = () => {
        const name = nameInput.value.trim();
        const color = colorInput.value;
        if (!name) {
            alert('ユーザー名を入力してください');
            return;
        }
        if (name.length > 12) { // 文字数制限
             alert('ユーザー名は12文字以内にしてください');
             return;
        }
        myName = name;
        myColor = color;
        loginModal.style.display = 'none';
        startGame(); // ゲーム開始
    };
}

// --- イベントリスナー ---
window.addEventListener('DOMContentLoaded', () => {
    showLogin(); // ログイン画面表示から開始
    startBGM(); // BGM再生準備
});

window.addEventListener('resize', () => {
    if (camera && renderer) {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    }
});

// スマホでの中断/再開処理
document.addEventListener('visibilitychange', () => {
    const bgm = document.getElementById('bgm-audio');
    if (document.hidden) {
        // バックグラウンドになった時
        if (channel) channel.presence.leave(); // 一時離脱
        if (ably && ably.connection.state === 'connected') {
             // ably.connection.close(); // 完全切断せず、離脱だけが良いかも
        }
        if (bgm && !bgm.paused) bgm.pause();
    } else {
        // フォアグラウンドに戻った時
        if (ably && ably.connection.state !== 'connected') {
             // 再接続処理が必要な場合
             // setupRealtimeConnection(); // 再初期化 or
             // ably.connection.connect();
        }
         if (channel) channel.presence.enter({ id: myId, name: myName, color: myColor, score: score, hp: hp }); // 再入室
        if (bgm && bgm.paused) bgm.play().catch(()=>{}); // BGM再開
    }
});

// ページを閉じる/移動する前の処理
window.addEventListener('beforeunload', () => {
    if (channel) channel.presence.leave(); // 必ず離脱
    if (ably) ably.close(); // Ably接続を閉じる
});


// --- アニメーションループ ---
let lastTimestamp = 0;
let errorDisplayTimeout = null; // エラー表示タイマー

function animate(timestamp) {
    requestAnimationFrame(animate); // 次のフレームを予約

    const deltaTime = (timestamp - lastTimestamp) * 0.001; // 秒単位のデルタタイム
    // deltaTimeが異常に大きい場合(タブが非アクティブだったなど)は補正
    const dt = Math.min(deltaTime, 0.1); // 最大0.1秒とする
    lastTimestamp = timestamp;

    // --- 更新処理 ---
    try {
        if (bird && bird.visible) { // プレイヤーが存在し表示されている場合のみ更新
            updatePlayerMovement(dt); // deltaTime -> dt
            updateCameraAndWing(dt); // deltaTime -> dt
            updateDash(); // ダッシュゲージとエフェクト、当たり判定
        }
        updateVehicles(dt); // deltaTime -> dt
        updateAircrafts(dt); // deltaTime -> dt
        updateProjectiles(); // ミサイルの更新（当たり判定含む）
        updateChickensAndHearts(dt); // 鶏とハートの更新 (deltaTime -> dt)
        updateUIElements(); // UI全般の更新

        renderScene(); // 描画

        // エラー表示があれば徐々に消す
        const errDiv = document.getElementById('error-log');
        if (errDiv && errDiv.style.opacity > 0) {
            errDiv.style.opacity = Math.max(0, errDiv.style.opacity - 0.005); // ゆっくり消える
            if (errDiv.style.opacity == 0) {
                 errDiv.style.display = 'none'; // 完全に消えたら非表示に
            }
        }

    } catch (e) {
        console.error("[animate] エラー発生:", e);
        // エラーログ表示 (より詳細に)
        let errDiv = document.getElementById('error-log');
        if (!errDiv) {
            // === ここから修正・追加 ===
            errDiv = document.createElement('div');
            errDiv.id = 'error-log';
            errDiv.style.position = 'fixed';
            errDiv.style.bottom = '10px';
            errDiv.style.left = '10px';
            errDiv.style.background = 'rgba(220, 0, 0, 0.9)'; // 少し濃い赤
            errDiv.style.color = '#fff';
            errDiv.style.padding = '10px 15px';
            errDiv.style.zIndex = '10000'; // 最前面に
            errDiv.style.fontSize = '13px'; // 少し小さく
            errDiv.style.borderRadius = '5px';
            errDiv.style.maxWidth = 'calc(100% - 20px)';
            errDiv.style.maxHeight = '40vh'; // 高さ制限
            errDiv.style.overflowY = 'auto'; // スクロール可能に
            errDiv.style.whiteSpace = 'pre-wrap';
            errDiv.style.wordBreak = 'break-all';
            errDiv.style.boxShadow = '0 0 10px rgba(0,0,0,0.5)';
            errDiv.style.transition = 'opacity 0.5s ease-out'; // フェードアウト用
            document.body.appendChild(errDiv);
            // === ここまで修正・追加 ===
        }
        // エラーメッセージ表示、表示を更新
        errDiv.textContent = `[Animate Loop Error]\n${e.message}\n\nStack:\n${e.stack}`;
        errDiv.style.display = 'block'; // 表示する
        errDiv.style.opacity = '1'; // 不透明にする

        // エラー表示を一定時間後に自動で薄くし始めるタイマー（既にあればクリア）
        if (errorDisplayTimeout) clearTimeout(errorDisplayTimeout);
        errorDisplayTimeout = setTimeout(() => {
           // opacityを下げる処理はanimateループ内で既に行っているので、ここでは何もしない
        }, 10000); // 10秒後にフェードアウト開始

        // エラー発生時はこのフレームの処理を中断 (場合による)
        // return;
    }
}


function updatePlayerMovement(deltaTime) {
    if (!bird || hp <= 0) return; // HP0なら操作不能

    const baseSpeed = 25.0; // 基本速度 (単位/秒)
    const turnRate = 2.5; // 旋回速度 (ラジアン/秒)
    const upDownSpeed = 15.0; // 上昇/下降速度

    let currentSpeed = baseSpeed;
    if (dashActive) currentSpeed *= 2.5; // ダッシュ中は速度アップ

    // 旋回 (deltaTimeを考慮)
    bird.rotation.y -= move.turn * turnRate * deltaTime;

    // 前後進 (ワールド方向ベクトルを取得)
    const moveDirection = bird.getWorldDirection(new THREE.Vector3());
    const deltaPosition = moveDirection.multiplyScalar(move.forward * currentSpeed * deltaTime);

    // 上昇/下降
    deltaPosition.y += move.up * upDownSpeed * deltaTime;

    // 現在位置に加算
    const nextPosition = bird.position.clone().add(deltaPosition);

    // ワールド境界チェック
    nextPosition.x = Math.max(-TERRAIN_SIZE / 2 + 5, Math.min(TERRAIN_SIZE / 2 - 5, nextPosition.x));
    nextPosition.z = Math.max(-TERRAIN_SIZE / 2 + 5, Math.min(TERRAIN_SIZE / 2 - 5, nextPosition.z));
    nextPosition.y = Math.max(2, Math.min(150, nextPosition.y)); // 高度制限

    // 衝突判定と応答 (複数回チェックして押し出す)
    let collisionCheckedPos = nextPosition.clone();
    for (let i = 0; i < 3; i++) { // 最大3回チェック
        const collision = checkCollision(collisionCheckedPos, 1.5); // プレイヤー半径
        if (!collision.collided) break; // 衝突なし
        collisionCheckedPos = handleCollisionResponse(collisionCheckedPos, collision, 1.5);
    }

    // 最終的な位置を適用
    bird.position.copy(collisionCheckedPos);
}

function updateCameraAndWing(deltaTime) {
    if (!bird) return;

    // カメラ追従 (Lerpで滑らかに)
    const cameraTargetPos = new THREE.Vector3();
    const offset = new THREE.Vector3(0, 6, -12); // カメラの相対位置
    cameraTargetPos.copy(bird.position).add(offset.applyQuaternion(bird.quaternion));

    camera.position.lerp(cameraTargetPos, 0.1); // 0.1は追従の滑らかさ係数
    camera.lookAt(bird.position.x, bird.position.y + 1.0, bird.position.z); // 少し上を見る

    // 羽ばたきアニメーション
    const flapSpeed = 15.0; // 羽ばたき速度 (ラジアン/秒)
    const flapRange = 0.8; // 羽ばたき角度範囲

    // 上昇/下降/ダッシュ中は速く羽ばたく
    const speedMultiplier = (move.up !== 0 || dashActive) ? 2.0 : 1.0;

    wingAngle += flapSpeed * speedMultiplier * wingDir * deltaTime;
    if (Math.abs(wingAngle) > flapRange / 2) {
        wingAngle = Math.sign(wingAngle) * flapRange / 2; // 範囲制限
        wingDir *= -1; // 方向転換
    }

    // モデルデータからウィングを取得して回転
    if (bird.userData.leftWing && bird.userData.rightWing) {
        bird.userData.leftWing.rotation.x = wingAngle;
        bird.userData.rightWing.rotation.x = -wingAngle;
    }
}

function updateVehicles(deltaTime) {
    const now = performance.now() * 0.001; // 秒単位の時間
    // 車
    for (const car of cars) {
        // 前に移動
        const moveAmount = car.userData.speed * 60 * deltaTime; // deltaTime基準の移動量
        car.translateX(moveAmount); // 車自身のローカルX軸方向に移動

        // 地形の高さを取得して追従 (負荷高めなので注意)
        const carY = getTerrainHeight(car.position.x, car.position.z) + 0.6;
        car.position.y = THREE.MathUtils.lerp(car.position.y, carY, 0.1); // 滑らかに追従

        // ワールド境界ループ
        if (Math.abs(car.position.x) > TERRAIN_SIZE / 2) car.position.x *= -0.99;
        if (Math.abs(car.position.z) > TERRAIN_SIZE / 2) car.position.z *= -0.99;
    }
}

function updateAircrafts(deltaTime) {
    const now = performance.now() * 0.001; // 秒単位
    for (const a of aircrafts) {
        const userData = a.userData;
        const timePhase = now * userData.speedFactor * 0.2 + userData.phase; // 時間と位相

        if (userData.type === 'airplane') {
            const radius = 280 + 120 * Math.sin(userData.phase * 1.5); // 軌道半径
            const speed = 0.15 + 0.08 * Math.cos(userData.phase * 2.0); // 速度変化
            const angle = timePhase * speed;
            a.position.x = Math.cos(angle) * radius;
            a.position.z = Math.sin(angle) * radius;
            a.position.y = userData.baseY + Math.sin(timePhase * 1.8) * 8; // 上下動
            a.rotation.y = Math.PI / 2 - angle; // 進行方向
            a.rotation.z = Math.sin(timePhase * 2.5) * 0.05; // 少し傾ける
        } else if (userData.type === 'helicopter') {
            const radius = 140 + 40 * Math.sin(userData.phase * 1.8);
            const speed = 0.2 + 0.1 * Math.cos(userData.phase * 2.5);
            const angle = timePhase * speed;
            a.position.x = Math.cos(angle) * radius;
            a.position.z = Math.sin(angle) * radius;
            a.position.y = userData.baseY + Math.sin(timePhase * 2.2) * 6;
            a.rotation.y = Math.PI / 2 - angle;
            // ローター回転 (deltaTime考慮不要な見た目だけのアニメーション)
            if (a.children[2]) a.children[2].rotation.y = now * 30; // メインローター
            if (a.children[3]) a.children[3].rotation.x = now * 40; // テールローター
        }
    }
}


function updateProjectiles() {
    updateMissiles(); // ミサイルの移動、寿命、当たり判定
}

function updateChickensAndHearts(deltaTime) {
    // 鶏の移動
    for (const chicken of chickens) {
        moveChicken(chicken);
    }
    // 虹色チキンの移動とシェーダー更新
    if (rainbowChicken) {
        moveChicken(rainbowChicken);
        // 虹色シェーダーの時間更新
        if (rainbowChicken.userData.shader) {
            rainbowChicken.userData.shader.uniforms.time.value = performance.now() * 0.001;
        }
    }

    // ハートの回転アニメーション (見た目)
    const heartRotationSpeed = 1.5 * deltaTime;
    for (const heartData of bigHearts) {
        if (heartData.mesh && heartData.mesh.visible) {
            heartData.mesh.rotation.y += heartRotationSpeed;
        }
    }

    // ハート回復判定
    if (bird && bird.visible && hp < MAX_HP) {
         for (let i = 0; i < bigHearts.length; i++) {
             const heartData = bigHearts[i];
             if (heartData.mesh && heartData.mesh.visible) {
                 if (bird.position.distanceToSquared(heartData.mesh.position) < (1.5 + 1.8)**2) {
                     hp = MAX_HP;
                     updateInfo();
                     updateHeartDisplay(bird.userData.nameObj, hp);
                     playCoinSound(); // 回復音
                     respawnBigHeart(i); // ハートを消してリスポーンタイマー開始

                     // HP回復を通知
                     if (channel) {
                          channel.publish('hp_update', { id: myId, hp: hp, score: score });
                     }
                     break; // 1フレームで1つだけ回復
                 }
             }
         }
    }
}

function updateUIElements() {
    updateAllNameObjPositions(); // 全プレイヤーの名前・HPラベル位置更新
    updateDashGaugeUI(); // ダッシュゲージ表示更新
    // ランキングはPresence Update時やスコア変動時に更新するので、毎フレームは不要かも
    // updateRanking();
}

function renderScene() {
    renderer.render(scene, camera);
}