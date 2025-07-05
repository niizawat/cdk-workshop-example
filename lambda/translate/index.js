const { TranslateClient, TranslateTextCommand } = require('@aws-sdk/client-translate');

const translateClient = new TranslateClient({ region: process.env.AWS_REGION });

exports.handler = async (event) => {
  console.log('Event:', JSON.stringify(event, null, 2));
  
  // レスポンスヘッダーを設定
  const headers = {
    'Content-Type': 'application/json'
  };

  try {
    // POSTメソッド以外は拒否
    if (event.httpMethod !== 'POST') {
      return {
        statusCode: 405,
        headers,
        body: JSON.stringify({ error: 'Method Not Allowed' })
      };
    }

    // リクエストボディの解析（base64デコード対応）
    let requestBody = event.body || '{}';
    
    // base64エンコードされている場合はデコード
    if (event.isBase64Encoded) {
      requestBody = Buffer.from(requestBody, 'base64').toString('utf-8');
    }
    
    const body = JSON.parse(requestBody);
    const { text, sourceLang = 'auto', targetLang = 'ja' } = body;

    if (!text) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'テキストが指定されていません' })
      };
    }

    // Amazon Translateで翻訳実行
    const command = new TranslateTextCommand({
      Text: text,
      SourceLanguageCode: sourceLang,
      TargetLanguageCode: targetLang
    });

    const result = await translateClient.send(command);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        originalText: text,
        translatedText: result.TranslatedText,
        sourceLang: result.SourceLanguageCode,
        targetLang: result.TargetLanguageCode
      })
    };

  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: '翻訳処理でエラーが発生しました' })
    };
  }
}; 