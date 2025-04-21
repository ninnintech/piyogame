// Node.js + ws で簡易WebSocketサーバー
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const uuidv4 = require('uuid').v4;

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static('public'));

let clients = {}; // id: { ws, state, hp, score }
let missiles = []; // { id, ownerId, x, y, z, dx, dy, dz, life }

function broadcastUserCount() {
  const count = Object.keys(clients).length;
  Object.values(clients).forEach(peer => {
    peer.ws.send(JSON.stringify({ type: 'user_count', count }));
  });
}

// --- スコアランキングを全員に送信 ---
function broadcastRanking() {
  // スコアが高い順に上位3人
  const top3 = Object.entries(clients)
    .filter(([id, c]) => c.state && c.state.name)
    .map(([id, c]) => ({ name: c.state.name, score: c.score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  Object.values(clients).forEach(peer => {
    peer.ws.send(JSON.stringify({ type: 'ranking', top3 }));
  });
}

wss.on('connection', function connection(ws) {
  const id = uuidv4();
  clients[id] = { ws, state: {}, hp: 5, score: 0 };
  ws.send(JSON.stringify({ type: 'welcome', id }));
  broadcastUserCount();
  broadcastRanking();

  ws.on('message', function incoming(message) {
    let msg;
    try {
      msg = JSON.parse(message);
    } catch (e) { return; }
    if (msg.type === 'state') {
      clients[id].state = msg;
      Object.entries(clients).forEach(([pid, peer]) => {
        if (pid !== id) {
          peer.ws.send(JSON.stringify({ type: 'peer', id, state: msg, hp: clients[id].hp, score: clients[id].score }));
        }
      });
      broadcastUserCount();
      broadcastRanking();
    } else if (msg.type === 'fire') {
      const missileId = uuidv4();
      missiles.push({
        id: missileId,
        ownerId: id,
        x: msg.x, y: msg.y, z: msg.z,
        dx: msg.dx, dy: msg.dy, dz: msg.dz,
        life: 0
      });
      Object.values(clients).forEach(peer => {
        peer.ws.send(JSON.stringify({ type: 'missile', missile: { ...missiles[missiles.length-1] } }));
      });
    } else if (msg.type === 'hit') {
      const targetId = msg.targetId;
      if (clients[targetId]) {
        clients[targetId].hp--;
        if (clients[targetId].hp <= 0) {
          clients[targetId].hp = 5;
          clients[targetId].score = 0; // 体力0でスコアリセット
          clients[targetId].ws.send(JSON.stringify({ type: 'respawn', x: 0, y: 4, z: 0 }));
        }
        clients[id].score += 3;
        Object.entries(clients).forEach(([pid, peer]) => {
          peer.ws.send(JSON.stringify({ type: 'hp_score', id: targetId, hp: clients[targetId].hp, score: clients[targetId].score }));
          peer.ws.send(JSON.stringify({ type: 'hp_score', id: id, hp: clients[id].hp, score: clients[id].score }));
        });
        broadcastRanking();
      }
    } else if (msg.type === 'coin_get') {
      clients[id].score += 1;
      Object.entries(clients).forEach(([pid, peer]) => {
        peer.ws.send(JSON.stringify({ type: 'hp_score', id, hp: clients[id].hp, score: clients[id].score }));
      });
      broadcastRanking();
    }
  });

  ws.on('close', function() {
    // ログアウト時スコアリセット
    if (clients[id]) clients[id].score = 0;
    delete clients[id];
    Object.values(clients).forEach(peer => {
      peer.ws.send(JSON.stringify({ type: 'leave', id }));
    });
    broadcastUserCount();
    broadcastRanking();
  });
});

const PORT = 8080;
server.listen(PORT, () => {
  console.log('HTTP/WebSocket server running on http://localhost:' + PORT);
});
