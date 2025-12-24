// ===============================================
// aiEngine.ts
// すべてのAIロジック（中心テーマ抽出・プロンプト生成・API呼び出し）
// ===============================================

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

/* -----------------------------------------------
  共通：言語設定取得
------------------------------------------------ */
function getLanguageSettings(language: string) {
  const langLabel =
    language === "ja"
      ? "日本語"
      : language === "en"
      ? "英語"
      : language === "zh"
      ? "中国語"
      : language === "ko"
      ? "韓国語"
      : "日本語";

  const langNote =
    language === "ja"
      ? "自然で読みやすい日本語で書いてください。"
      : language === "en"
      ? "Write in natural, fluent, and readable English for a general audience."
      : language === "zh"
      ? "请使用自然、流畅、易读的简体中文撰写文章。"
      : language === "ko"
      ? "자연스럽고 읽기 쉬운 한국어로 작성해주세요."
      : "自然で読みやすい日本語で書いてください。";

  return { langLabel, langNote };
}

/* -----------------------------------------------
  共通：ハルシネーション防止・事実性ルール
------------------------------------------------ */
function getHallucinationPreventionRules() {
  return `【ハルシネーション防止・事実性ルール（最重要）】
・事実として断定できない内容は創作しないこと
・存在しない制度、法律、判例、統計、数値、行政手続きは記載しないこと
・「実際にあった事例」は、一般化したモデルケースとして表現し、
  具体的な人物・金額・日付・判例・行政名・制度名を創作しないこと
・不確かな情報は
  「一般的には」「ケースによって異なります」
  「地域や状況により異なる場合があります」などの表現を用いること
・最新の法改正や制度内容について確証がない場合は
  「最新情報は専門家へご確認ください」と明示すること

・事実確認ができない内容は以下のいずれかで処理すること：
  ① 記載しない
  ② 一般論として曖昧化して記載する
  ③ 注意喚起として記載する（断定しない）

・事例紹介では特定の地域・個別性が強い表現は禁止し、
  「よくあるご相談例として」などの表現に限定する
・期限・日数・金額・罰則などの数値は
  一般的・概括的な説明に留める
・断定的な数値を出す場合は
  「法律上」「一般的に」など前提条件を必ず付ける`;
}

/* -----------------------------------------------
  共通：出典・根拠の表現例
------------------------------------------------ */
function getSourceExamples() {
  return `【出典・根拠の表現例】
・民法（相続・遺言に関する基本規定）
・法務局が公開している相続・登記に関する一般情報
・行政書士実務における一般的な手続き解説資料
・各自治体が公表している相続・戸籍手続きの案内
・士業実務で広く共有されている一般的な運用知識

※ 正確性が保証できない内容については
  必ず「詳細は専門家へご確認ください」と補足すること`;
}

/* -----------------------------------------------
  共通：検索情報（facts）の扱いルール
------------------------------------------------ */
function getFactsHandlingRules() {
  return `【検索情報（facts）の扱いルール（最重要）】

・本記事は、事前に取得された検索結果（facts）を根拠として作成すること
・facts に含まれる情報以外の事実を新たに創作しないこと
・facts に含まれる内容は、本文中で「一般的に〜とされています」「公表情報では〜とされています」などの形で必ず反映すること
・facts に含まれない情報については、推測・補完・拡張を行わないこと
・facts が不足している場合は、一般論として安全に曖昧化すること
・facts の内容が抽象的な場合は、記事全体を「一般的な考え方の整理」に寄せ、具体的な断定や事例表現は行わないこと`;
}

/* -----------------------------------------------
  共通：出典・根拠セクションの作成ルール（検索連動）
------------------------------------------------ */
function getSourceSectionRules() {
  return `【出典・根拠セクションの作成ルール（検索連動）】

・「出典・根拠」セクションでは、facts に含まれる情報のみを元に記載すること
・以下の形式で記載すること：

例：
・生成AIに関する一般的な解説資料（海外AI企業が公開している公式情報）
・AIアシスタントの仕様・考え方に関する公開情報（主要AIサービス提供企業）
・検索結果で確認されたAI関連サービスの公式案内情報

・facts に含まれない情報源は出典として記載しないこと
・「出典・根拠」セクションは、facts の件数分のみ記載し、数を増やしたり統合したりしないこと`;
}

