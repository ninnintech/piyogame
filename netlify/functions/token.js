console.log('===== ABLYKEY CHECK =====');
console.log('ABLYKEY:', process.env.ABLYKEY, 'length:', process.env.ABLYKEY ? process.env.ABLYKEY.length : 'undefined');
console.log('===== END ABLYKEY CHECK =====');

console.log('ABLYKEY:', process.env.ABLYKEY);
const Ably = require('ably');

exports.handler = async function(event, context) {
  const apiKey = process.env.ABLYKEY; // Netlifyの環境変数名
  const client = new Ably.Rest(apiKey);

  return new Promise((resolve, reject) => {
    client.auth.createTokenRequest({}, (err, tokenRequest) => {
      if (err) {
        resolve({
          statusCode: 500,
          body: JSON.stringify({ error: 'Ablyトークン生成エラー' })
        });
      } else {
        resolve({
          statusCode: 200,
          body: JSON.stringify(tokenRequest)
        });
      }
    });
  });
};