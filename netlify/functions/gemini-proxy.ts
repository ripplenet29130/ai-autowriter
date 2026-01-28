export const handler = async (event: any) => {
  try {
    const body = JSON.parse(event.body || '{}');
    const { prompt, apiKey, model, temperature, maxTokens } = body;

    console.log("🟢 Gemini Proxy 受信データ:", { prompt, apiKey, model, temperature, maxTokens });

    if (!apiKey) {
      console.error("❌ APIキーがありません");
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "API key missing" })
      };
    }

    const modelName = model || "gemini-2.5-flash";
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

    console.log("🔵 Gemini API URL:", apiUrl);

    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: temperature ?? 0.7,
        maxOutputTokens: maxTokens ?? 4000,
      },
    };

    console.log("🟣 送信内容:", payload);

    const resp = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await resp.json();

    console.log("🟡 Gemini APIレスポンス:", data);

    if (!resp.ok) {
      console.error("❌ Gemini API Error:", data);
      return {
        statusCode: 502,
        body: JSON.stringify({ error: "Gemini API error", details: data })
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify(data)
    };

  } catch (err: any) {
    console.error("🔥 Gemini Proxy internal error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