/* -----------------------------------------------
  共通：出典・根拠の明示ルール（URL非表示）
------------------------------------------------ */
function getSourceDisplayRules() {
  return `【出典・根拠の明示ルール（URL非表示）】

記事の最後に、以下の条件を満たす
「出典・根拠」セクションを必ず設けてください。

■ 記載内容のルール
・実在する公的制度・一般的な実務慣行のみを対象とする
・存在が不確かな制度や資料は記載しない
・URLやリンクは一切記載しない
・断定ではなく「根拠として参照される代表的な情報源」
　という書き方にする

■ 表現方法
以下のような形式で箇条書きにすること：

【出典・根拠として参照される一般的な情報】
・民法（相続・遺言に関する基本規定）
・法務局が公開している相続・登記に関する一般情報
・行政書士実務における一般的な手続き解説資料
・各自治体が公表している相続・戸籍手続きの案内
・士業実務で広く共有されている一般的な運用知識

■ 注意事項
・「◯年改正」「最新の判例によると」など、
　正確性が保証できない表現は使用しない
・個別の判断が必要な内容については、
　必ず「詳細は専門家へご確認ください」と補足する`;
}

/* -----------------------------------------------
  共通：追加指示
------------------------------------------------ */
function getAdditionalInstructions() {
  return `【追加指示（重要）】

■ リード文（導入）
・250〜300字
・2〜3文で構成し、段落内は一文ごとに <br> を入れる
・読者が興味を持つ背景・問題提起・内容の要約を書く

■ つかみ（本文への導入）
・2〜3文で構成
・段落内は一文ごとに <br> を入れる
・続きを読みたくなる期待感を高める内容にする

■ 本文構成
・<h3> から本文を開始する
・各説明パートは 2〜3文で1段落
・段落内の一文ごとに <br> を必ず入れる`;
}

/* -----------------------------------------------
  共通：HTMLルール
------------------------------------------------ */
function getHTMLRules() {
  return `【HTMLルール】

 1. 出力は JSON のみ
 2. JSON は "title" と "content" の2フィールドのみ
 3. title はテキストのみ（HTMLタグ禁止）
 4. content は <p>...</p> のあとに <h3> を続ける
 5. <h1>, <h2>, <h5>, <h6> は使用禁止
 6. 段落は必ず <p> で囲み、一文ごとに <br> を入れる
 7. 改行文字（\\n）、コードブロック（\`\`\`）は禁止
 8. 最後に <h3>まとめ</h3><p>...</p> を付ける`;
}

/* -----------------------------------------------
  共通：出力形式
------------------------------------------------ */
function getOutputFormat() {
  return `【出力形式（これのみ）】

{
"title": "タイトル",
"content": "<p>リード文文1。<br>文2。<br>文3。</p><p>つかみ文1。<br>文2。<br>文3。</p><h3>見出し</h3><p>本文文1。<br>文2。</p><h3>まとめ</h3><p>まとめ文1。<br>文2。</p>"
}`;
}

/* -----------------------------------------------
  プロンプト生成（中心テーマのみ使用）
------------------------------------------------ */
export function buildUnifiedPrompt(center, aiConfig) {
  const tone = aiConfig.tone || "ナチュラル";
  const style = aiConfig.style || "ブログ風";
  const length = aiConfig.article_length || "中程度";
  const language = aiConfig.language || "ja";

  const { langLabel } = getLanguageSettings(language);

  return `
あなたはSEOに強いプロのライターです。
以下の条件で${langLabel}の記事を作成してください。

${getHallucinationPreventionRules()}

${getSourceExamples()}

【記事の中心テーマ（最重要）】
${center}
※この記事は上記テーマ1つだけを深く掘り下げてください。
※他の関連話題には触れなくてよい。

【文体トーン】
${tone}

【スタイル】
${style}

【ボリューム】
${length}

${getSourceDisplayRules()}

${getAdditionalInstructions()}

${getHTMLRules()}

${getOutputFormat()}`;
}

