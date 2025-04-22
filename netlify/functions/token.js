// netlify/functions/token.js
const Ably = require('ably');

exports.handler = async function(event, context) {
  // 1. 環境変数名を指定 (Netlifyの設定と完全に一致させる)
  const apiKey = process.env.ABLYKEY; // ★★★ Netlifyの環境変数名を確認 ★★★

  // 2. 環境変数が取得できているかログで確認（デプロイ後にNetlifyのログで確認）
  console.log('===== ABLYKEY CHECK in handler =====');
  console.log('ABLYKEY retrieved:', apiKey ? `Exists (length: ${apiKey.length})` : 'NOT FOUND or empty!');
  console.log('===== END ABLYKEY CHECK in handler =====');

  // 3. 環境変数が設定されていない場合はエラーを返す
  if (!apiKey) {
    console.error('Error: ABLYKEY environment variable is not set or empty.');
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: 'Server configuration error: Ably API Key is missing.' }),
    };
  }

  try {
    // 4. Ably RESTクライアントを正しい方法で初期化 ★★★ ここを修正 ★★★
    const ably = new Ably.Rest({ key: apiKey });

    // クライアントID（任意ですが、デバッグや管理に役立ちます）
    // フロントエンドからクエリパラメータで渡すことも可能です
    // 例: fetch('/api/token?clientId=user123')
    const clientId = event.queryStringParameters?.clientId || 'user-' + Math.random().toString(36).substring(2, 9);
    console.log(`Generating token for clientId: ${clientId}`);

    // 5. トークンリクエストを作成 (async/await を使用)
    //    createTokenRequest は Promise を返すため await が使えます
    //    capability: { '*': ['publish', 'subscribe', 'presence'] } を明示的に付与
    const tokenParams = { clientId: clientId, capability: { '*': ['publish', 'subscribe', 'presence'] } };
    const tokenRequest = await ably.auth.createTokenRequest(tokenParams);

    console.log('Ably token request generated successfully.');

    // 6. 成功したらトークンリクエストを返す
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(tokenRequest),
    };

  } catch (error) {
    // 7. エラーハンドリング
    console.error('Ably token request failed:', error);
    // エラーの詳細をログに出力
    console.error('Error details:', error.message, 'Code:', error.code, 'StatusCode:', error.statusCode);

    // Ablyのエラー情報があればそれに基づいてステータスコードを設定
    const statusCode = error.statusCode || 500;
    // クライアントに返すエラーメッセージ（本番では詳細情報を隠すことも検討）
    const errorMessage = `Failed to generate Ably token. Ably code: ${error.code || 'N/A'}`;

    return {
      statusCode: statusCode,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: errorMessage }),
    };
  }
};