import type { Handler } from "@netlify/functions";

// Google Trends のレスポンス先頭にある “)]}',” を自動で除去
function safeJsonParse(text: string) {
  try {
    // 先頭に ")]}'," がつく場合がある
    const cleaned = text.replace(/^\)\]\}',?/, "");
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

// fetch のリトライ（429 / 500 対策）
async function fetchWithRetry(url: string, options = {}, retry = 2) {
  try {
    const res = await fetch(url, options);
    if (!res.ok) throw new Error("Fetch failed");
    return res;
  } catch (e) {
    if (retry > 0) {
      return fetchWithRetry(url, options, retry - 1);
    }
    throw e;
  }
}

export const handler: Handler = async (event) => {
  const { keyword } = JSON.parse(event.body || "{}");

  if (!keyword) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "キーワードが必要です" }),
    };
  }

  try {
    const reqPayload = {
      comparisonItem: [{ keyword, time: "today 1-m" }],
      category: 0,
      property: "",
    };

    const exploreUrl =
      "https://trends.google.com/trends/api/explore?hl=ja&tz=-540&req=" +
      encodeURIComponent(JSON.stringify(reqPayload));

    // 1) explore 取得
    const exploreRes = await fetchWithRetry(exploreUrl);
    const exploreText = await exploreRes.text();

    const exploreJson = safeJsonParse(exploreText);
    if (!exploreJson || !exploreJson.widgets) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: "Explore JSON parse error",
          raw: exploreText.slice(0, 200),
        }),
      };
    }

    // 2) Widgets を検索
    const relatedWidget = exploreJson.widgets.find(
      (w: any) => w.id === "RELATED_QUERIES"
    );
    const timelineWidget = exploreJson.widgets.find(
      (w: any) => w.id === "TIMESERIES"
    );

    if (!relatedWidget || !timelineWidget) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: "Cannot find expected widgets",
        }),
      };
    }

    // 3) 関連キーワード API
    const relatedUrl =
      "https://trends.google.com/trends/api/widgetdata/relatedsearches?hl=ja&tz=-540&req=" +
      encodeURIComponent(JSON.stringify(relatedWidget.request)) +
      "&token=" +
      relatedWidget.token;

    const relatedRes = await fetchWithRetry(relatedUrl);
    const relatedText = await relatedRes.text();
    const relatedJson = safeJsonParse(relatedText);

    // 4) タイムライン API
    const timelineUrl =
      "https://trends.google.com/trends/api/widgetdata/multiline?hl=ja&tz=-540&req=" +
      encodeURIComponent(JSON.stringify(timelineWidget.request)) +
      "&token=" +
      timelineWidget.token;

    const timelineRes = await fetchWithRetry(timelineUrl);
    const timelineText = await timelineRes.text();
    const timelineJson = safeJsonParse(timelineText);

    // 5) データ整形
    const related =
      relatedJson?.default?.rankedList ?? [];

    const timeline =
      timelineJson?.default?.timelineData?.map((item: any) => ({
        formattedTime: item.formattedTime,
        value: item.value,
      })) ?? [];

    return {
      statusCode: 200,
      body: JSON.stringify({
        related,
        timeline,
      }),
    };
  } catch (e) {
    ret
