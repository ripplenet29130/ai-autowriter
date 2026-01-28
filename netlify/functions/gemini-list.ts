// netlify/functions/gemini-list.ts
export const handler = async (event: any) => {
  const apiKey =
    event.queryStringParameters?.key ||
    (event.body ? JSON.parse(event.body).apiKey : null);

  if (!apiKey) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Missing API key" }),
      headers: { "Access-Control-Allow-Origin": "*" },
    };
  }

  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta1/models?key=${apiKey}`
    );
    const data = await resp.json();

    return {
      statusCode: 200,
      body: JSON.stringify(data, null, 2),
      headers: { "Access-Control-Allow-Origin": "*" },
    };
  } catch (e: any) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: e.message }),
      headers: { "Access-Control-Allow-Origin": "*" },
    };
  }
};
