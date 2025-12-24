type Fact = {
    source: string;
    content: string;
  };
  
  type FactCheckResult = {
    status: "ok" | "reject";
    reasons: string[];
  };
  
  export async function factCheckArticle(
    article: { title: string; content: string },
    facts: Fact[],
    callAI: (prompt: string) => Promise<string>
  ): Promise<FactCheckResult> {
  
    // 🔹 ① facts にない内容を使っていないか
    // 🔹 ② 断定表現が強すぎないか
    // 🔹 ③ 数値・制度・法律名を創作していないか
    // → これを AI にチェックさせる
  
    const checkPrompt = `
    以下の記事について、事前に与えられた facts の範囲内で
    事実性に問題がないかをチェックしてください。
    
    【facts】
    ${facts.map(f => `- ${f.content}`).join("\n")}
    
    【article】
    タイトル：${article.title}
    本文：
    ${article.content}
    
    【出力形式（厳守）】
    以下の JSON のみを出力してください。
    
    {
      "status": "ok" | "reject",
      "reasons": ["理由1", "理由2"]
    }
    
    【判定ルール】
    ・facts に含まれない事実を断定していないか
    ・存在しない制度・法律・数値を創作していないか
    ・問題がなければ status は "ok"、reasons は空配列
    `;
  
    const aiResult = await callAI(checkPrompt);
  
    let parsed;
  
    try {
      parsed = JSON.parse(aiResult);
    } catch {
      return {
        status: "reject",
        reasons: ["ファクトチェックAIの出力が不正でした"],
      };
    }
  
    return {
      status: parsed.status === "ok" ? "ok" : "reject",
      reasons: Array.isArray(parsed.reasons) ? parsed.reasons : [],
    };
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
