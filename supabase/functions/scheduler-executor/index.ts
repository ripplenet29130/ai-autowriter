import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

interface WordPressConfig {
  id: string;
  name: string;
  url: string;
  username: string;
  password: string;
  category: string;
  is_active: boolean; // Note: Schema uses is_active for WP config, but schedule settings use status
}

interface AIConfig {
  id: string;
  provider: string;
  api_key: string;
  model: string;
  temperature: number;
  max_tokens: number;
}

interface OutlineSection {
  title: string;
  level: number;
  description: string;
  isLead: boolean;
  estimatedWordCount: number;
}

interface ArticleOutline {
  title: string;
  sections: OutlineSection[];
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.text();
    const params = body ? JSON.parse(body) : {};
    const forceExecute = params.forceExecute === true;

    console.log('Scheduler executor started at:', new Date().toISOString());
    if (forceExecute) {
      console.log('FORCE EXECUTE MODE: Ignoring time checks');
    }

    // 1. アクティブなAI設定を取得
    const { data: aiConfigs, error: aiError } = await supabase
      .from('ai_configs')
      .select('*')
      .order('is_active', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1);

    if (aiError || !aiConfigs || aiConfigs.length === 0) {
      console.error('No AI config found:', aiError);
      return new Response(
        JSON.stringify({ success: false, error: 'AI設定が見つかりません' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const aiConfig: AIConfig = aiConfigs[0];
    console.log('Using AI config:', aiConfig.provider, aiConfig.model);

    // 2. アクティブなスケジュール設定を取得
    const { data: schedules, error: schedError } = await supabase
      .from('schedule_settings')
      .select(`
        *,
        wordpress_configs!inner(*)
      `)
      .eq('status', true); // Using 'status' based on previous fix

    if (schedError || !schedules || schedules.length === 0) {
      console.log('No active schedules found');
      return new Response(
        JSON.stringify({ success: true, message: 'アクティブなスケジュールがありません', executed: 0 }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Found ${schedules.length} active schedules`);

    const results = [];
    const now = new Date();
    const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

    // 3. 各スケジュールを処理
    for (const schedule of schedules) {
      const scheduleSetting = schedule as any;
      const wpConfig: WordPressConfig = scheduleSetting.wordpress_configs;

      // Map older code property 'time' to 'post_time' if needed
      const timeToUse = scheduleSetting.post_time || scheduleSetting.time;

      console.log(`Processing schedule for ${wpConfig.name} (${timeToUse})`);

      // 時刻チェック（±5分の範囲で実行）- forceExecuteモードでは無視
      const shouldExecute = forceExecute || await shouldExecuteNow(timeToUse, currentTime, scheduleSetting.frequency, scheduleSetting.id, supabase);

      if (shouldExecute) {
        console.log(`Executing schedule for ${wpConfig.name}`);


        try {
          const result = await executeSchedule(scheduleSetting, wpConfig, aiConfig, supabase);
          results.push(result);
        } catch (error: any) {
          console.error(`Failed to execute schedule for ${wpConfig.name}:`, error);
          results.push({
            wordpress_config_id: wpConfig.id,
            success: false,
            error: error?.message || 'Unknown error occurred'
          });
        }
      } else {
        console.log(`Skipping schedule for ${wpConfig.name} - not time yet or already executed`);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        executed: results.length,
        results,
        timestamp: now.toISOString()
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Scheduler execution error (Full):', error);
    const errorMessage = error?.message || 'Unknown fatal error';
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// 実行すべきかチェック
async function shouldExecuteNow(
  scheduleTime: string,
  currentTime: string,
  frequency: string,
  scheduleId: string,
  supabase: any
): Promise<boolean> {
  const [scheduleHour, scheduleMinute] = scheduleTime.split(':').map(Number);
  const [currentHour, currentMinute] = currentTime.split(':').map(Number);

  const scheduleMinutes = scheduleHour * 60 + scheduleMinute;
  const currentMinutes = currentHour * 60 + currentMinute;
  const diff = Math.abs(currentMinutes - scheduleMinutes);

  if (diff > 5) {
    return false;
  }

  const { data: lastExecution } = await supabase
    .from('execution_history')
    .select('executed_at')
    .eq('schedule_id', scheduleId)
    .order('executed_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!lastExecution) {
    return true;
  }

  const lastExecutedAt = new Date(lastExecution.executed_at);
  const now = new Date();
  const hoursSinceLastExecution = (now.getTime() - lastExecutedAt.getTime()) / (1000 * 60 * 60);

  if (frequency === 'daily' && hoursSinceLastExecution >= 23) {
    return true;
  } else if (frequency === 'weekly' && hoursSinceLastExecution >= 24 * 6.5) {
    return true;
  } else if (frequency === 'biweekly' && hoursSinceLastExecution >= 24 * 13) {
    return true;
  } else if (frequency === 'monthly' && hoursSinceLastExecution >= 24 * 29) {
    return true;
  }

  return false;
}

// スケジュール実行（マルチステップ生成版）
async function executeSchedule(
  schedule: any,
  wpConfig: WordPressConfig,
  aiConfig: AIConfig,
  supabase: any
) {
  // 1. 使用していないキーワードを選択
  // keywordカラムはカンマ区切り文字列と想定 "A, B, C"
  const allKeywords = (schedule.keyword || '').split(',').map((k: string) => k.trim()).filter((k: string) => k);

  const keyword = await selectUnusedKeyword(schedule.id, allKeywords, supabase);

  if (!keyword) {
    throw new Error('使用可能なキーワードがありません');
  }

  console.log(`🎯 Keyword selected: ${keyword}`);

  // 2. アウトライン（構成案）の生成
  console.log(`📝 Generating outline for: ${keyword}`);
  const outline = await generateOutline(keyword, aiConfig);
  console.log(`✅ Outline generated: ${outline.title}`);

  // 3. セクションごとに記事を生成
  const sectionsWithContent = [];
  let accumulatedContent = "";

  for (let i = 0; i < outline.sections.length; i++) {
    const section = outline.sections[i];
    console.log(`生成中 (${i + 1}/${outline.sections.length}): ${section.title}`);

    const content = await generateSection(section, outline, accumulatedContent, aiConfig);
    sectionsWithContent.push({ ...section, content });

    // 文脈維持用に蓄積
    accumulatedContent += `\n\n${content}`;
  }

  // 4. 記事の組み立て
  const fullContent = assembleArticle(sectionsWithContent);
  const articleTitle = outline.title;

  // 5. WordPressに投稿
  console.log(`🌐 Publishing to WordPress: ${articleTitle}`);
  const postId = await publishToWordPress(
    wpConfig,
    articleTitle,
    fullContent,
    schedule.publish_status
  );
  console.log(`✅ Published: Post ID ${postId}`);

  // 6. 実行履歴を保存
  await supabase.from('execution_history').insert({
    schedule_id: schedule.id,
    wordpress_config_id: wpConfig.id,
    executed_at: new Date().toISOString(),
    keyword_used: keyword,
    article_title: articleTitle,
    wordpress_post_id: postId,
    status: 'success'
  });

  // 予約投稿の生成物をレビュー対象として保存し、設定済みの担当者へ共有する。
  // 通知失敗で投稿自体を失敗扱いにしないため、通知処理は内部でエラーを吸収する。
  await createAndSendReviewNotification(schedule, wpConfig, supabase, {
    title: articleTitle,
    content: fullContent,
    keyword,
    postId: String(postId),
  });

  return {
    wordpress_config_id: wpConfig.id,
    wordpress_config_name: wpConfig.name,
    success: true,
    keyword,
    title: articleTitle,
    post_id: postId
  };
}

// 未使用キーワードを選択
async function selectUnusedKeyword(
  scheduleId: string,
  allKeywords: string[],
  supabase: any
): Promise<string | null> {
  const { data: history } = await supabase
    .from('execution_history')
    .select('keyword_used')
    .eq('schedule_id', scheduleId);

  const usedKeywords = new Set((history || []).map((h: any) => h.keyword_used));
  const availableKeywords = allKeywords.filter(k => !usedKeywords.has(k));

  if (availableKeywords.length === 0) {
    console.log('All keywords used, resetting list');
    // ランダムに選択
    if (allKeywords.length === 0) return null;
    return allKeywords[Math.floor(Math.random() * allKeywords.length)];
  }

  return availableKeywords[Math.floor(Math.random() * availableKeywords.length)];
}

// --- AI生成のコアロジック ---

async function callAI(prompt: string, aiConfig: AIConfig, maxTokens = 2000): Promise<string> {
  if (aiConfig.provider === 'gemini') {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${aiConfig.model}:generateContent?key=${aiConfig.api_key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: aiConfig.temperature || 0.7,
            maxOutputTokens: maxTokens
          }
        })
      }
    );
    const data = await response.json();
    if (!response.ok) throw new Error(`Gemini API Error: ${JSON.stringify(data)}`);
    // Gemini may return empty content if blocked or error
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';

  } else if (aiConfig.provider === 'openai') {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${aiConfig.api_key}`
      },
      body: JSON.stringify({
        model: aiConfig.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: aiConfig.temperature || 0.7,
        max_tokens: maxTokens
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(`OpenAI API Error: ${JSON.stringify(data)}`);
    return data.choices?.[0]?.message?.content || "";

  } else if (aiConfig.provider === 'claude') {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': aiConfig.api_key,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: aiConfig.model,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(`Claude API Error: ${JSON.stringify(data)}`);
    return data.content?.[0]?.text || "";
  }

  throw new Error(`Unsupported provider: ${aiConfig.provider}`);
}

async function generateOutline(keyword: string, aiConfig: AIConfig): Promise<ArticleOutline> {
  const prompt = `
# 記事アウトライン生成タスク

以下のキーワードを基に、SEO最適化された日本語ブログ記事のアウトライン（見出し構成）を作成してください。

メインキーワード: ${keyword}

## 指示
1. 読者の検索意図に応える論理的な構成にすること。
2. H2およびH3の見出しを適切に配置すること。
3. リード文（導入部分）を必ず含めること。

## 出力フォーマット
以下の形式で必ず出力してください：

タイトル: [記事全体のタイトル]

見出し0 (Lead): リード文
説明: 読者の興味を惹きつける導入部分。
推定文字数: 300

見出し1 (H2): [見出しテキスト]
説明: [セクション内容の簡潔な説明]
推定文字数: 500

見出し2 (H2): [見出しテキスト]
説明: [セクション内容の簡潔な説明]
推定文字数: 500

  見出し2-1 (H3): [サブ見出しテキスト]
  説明: [サブセクション内容の説明]
  推定文字数: 300

...（続く）
`;

  const text = await callAI(prompt, aiConfig, 1500);
  return parseOutline(text, keyword);
}

function parseOutline(text: string, keyword: string): ArticleOutline {
  const sections: OutlineSection[] = [];
  const lines = text.split('\n');
  let title = `${keyword}について`;

  const titleMatch = text.match(/タイトル:\s*(.+)/);
  if (titleMatch) title = titleMatch[1].trim();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const leadMatch = line.match(/^見出し0\s*\(Lead\):\s*(.+)$/);
    const h2Match = line.match(/^見出し\d+\s*\(H2\):\s*(.+)$/);
    const h3Match = line.match(/^\s*見出し[\d-]+\s*\(H3\):\s*(.+)$/);

    if (leadMatch || h2Match || h3Match) {
      const sTitle = leadMatch ? leadMatch[1] : (h2Match ? h2Match[1] : h3Match![1]);
      const level = leadMatch ? 2 : (h2Match ? 2 : 3);
      const isLead = !!leadMatch;

      let description = '';
      let estimatedWordCount = 400;

      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        const nextLine = lines[j].trim();
        if (nextLine.startsWith('説明:')) {
          description = nextLine.replace('説明:', '').trim();
        } else if (nextLine.startsWith('推定文字数:')) {
          const match = nextLine.match(/\d+/);
          if (match) estimatedWordCount = parseInt(match[0], 10);
        } else if (nextLine.startsWith('見出し')) {
          break;
        }
      }

      sections.push({ title: sTitle, level, description, isLead, estimatedWordCount });
    }
  }

  if (sections.length === 0) {
    // フォールバック
    return {
      title,
      sections: [
        { title: 'はじめに', level: 2, description: '導入', isLead: true, estimatedWordCount: 300 },
        { title: `${keyword}の基本`, level: 2, description: '概要', isLead: false, estimatedWordCount: 500 },
        { title: 'まとめ', level: 2, description: '結論', isLead: false, estimatedWordCount: 300 }
      ]
    };
  }

  return { title, sections };
}

async function generateSection(
  section: OutlineSection,
  outline: ArticleOutline,
  previousContent: string,
  aiConfig: AIConfig
): Promise<string> {
  const prompt = `
あなたはSEOに精通したプロのWebライターです。
ブログ記事の以下のセクションのみを執筆してください。

【記事タイトル】
${outline.title}

【今回執筆するセクション】
${section.title} (${section.level === 2 ? 'H2見出し' : 'H3見出し'})
内容説明: ${section.description}

【文脈（直前の内容）】
${previousContent.slice(-1000)}

【指示】
- **重要: 指定された見出しの本文テキストのみを出力してください。**
- 見出し自体（## や ###）は含めないでください。
- 目標文字数: ${section.estimatedWordCount}文字程度
- ${section.isLead ? 'これはリード文です。読者の興味を惹きつける書き出しにしてください。' : '前の章からの流れを意識して、自然な日本語で書いてください。'}
- 箇条書きや改行を適宜使い、読みやすくしてください。
- 結論だけを簡潔に書くのではなく、情報を充実させてください。
`;

  const content = await callAI(prompt, aiConfig, aiConfig.max_tokens || 2000);
  return content.trim();
}

function assembleArticle(sections: (OutlineSection & { content: string })[]): string {
  return sections.map(s => {
    if (s.isLead) return s.content;
    const tag = s.level === 2 ? 'h2' : 'h3';
    return `<${tag}>${s.title}</${tag}>\n\n${s.content}`;
  }).join('\n\n');
}

// WordPress投稿
async function publishToWordPress(
  config: WordPressConfig,
  title: string,
  content: string,
  status: string
): Promise<string> {
  const auth = btoa(`${config.username}:${config.password}`);
  const wpApiUrl = `${config.url}/wp-json/wp/v2/posts`;


  // カテゴリIDのパース（安全策）
  let categoryIds: number[] = [];
  if (config.category) {
    const parsed = parseInt(config.category, 10);
    if (!isNaN(parsed)) {
      categoryIds = [parsed];
    }
  }

  const response = await fetch(wpApiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${auth}`
    },
    body: JSON.stringify({
      title,
      content,
      status,
      categories: categoryIds
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`WordPress API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return data.id.toString();
}

async function createAndSendReviewNotification(
  schedule: any,
  wpConfig: WordPressConfig,
  supabase: any,
  article: { title: string; content: string; keyword: string; postId: string }
) {
  if (!schedule.chatwork_notify_on_review || !String(schedule.chatwork_room_id || '').trim()) return;

  try {
    const { data: savedArticle, error: articleError } = await supabase.from('articles').insert({
      title: article.title,
      content: article.content,
      excerpt: article.content.slice(0, 200),
      keywords: [article.keyword],
      status: schedule.publish_status === 'publish' ? 'published' : 'draft',
      wordpress_post_id: article.postId,
      wordpress_config_id: wpConfig.id,
      published_at: schedule.publish_status === 'publish' ? new Date().toISOString() : null,
    }).select('id').single();
    if (articleError || !savedArticle) throw articleError || new Error('レビュー対象の記事を保存できませんでした');

    const rawToken = Array.from(crypto.getRandomValues(new Uint8Array(32))).map(byte => byte.toString(16).padStart(2, '0')).join('');
    const tokenHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawToken)))).map(byte => byte.toString(16).padStart(2, '0')).join('');
    const expiryDays = Math.min(365, Math.max(1, Number(schedule.chatwork_review_expires_days || 30)));
    const { error: linkError } = await supabase.from('article_review_links').insert({
      article_id: savedArticle.id,
      token_hash: tokenHash,
      permission: ['view', 'comment', 'edit'].includes(schedule.chatwork_review_permission) ? schedule.chatwork_review_permission : 'comment',
      expires_at: new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000).toISOString(),
    });
    if (linkError) throw linkError;

    const { data: settings, error: settingsError } = await supabase.from('chatwork_settings').select('api_token').eq('id', true).maybeSingle();
    if (settingsError || !settings?.api_token) {
      console.warn('ChatWork API token is not configured; review link was created but not notified.');
      return;
    }

    const appUrl = Deno.env.get('APP_URL') || Deno.env.get('PUBLIC_APP_URL');
    if (!appUrl) {
      console.warn('APP_URL is not configured; review link was created but not notified.');
      return;
    }
    const recipients = Array.isArray(schedule.chatwork_recipients) ? schedule.chatwork_recipients : [];
    const toLines = recipients
      .filter((recipient: any) => String(recipient?.accountId || '').trim())
      .map((recipient: any) => `[To:${String(recipient.accountId).trim()}]${String(recipient.name || '担当者').trim()}`)
      .join('\n');
    const reviewUrl = `${appUrl.replace(/\/$/, '')}/review/${rawToken}`;
    const message = `[info][title]記事レビューのお願い[/title]\n${toLines ? `${toLines}\n\n` : ''}対象サイト: ${wpConfig.name}\nタイトル: ${article.title}\nキーワード: ${article.keyword}\n投稿状態: ${schedule.publish_status === 'publish' ? '公開' : '下書き'}\n\n以下のリンクから内容をご確認ください。\n${reviewUrl}\n\nリンク有効期限: ${expiryDays}日[/info]`;
    const roomIds = String(schedule.chatwork_room_id).split(',').map((id: string) => id.trim()).filter(Boolean);
    await Promise.all(roomIds.map(async (roomId: string) => {
      const response = await fetch(`https://api.chatwork.com/v2/rooms/${roomId}/messages`, {
        method: 'POST', headers: { 'X-ChatWorkToken': settings.api_token, 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' }, body: `body=${encodeURIComponent(message)}`
      });
      if (!response.ok) throw new Error(`ChatWork API error ${response.status}: ${await response.text()}`);
    }));
  } catch (error) {
    console.error('Review notification failed:', error);
  }
}
