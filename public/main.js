import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.152.2/build/three.module.js';

// --- グローバル変数宣言 ---
let scene, camera, renderer, canvas;
let move = { forward: 0, turn: 0, up: 0 };
let myId = null;
let myName = '';
let myColor = '';
let bird = null;
let hp = 0;
let score = 0;
let MAX_HP = 5;
let channel = null;
let ably = null;
// 必要に応じて他のグローバルも追加

// --- Ably初期化の本実装 ---
function initAbly() {
    // Ably APIキーは index.html で window.ABLY_KEY に埋め込まれている前提
    if (!window.ABLY_KEY) {
        alert('AblyのAPIキーが設定されていません。');
        return;
    }
    // Ablyインスタンスを生成
    ably = new Ably.Realtime({ key: window.ABLY_KEY, clientId: myId });
    // チャンネル名は "bird-garden" で固定（必要に応じて変更可）
    channel = ably.channels.get('bird-garden');

    // Presence（入室管理）
    channel.presence.enter({ id: myId, name: myName, color: myColor, score: score, hp: hp });

    // メッセージ受信イベント登録例
    channel.subscribe('hp_update', (msg) => {
        // 他プレイヤーのHP更新を受信したときの処理例
        // 例: updateOtherPlayerHP(msg.data.id, msg.data.hp, msg.data.score);
        // console.log('HP update:', msg.data);
    });
    // 必要に応じて他のイベントも登録
}

// --- 必須: ダミー初期化関数（ゲーム進行に必要な場合） ---
// 本来は個別ファイルや詳細な処理が必要ですが、
// ここでは最低限エラーを防ぐためのダミー関数を追加します。
if (typeof createTerrain !== 'function') {
    function createTerrain() {
        // TODO: 地形生成の詳細実装
        console.warn('createTerrain() is a dummy. Implement actual terrain logic.');
    }
}
if (typeof placeObjects !== 'function') {
    function placeObjects() {
        // TODO: オブジェクト配置の詳細実装
        console.warn('placeObjects() is a dummy. Implement actual object placement logic.');
    }
}
if (typeof setupPlayerBird !== 'function') {
    function setupPlayerBird() {
        // TODO: プレイヤー鳥生成の詳細実装
        console.warn('setupPlayerBird() is a dummy. Implement actual player bird logic.');
    }
}

// --- Three.jsグラフィックス初期化 ---
let TERRAIN_SIZE = 400; // 地形サイズ

function initGraphics() {
    canvas = document.getElementById('game-canvas');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x87ceeb); // 空色
    renderer.shadowMap.enabled = true;

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 2000);

    // ライト
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(40, 80, 40);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 500;
    scene.add(dirLight);
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

    loginBtn.onclick = null; // 多重登録防止
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
    try {
        initGraphics();
        showLogin();
        // 必要に応じて他の初期化（例：Ably接続、BGM再生など）
    } catch (e) {
        console.error("ログイン画面の初期化エラー:", e);
    }
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
    renderer.render(scene, camera)
}

