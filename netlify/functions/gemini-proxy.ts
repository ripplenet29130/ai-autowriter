import { Handler } from "@netlify/functions";

export const handler: Handler = async (event) => {
  try {
    const { keyword } = JSON.parse(event.body || "{}");
    const GEMINI_API_KEY =
      process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;

    if (!GEMINI_API_KEY) {
      throw new Error("Gemini APIキーが設定されていません");
    }

    const prompt = `
あなたはプロのSEOライターです。
次のキーワードで日本語の記事を800文字程度で生成してください。
キーワード: ${keyword}
`;

    // ✅ 正しいエンドポイント（v1beta版）
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
        }),
      }
    );

    if (!response.ok) {
      const text = await response.text();
      console.error("❌ Gemini API Error:", text);
      throw new Error("Gemini API呼び出しに失敗しました");
    }

    const result = await response.json();

    const article = {
      title: `${keyword}に関する記事`,
      content:
        result.candidates?.[0]?.content?.parts?.[0]?.text ||
        "生成に失敗しました。",
    };

    return {
      statusCode: 200,
      body: JSON.stringify(article),
    };
  } catch (err: any) {
    console.error(err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