/* -----------------------------------------------
  プロンプト生成（事実データ facts を使用）
  ※ 創作を最小化するための専用プロンプト
------------------------------------------------ */
export function buildUnifiedPromptWithFacts(center, facts, aiConfig) {
  const tone = aiConfig.tone || "ナチュラル";
  const style = aiConfig.style || "ブログ風";
  const length = aiConfig.article_length || "中程度";
  const language = aiConfig.language || "ja";

  const { langLabel } = getLanguageSettings(language);

  const factsText = facts
    .map(
      (f, i) =>
        `${i + 1}. ${f.content}（出典：${f.source}）`
    )
    .join("\n");

  return `
あなたはSEOおよびAIOに精通した専門ライターです。
以下の条件で${langLabel}の記事を作成してください。

${getFactsHandlingRules()}

${getHallucinationPreventionRules()}

${getSourceSectionRules()}

${getSourceExamples()}

【記事の中心テーマ】
${center}

【事実情報（この情報のみ使用可）】
${factsText}

【文体トーン】
${tone}

【スタイル】
${style}

【ボリューム】
${length}

${getSourceDisplayRules()}

${getAdditionalInstructions()}

${getHTMLRules()}

${getOutputFormat()}`;
}


/* -----------------------------------------------
  AIプロバイダ共通呼び出し
------------------------------------------------ */
export async function callAI(aiConfig, prompt) {
  const provider = (aiConfig.provider || "").toLowerCase();
  let text = "";

  // ---------- Gemini ----------
  if (provider.includes("gemini")) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${aiConfig.model}:generateContent?key=${aiConfig.api_key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: aiConfig.temperature ?? 0.7,
            maxOutputTokens: aiConfig.max_tokens ?? 4000
          }
        })
      }
    );
    const data = await res.json();
    text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  }

  // ---------- OpenAI ----------
  else if (provider.includes("openai")) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${aiConfig.api_key}`
      },
      body: JSON.stringify({
        model: aiConfig.model,
        messages: [{ role: "user", content: prompt }],
        temperature: aiConfig.temperature ?? 0.7,
        max_tokens: aiConfig.max_tokens ?? 4000
      })
    });
    const data = await res.json();
    text = data?.choices?.[0]?.message?.content || "";
  }

  // ---------- Claude ----------
  else if (provider.includes("claude")) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": aiConfig.api_key,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: aiConfig.model,
        messages: [{ role: "user", content: prompt }],
        temperature: aiConfig.temperature ?? 0.7,
        max_tokens: aiConfig.max_tokens ?? 4000
      })
    });
    const data = await res.json();
    text = data?.content?.[0]?.text || "";
  }

  return text;
}

/* -----------------------------------------------
  JSON抽出＋成形
------------------------------------------------ */
export function parseArticle(rawText) {
  const match = rawText.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("JSON構造が見つかりませんでした");

  const article = JSON.parse(match[0]);

  article.content = article.content
    .replace(/\\n|\\r|\\t/g, "")
    .replace(/\n+/g, "")
    .trim();

  return article;
}


export function buildRewritePrompt(
  article: { title: string; content: string },
  reasons: string[]
) {
  return `
以下の記事には事実性の問題があります。
指摘事項を修正してください。

【指摘内容】
${reasons.map(r => `- ${r}`).join("\n")}

【修正ルール】
・facts に基づかない内容は削除または一般化する
・断定表現は避ける
・構成は大きく変えない

【記事】
タイトル：${article.title}
本文：
${article.content}
`;
}