async function startGame() {
    // ログイン画面を非表示
    const loginModal = document.getElementById('login-modal');
    if (loginModal) loginModal.style.display = 'none';

    // ゲームキャンバスを表示
    const canvas = document.getElementById('game-canvas');
    if (canvas) canvas.style.display = 'block';

    // 入力初期化（必ず最初に呼ぶ！）
    if (typeof initInput === 'function') {
        initInput();
    }

    // 必要な初期化処理（例：Ably接続、BGM再生など）
    if (!ably) {
        myId = myId || `Guest_${Math.random().toString(36).slice(2, 7)}`;
        ably = await initAbly(myId); // Promiseならawait
    }
    if (ably && typeof setupRealtimeConnection === 'function') {
        setupRealtimeConnection();
    }

    // BGM再生（audio要素IDをbgm-audioに修正）
    const bgm = document.getElementById('bgm-audio');
    if (bgm && bgm.paused) {
        bgm.volume = 0.6;
        bgm.play().catch(() => {
            // ユーザー操作が必要な場合の案内
            const msg = 'BGMを再生するには画面をタップしてください。';
            if (!document.getElementById('bgm-tap-hint')) {
                const hint = document.createElement('div');
                hint.id = 'bgm-tap-hint';
                hint.textContent = msg;
                hint.style.position = 'fixed';
                hint.style.top = '50%';
                hint.style.left = '50%';
                hint.style.transform = 'translate(-50%, -50%)';
                hint.style.background = 'rgba(255,255,255,0.92)';
                hint.style.padding = '24px 32px';
                hint.style.fontSize = '1.3em';
                hint.style.color = '#222';
                hint.style.borderRadius = '16px';
                hint.style.zIndex = 10000;
                document.body.appendChild(hint);
                const tapHandler = () => {
                    bgm.play().catch(()=>{});
                    hint.remove();
                    window.removeEventListener('pointerdown', tapHandler);
                };
                window.addEventListener('pointerdown', tapHandler);
            }
        });
    }

    // Three.jsグラフィックス初期化（必ず呼ぶ）
    if (typeof initGraphics === 'function') {
        initGraphics();
    }
    // 地形・オブジェクト・プレイヤー鳥を必ず生成
    if (typeof createTerrain === 'function') {
        createTerrain();
    }
    if (typeof placeObjects === 'function') {
        placeObjects();
    }
    if (typeof setupPlayerBird === 'function') {
        setupPlayerBird();
    }

    // 3Dスティック（ジョイスティックUI）表示
    if (typeof showJoystick === 'function') {
        showJoystick();
    }

    // アニメーションループ開始（必ず呼ぶ）
    if (typeof animate === 'function') {
        requestAnimationFrame(animate);
    }
}
window.startGame = startGame;

// --- 入力初期化 ---
function initInput() {
    // キーボード
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    // ボタン
    const btns = [
        { id: 'missile-btn', action: () => launchMissile(myId, bird.position, bird.getWorldDirection(new THREE.Vector3())) },
        { id: 'dash-btn', action: () => startDash() },
        { id: 'up-btn', action: () => move.up = 1 },
        { id: 'down-btn', action: () => move.up = -1 }
    ];
    btns.forEach(({id, action}) => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.ontouchstart = btn.onmousedown = (e) => { e.preventDefault(); action(); };
            btn.ontouchend = btn.onmouseup = (e) => { e.preventDefault(); if(id==='up-btn'||id==='down-btn') move.up = 0; };
        }
    });
}

function onKeyDown(e) {
    switch(e.key) {
        case 'w': case 'ArrowUp': move.forward = 1; break;
        case 's': case 'ArrowDown': move.forward = -1; break;
        case 'a': case 'ArrowLeft': move.turn = -1; break;
        case 'd': case 'ArrowRight': move.turn = 1; break;
        case ' ': move.up = 1; break;
        case 'Shift': move.up = -1; break;
    }
}
function onKeyUp(e) {
    switch(e.key) {
        case 'w': case 'ArrowUp': case 's': case 'ArrowDown': move.forward = 0; break;
        case 'a': case 'ArrowLeft': case 'd': case 'ArrowRight': move.turn = 0; break;
        case ' ': case 'Shift': move.up = 0; break;
    }
}

// --- ジョイスティックUI ---
function showJoystick() {
    if (!window.nipplejs) return;
    let zone = document.getElementById('joystick-zone');
    if (!zone) {
        zone = document.createElement('div');
        zone.id = 'joystick-zone';
        zone.style.position = 'absolute';
        zone.style.left = '10px';
        zone.style.bottom = '10px';
        zone.style.width = '120px';
        zone.style.height = '120px';
        zone.style.zIndex = 10;
        document.body.appendChild(zone);
    }
    // 既存のジョイスティックを削除してから新規作成
    if (zone._manager && zone._manager.destroy) zone._manager.destroy();
    const manager = nipplejs.create({
        zone,
        mode: 'static',
        position: { left: '60px', bottom: '60px' },
        color: 'blue',
        size: 100
    });
    zone._manager = manager;
    manager.on('move', (evt, data) => {
        if (data && data.angle && data.distance > 10) {
            // 上方向を前進、右方向を右旋回
            const rad = data.angle.radian;
            move.forward = Math.sin(rad); // 上(+y)で1
            move.turn = Math.cos(rad);    // 右(+x)で1
        }
    });
    manager.on('end', () => {
        move.forward = 0; move.turn = 0;
    });
}