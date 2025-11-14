import type { Handler } from "@netlify/functions";

export const handler: Handler = async (event) => {
  const { keyword } = JSON.parse(event.body || "{}");

  if (!keyword) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "キーワードが必要です" }),
    };
  }

  try {
    const exploreUrl = `https://trends.google.com/trends/api/explore?hl=ja&tz=-540&req=${encodeURIComponent(
      JSON.stringify({
        comparisonItem: [{ keyword, time: "today 1-m" }],
        category: 0,
        property: "",
      })
    )}`;

    const exploreRes = await fetch(exploreUrl);
    const exploreText = await exploreRes.text();
    const exploreJson = JSON.parse(exploreText.slice(5));

    const relatedWidget = exploreJson.widgets.find(
      (w: any) => w.id === "RELATED_QUERIES"
    );
    const timelineWidget = exploreJson.widgets.find(
      (w: any) => w.id === "TIMESERIES"
    );

    const relatedUrl = `https://trends.google.com/trends/api/widgetdata/relatedsearches?hl=ja&tz=-540&req=${encodeURIComponent(
      JSON.stringify(relatedWidget.request)
    )}&token=${relatedWidget.token}`;

    const timelineUrl = `https://trends.google.com/trends/api/widgetdata/multiline?hl=ja&tz=-540&req=${encodeURIComponent(
      JSON.stringify(timelineWidget.request)
    )}&token=${timelineWidget.token}`;

    const [relatedRes, timelineRes] = await Promise.all([
      fetch(relatedUrl),
      fetch(timelineUrl),
    ]);

    const relatedJson = JSON.parse((await relatedRes.text()).slice(5));
    const timelineJson = JSON.parse((await timelineRes.text()).slice(5));

    return {
      statusCode: 200,
      body: JSON.stringify({
        related: relatedJson.default.rankedList,
        timeline: timelineJson.default.timelineData,
      }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Google Trends Error", details: e }),
    };
  }
};
