// Ably認証サーバー - APIキーを安全に管理するための実装
const express = require('express');
const Ably = require('ably');
const cors = require('cors');
const dotenv = require('dotenv');

// .envファイルから環境変数を読み込む
dotenv.config();

// APIキーを環境変数から取得
const ABLY_API_KEY = process.env.ABLY_API_KEY;
if (!ABLY_API_KEY) {
  console.error('エラー: ABLY_API_KEYが設定されていません');
  console.error('.envファイルに ABLY_API_KEY=あなたのキー を追加してください');
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3000;

// CORS設定（クロスオリジンリクエストを許可）
app.use(cors());

// 静的ファイルのサービング
app.use(express.static('public'));

// Ablyインスタンスの初期化
const ably = new Ably.Rest({ key: ABLY_API_KEY });

// Ablyトークン発行エンドポイント
app.get('/api/token', async (req, res) => {
  try {
    // ランダムなクライアントIDを生成
    const clientId = 'bird-' + Math.random().toString(36).substring(2, 9);
    
    // トークンリクエストを作成
    const tokenRequest = await ably.auth.createTokenRequest({
      clientId,
      capability: {
        'bird-garden-3d': ['publish', 'subscribe'] // チャンネル名とパーミッション
      }
    });
    
    // クライアントにトークンリクエストを返す
    res.json(tokenRequest);
  } catch (error) {
    console.error('トークン生成エラー:', error);
    res.status(500).json({ error: error.message });
  }
});

// サーバー起動
app.listen(PORT, () => {
  console.log(`Ably認証サーバーが起動しました: http://localhost:${PORT}`);
  console.log(`Ablyトークンエンドポイント: http://localhost:${PORT}/api/token`);
});
