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
  password: string; // This maps to 'applicationPassword' in the DB column 'password'
  category: string;
  post_type: string; // Custom post type slug (e.g., 'posts', 'sushirecipe', 'product')
  is_active: boolean;
}

interface Schedule {
  id: string;
  ai_config_id: string;
  wp_config_id: string;
  post_time: string;
  frequency: string;
  status: boolean;
  keyword: string;
  post_status: 'draft' | 'publish';
  start_date?: string;
  end_date?: string;
  chatwork_room_id?: string;
  chatwork_message_template?: string;
  prompt_set_id?: string;
  target_word_count?: number;
  writing_tone?: string;
  title_set_id?: string;
  generation_mode?: 'keyword' | 'title' | 'both';
  keyword_set_id?: string;
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
    console.log('Raw request body:', body);
    const params = body ? JSON.parse(body) : {};
    console.log('Parsed params:', params);
    const forceExecute = params.forceExecute === true;
    const targetScheduleId = params.scheduleId;

    // 処理ロジックを非同期関数として定義（バックグラウンド実行用）
    const processSchedules = async () => {
      console.log('Scheduler execution started (Background):', new Date().toISOString());

      if (forceExecute) {
        console.log(`FORCE EXECUTE MODE: Ignoring time checks (Target: ${targetScheduleId || 'ALL'})`);
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
        return;
      }

      const aiConfig: AIConfig = aiConfigs[0];
      console.log('Using AI config:', aiConfig.provider, aiConfig.model);

      // 1.5 各種APIトークン・キーの取得
      let chatworkApiToken: string | null = null;
      let serpApiKey: string | null = null;
      let googleApiKey: string | null = null;
      let searchEngineId: string | null = null;

      const { data: appSettings, error: appSettingsError } = await supabase
        .from('app_settings')
        .select('key, value')
        .in('key', ['chatwork_api_token', 'serpapi_key', 'google_custom_search_api_key', 'google_custom_search_engine_id']);

      if (appSettingsError) {
        console.error('Error fetching app_settings:', appSettingsError);
      }

      console.log('App settings fetched:', JSON.stringify(appSettings));

      if (appSettings) {
        appSettings.forEach((setting: any) => {
          if (setting.key === 'chatwork_api_token') chatworkApiToken = setting.value;
          if (setting.key === 'serpapi_key') serpApiKey = setting.value;
          if (setting.key === 'google_custom_search_api_key') googleApiKey = setting.value;
          if (setting.key === 'google_custom_search_engine_id') searchEngineId = setting.value;
        });
      }

      console.log('Key values - SerpAPI:', serpApiKey ? 'Found(hidden)' : 'Not Found', 'Google:', googleApiKey ? 'Found(hidden)' : 'Not Found');

      // 2. スケジュール取得
      let { data: schedules, error: schedError } = await supabase
        .from('schedule_settings')
        .select(`*, wordpress_configs!inner(*)`);

      if (schedError) {
        console.error('Database query failed:', schedError);
        return;
      }

      schedules = (schedules || []).filter((s: any) => {
        if (forceExecute && targetScheduleId && s.id === targetScheduleId) return true;
        return s.status === true || s.is_active === true;
      });

      if (forceExecute && targetScheduleId) {
        schedules = schedules.filter((s: any) => s.id === targetScheduleId);
      }

      if (!schedules || schedules.length === 0) {
        console.log('No active schedules found');
        return;
      }

      console.log(`Found ${schedules.length} active schedules`);

      const now = new Date();
      const jstFormatter = new Intl.DateTimeFormat('ja-JP', {
        timeZone: 'Asia/Tokyo',
        hour: '2-digit', minute: '2-digit', hour12: false
      });
      const currentTimeJST = jstFormatter.format(now);

      // 3. 各スケジュール処理
      for (const schedule of schedules) {
        const scheduleSetting: Schedule = schedule as any;
        const wpConfig: WordPressConfig = (schedule as any).wordpress_configs;
        const timeToUse = scheduleSetting.post_time;

        const shouldExecute = forceExecute || await shouldExecuteNow(timeToUse, currentTimeJST, scheduleSetting.frequency, scheduleSetting.id, supabase);

        if (shouldExecute) {
          console.log(`Executing schedule for ${wpConfig.name}`);

          let effectiveAiConfig = aiConfig;
          if (scheduleSetting.ai_config_id) {
            const { data: specificAiConfig } = await supabase
              .from('ai_configs')
              .select('*')
              .eq('id', scheduleSetting.ai_config_id)
              .single();

            if (specificAiConfig) {
              effectiveAiConfig = specificAiConfig as AIConfig;
              console.log(`Using schedule-specific AI config: ${effectiveAiConfig.provider} (${effectiveAiConfig.model})`);
            } else {
              console.error(`Defined AI Config ID ${scheduleSetting.ai_config_id} not found.`);
              continue;
            }
          }

          try {
            await executeSchedule(scheduleSetting, wpConfig, effectiveAiConfig, supabase, chatworkApiToken, serpApiKey, googleApiKey, searchEngineId);
          } catch (error: any) {
            console.error(`Failed to execute schedule for ${wpConfig.name}:`, error);
          }
        }
      }
    };

    // EdgeRuntime.waitUntil でバックグラウンド実行を試みる
    // @ts-ignore
    const waitUntil = (globalThis as any).EdgeRuntime?.waitUntil;
    if (waitUntil) {
      waitUntil(processSchedules());
    } else {
      console.warn('EdgeRuntime.waitUntil unavailable, running unawaited promise.');
      processSchedules();
    }

    // 即座に成功レスポンスを返す
    return new Response(
      JSON.stringify({
        success: true,
        message: 'Request accepted. Processing in background.',
        timestamp: new Date().toISOString()
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Scheduler handler error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
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

  // 実行直前（早すぎる実行）を防止し、かつ設定時刻から5分以内の範囲で実行を許可する
  const diff = currentMinutes - scheduleMinutes;

  if (diff < 0 || diff > 5) {
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

  // 日本語の頻度を英語に変換
  const freqMap: Record<string, string> = {
    '毎日': 'daily',
    '毎週': 'weekly',
    '隔週': 'biweekly',
    '毎月': 'monthly'
  };
  const normalizedFreq = freqMap[frequency] || frequency;

  // JSTでの日付比較用
  const jstDateFormatter = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' });
  const lastExecutedDate = jstDateFormatter.format(lastExecutedAt);
  const currentDate = jstDateFormatter.format(now);

  console.log(`[Freq Check] ${normalizedFreq}, Hours since: ${hoursSinceLastExecution.toFixed(1)}, Last day: ${lastExecutedDate}, Today: ${currentDate}`);

  if (normalizedFreq === 'daily') {
    // 20時間以上経過、または12時間以上経過して日付が変わっていれば許可
    if (hoursSinceLastExecution >= 20 || (hoursSinceLastExecution >= 12 && lastExecutedDate !== currentDate)) {
      return true;
    }
  } else if (normalizedFreq === 'weekly' && hoursSinceLastExecution >= 24 * 6) {
    return true;
  } else if (normalizedFreq === 'biweekly' && hoursSinceLastExecution >= 24 * 12) {
    return true;
  } else if (normalizedFreq === 'monthly' && hoursSinceLastExecution >= 24 * 27) {
    return true;
  }

  return false;
}

// スケジュール実行（マルチステップ生成版）
async function executeSchedule(
  schedule: Schedule,
  wpConfig: WordPressConfig,
  aiConfig: AIConfig,
  supabase: any,
  chatworkApiToken: string | null,
  serpApiKey: string | null,
  googleApiKey: string | null,
  searchEngineId: string | null
) {
  // 1. 生成モードに基づいてターゲット（キーワードまたはタイトル）を決定
  let keyword = '';
  let fixedTitle: string | null = null;
  const mode = schedule.generation_mode || 'keyword';
  console.log(`Generation Mode: ${mode}`);

  if (mode === 'title' && schedule.title_set_id) {
    // タイトルセットからタイトルを取得
    const { data: titleSet } = await supabase
      .from('title_sets')
      .select('titles')
      .eq('id', schedule.title_set_id)
      .maybeSingle();

    if (titleSet && titleSet.titles && titleSet.titles.length > 0) {
      const selectedTitle = await selectUnusedTitle(schedule.id, titleSet.titles, supabase);
      if (selectedTitle) {
        fixedTitle = selectedTitle;
        keyword = selectedTitle; // タイトルをメインキーワードとして扱う
        console.log(`🎯 Title selected: ${fixedTitle}`);
      } else {
        throw new Error('使用可能なタイトルがありません（全て使用済み）');
      }
    } else {
      throw new Error('有効なタイトルセットが見つかりません');
    }
  } else if (mode === 'both') {
    // 両方使用の場合：今回は簡易的に50%の確率でタイトル、50%でキーワードとする
    const useTitle = Math.random() < 0.5;

    if (useTitle && schedule.title_set_id) {
      const { data: titleSet } = await supabase
        .from('title_sets')
        .select('titles')
        .eq('id', schedule.title_set_id)
        .maybeSingle();

      if (titleSet && titleSet.titles && titleSet.titles.length > 0) {
        const selectedTitle = await selectUnusedTitle(schedule.id, titleSet.titles, supabase);
        if (selectedTitle) {
          fixedTitle = selectedTitle;
          keyword = selectedTitle;
          console.log(`🎯 Mode "Both" -> Title selected: ${fixedTitle}`);
        }
      }
    }
  }

  // キーワードモード、またはタイトル選択に失敗/スキップした場合のフォールバック
  if (!keyword) {
    const allKeywords = (schedule.keyword || '').split(',').map((k: string) => k.trim()).filter((k: string) => k);
    const selectedKeyword = await selectUnusedKeyword(schedule.id, allKeywords, supabase);

    if (!selectedKeyword) {
      throw new Error('使用可能なキーワードがありません');
    }
    keyword = selectedKeyword;
    console.log(`🎯 Keyword selected: ${keyword}`);
  }

  // 1.5 プロンプトセットの取得（あれば）
  let customInstructions = '';
  if (schedule.prompt_set_id) {
    const { data: promptSet } = await supabase
      .from('prompt_sets')
      .select('custom_instructions')
      .eq('id', schedule.prompt_set_id)
      .maybeSingle();

    if (promptSet) {
      customInstructions = promptSet.custom_instructions;
      console.log('Using custom instructions from prompt set');
    }
  }

  // 2. 競合調査の実行（Auto Modeと同じロジック）
  console.log(`🔍 Conducting competitor research for: ${keyword}`);
  let competitorData: any = null;
  if (serpApiKey) {
    try {
      competitorData = await conductCompetitorResearch(keyword, serpApiKey, 5);
      console.log(`✅ Competitor research completed. Found ${competitorData.articles.length} articles`);
    } catch (researchError) {
      console.warn('Competitor research failed, proceeding without it:', researchError);
    }
  } else {
    console.log('⚠️ SerpAPI key not found. Skipping competitor research.');
  }

  // 3. アウトライン（構成案）の生成
  console.log(`📝 Generating outline for: ${keyword}`);
  const targetWordCount = schedule.target_word_count || 3000;
  const writingTone = schedule.writing_tone || 'desu_masu';

  const outline = await generateOutline(keyword, aiConfig, targetWordCount, customInstructions, competitorData, fixedTitle);
  console.log(`✅ Outline generated: ${outline.title}`);

  // 4. セクションごとに記事を生成
  const sectionsWithContent = [];
  let accumulatedContent = "";

  for (let i = 0; i < outline.sections.length; i++) {
    const section = outline.sections[i];
    console.log(`生成中 (${i + 1}/${outline.sections.length}): ${section.title}`);

    const content = await generateSection(section, outline, accumulatedContent, aiConfig, writingTone, customInstructions);
    sectionsWithContent.push({ ...section, content });

    // 文脈維持用に蓄積
    accumulatedContent += `\n\n${content}`;
  }

  // 4. 記事の組み立て
  let fullContent = assembleArticle(sectionsWithContent);
  const articleTitle = outline.title;

  // 4.5 文字数チェックと要約
  const actualWordCount = countWords(fullContent);
  const tolerance = 0.3; // 30%の許容範囲
  const maxAllowed = targetWordCount * (1 + tolerance);

  console.log(`📊 文字数チェック: 目標=${targetWordCount}, 実際=${actualWordCount}, 上限=${Math.floor(maxAllowed)}`);

  if (actualWordCount > maxAllowed) {
    console.log(`✂️ 文字数超過（${actualWordCount}文字）のため要約を実行します...`);
    const keywordArray = (schedule.keyword || '').split(',').map((k: string) => k.trim()).filter((k: string) => k);

    fullContent = await summarizeToWordCount(
      fullContent,
      articleTitle,
      targetWordCount,
      aiConfig,
      keywordArray
    );

    const newWordCount = countWords(fullContent);
    console.log(`✅ 要約完了: ${actualWordCount}文字 → ${newWordCount}文字`);
  }

  // 4.6 ファクトチェック実行と条件分岐
  let finalPostStatus = schedule.post_status || 'draft';
  let factCheckReport = null;

  if ((schedule as any).enable_fact_check) {
    console.log(`🔍 Starting fact-check for article: ${articleTitle}`);

    try {
      // ファクトチェック設定を取得
      const { data: factCheckSettings } = await supabase
        .from('fact_check_settings')
        .select('*')
        .limit(1)
        .maybeSingle();

      if (factCheckSettings?.enabled && factCheckSettings?.perplexity_api_key) {
        // 記事からファクト情報を抽出
        const factsToCheck = await extractFactsFromContent(fullContent, (schedule as any).fact_check_note);
        const maxItems = factCheckSettings.max_items_to_check || 10;
        const itemsToCheck = factsToCheck.slice(0, maxItems);

        console.log(`📋 Found ${factsToCheck.length} facts, checking top ${itemsToCheck.length} in batches`);

        // バッチ検証実行（5件ずつ）
        const factCheckResults = await verifyFactsBatch(
          itemsToCheck,
          factCheckSettings.perplexity_api_key,
          keyword,
          factCheckSettings.model_name || 'sonar',
          5
        );

        // 重大な誤りをカウント
        const criticalIssues = factCheckResults.filter(r =>
          r.verdict === 'incorrect' && r.confidence >= 70
        ).length;
        const minorIssues = factCheckResults.filter(r =>
          r.verdict === 'partially_correct' ||
          (r.verdict === 'incorrect' && r.confidence < 70)
        ).length;

        console.log(`✅ Fact-check completed: ${criticalIssues} critical, ${minorIssues} minor issues`);

        // 条件分岐: 重大な誤りがあれば強制的に下書き
        if (criticalIssues > 0) {
          console.log(`⚠️ Critical errors found (${criticalIssues}). Forcing draft status.`);
          finalPostStatus = 'draft';
        }

        // 結果を保存
        const { data: savedReport } = await supabase.from('fact_check_results').insert({
          schedule_id: schedule.id,
          checked_items: factCheckResults,
          total_checked: itemsToCheck.length,
          issues_found: criticalIssues + minorIssues,
          critical_issues: criticalIssues
        }).select().single();

        factCheckReport = savedReport;
      } else {
        console.log('⚠️ Fact-check settings not configured or API key missing');
      }
    } catch (factCheckError) {
      console.error('Fact-check failed:', factCheckError);
      // ファクトチェックエラーは全体の処理を止めない
    }
  }

  // 4.7 [[]]記法のクリーンアップ
  fullContent = fullContent.replace(/\[\[(.+?)\]\]/g, '$1');

  // 5. WordPressに投稿（条件分岐後のステータスを使用）
  console.log(`🌐 Publishing to WordPress: ${articleTitle} (Status: ${finalPostStatus})`);
  const postId = await publishToWordPress(
    wpConfig,
    articleTitle,
    fullContent,
    finalPostStatus
  );
  console.log(`✅ Published: Post ID ${postId}`);

  // 5.5 Chatwork通知 (非同期で実行し、エラーでもメイン処理は止めない)
  if (schedule.chatwork_room_id && chatworkApiToken) {
    console.log(`📢 Sending Chatwork notification to rooms: ${schedule.chatwork_room_id}`);
    try {
      const postUrl = `${wpConfig.url}/?p=${postId}`; // 簡易的なURL生成
      await sendChatworkNotifications(
        chatworkApiToken,
        schedule.chatwork_room_id,
        schedule.chatwork_message_template || '',
        articleTitle,
        postUrl,
        keyword,
        schedule.post_status === 'publish' ? '公開' : '下書き'
      );
    } catch (cwError) {
      console.error('Chatwork notification failed:', cwError);
      // 通知失敗は全体のエラーにはしない
    }
  }

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

// 未使用タイトルを選択
async function selectUnusedTitle(
  scheduleId: string,
  allTitles: string[],
  supabase: any
): Promise<string | null> {
  const { data: history } = await supabase
    .from('execution_history')
    .select('article_title')
    .eq('schedule_id', scheduleId);

  // 完全に一致するタイトルを除外
  const usedTitles = new Set((history || []).map((h: any) => h.article_title));
  const availableTitles = allTitles.filter(t => !usedTitles.has(t));

  if (availableTitles.length === 0) {
    console.log('All titles used, resetting list');
    if (allTitles.length === 0) return null;
    return allTitles[Math.floor(Math.random() * allTitles.length)];
  }

  return availableTitles[Math.floor(Math.random() * availableTitles.length)];
}

// 文字数カウント（Markdown記号を除外）
function countWords(content: string): number {
  const cleaned = content
    .replace(/^#+\s+/gm, '')     // 見出し記号
    .replace(/\*\*/g, '')        // 太字
    .replace(/\*/g, '')          // イタリック
    .replace(/^[-*]\s+/gm, '')   // リスト記号
    .replace(/\n+/g, '\n')       // 連続改行を1つに
    .trim();
  return cleaned.length;
}

// 要約機能（目標文字数に調整）
async function summarizeToWordCount(
  originalContent: string,
  title: string,
  targetWordCount: number,
  aiConfig: AIConfig,
  keywords: string[]
): Promise<string> {
  const summaryPrompt = `
以下の記事を、正確に${targetWordCount}文字にまとめ直してください。

【元の記事タイトル】
${title}

【元の記事内容】
${originalContent}

【要約の条件】
1. **文字数**: 正確に${targetWordCount}文字（±10%以内厳守）
2. **キーワード維持**: 以下のキーワードを必ず自然な形で含める
   ${keywords.length > 0 ? keywords.join('、') : '（指定なし）'}
3. **構成維持**: 元の見出し構造（##）を可能な限り保持
4. **情報密度**: 冗長な表現を削り、重要な情報のみを残す
5. **自然な文章**: 途中で切れることなく、完結した文章にする

【出力形式】
- Markdown形式で出力
- 見出しには ## を使用
- タイトル行は出力しない（本文のみ）
- 「本文:」などの接頭辞は禁止
`;

  try {
    const summarizedText = await callAI(summaryPrompt, aiConfig, aiConfig.max_tokens || 3000);
    return summarizedText.trim();
  } catch (error) {
    console.error('要約エラー:', error);
    // 要約に失敗した場合は、段落単位で切り詰める
    return truncateByParagraph(originalContent, targetWordCount);
  }
}

// 段落単位での切り詰め（フォールバック）
function truncateByParagraph(content: string, targetWordCount: number): string {
  const paragraphs = content.split('\n\n');
  let result = '';
  let currentCount = 0;

  for (const paragraph of paragraphs) {
    const paragraphLength = countWords(paragraph);
    if (currentCount + paragraphLength <= targetWordCount * 1.05) {
      result += paragraph + '\n\n';
      currentCount += paragraphLength;
    } else {
      break;
    }
  }

  return result.trim();
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

async function generateOutline(keyword: string, aiConfig: AIConfig, targetWordCount: number, customInstructions = '', competitorData: any = null, fixedTitle: string | null = null): Promise<ArticleOutline> {
  // 競合データから共通トピックを抽出
  let competitorInsights = '';
  if (competitorData && competitorData.articles && competitorData.articles.length > 0) {
    const allHeadings = competitorData.articles.flatMap((a: any) => a.headings || []);
    const topHeadings = allHeadings.slice(0, 15).join('\n- ');
    competitorInsights = `
## 競合記事の分析結果
競合サイトで頻繁に取り上げられている見出し・トピック:
- ${topHeadings}

※ これらのトピックを参考に、読者のニーズに応える構成を作成してください。
`;
  }

  let structureRules = "";
  // 1000文字程度（800〜1200字）
  if (targetWordCount <= 1200) {
    structureRules = `
1. **構成ルール（合計4セクション、目標: ${targetWordCount}文字）**
   - リード文（Lead）: 1つ
   - H2見出し: 3つ（導入→本論→まとめの流れ）
   - H3見出しは使用しない（シンプルな構成）

2. **各セクションの推定文字数**
   - リード文: 150文字
   - H2見出し1: 250文字（メインポイント1）
   - H2見出し2: 250文字（メインポイント2）
   - H2見出し3（まとめ）: 200文字
   合計: 約850文字

3. **指示**
   - 短文でも読み応えのある構成を心がけてください
   - 各H2見出しは独立したトピックとして明確に
`;
  }
  // 2000文字程度（1500〜2500字）
  else if (targetWordCount <= 2500) {
    structureRules = `
1. **構成ルール（合計7セクション、目標: ${targetWordCount}文字）**
   - リード文（Lead）: 1つ
   - H2見出し: 4つ（うち最後の1つはまとめ）
   - H3見出し: 2〜3つ（主要なH2の下に配置）

2. **各セクションの推定文字数**
   - リード文: 250文字
   - H2見出し1: 400文字
     └ H3見出し1-1: 200文字
   - H2見出し2: 400文字
     └ H3見出し2-1: 200文字
   - H2見出し3: 350文字
   - まとめ（H2）: 200文字
   合計: 約2000文字

3. **指示**
   - H2とH3を組み合わせて情報に深みを持たせる
   - 主要トピックは2〜3個に絞り、それぞれを掘り下げる
`;
  }
  // 3000文字程度（2500〜3500字）
  else {
    structureRules = `
1. **構成ルール（合計10セクション、目標: ${targetWordCount}文字）**
   - リード文（Lead）: 1つ
   - H2見出し: 4〜5つ（うち最後の1つはまとめ）
   - H3見出し: 5〜7つ（各H2の下に複数配置）

2. **各セクションの推定文字数**
   - リード文: 300文字
   - H2見出し1: 450文字
     └ H3見出し1-1: 250文字
     └ H3見出し1-2: 250文字
   - H2見出し2: 450文字
     └ H3見出し2-1: 250文字
     └ H3見出し2-2: 250文字
   - H2見出し3: 400文字
     └ H3見出し3-1: 200文字
   - まとめ（H2）: 200文字
   合計: 約3000文字

3. **指示**
   - 各主要トピックに複数のH3見出しで詳細に解説
   - 網羅的でSEOに強い長文記事を目指す
   - ユーザーのあらゆる疑問に答える構成
`;
  }

  const prompt = `
# 記事アウトライン生成タスク

以下のキーワードを基に、SEO最適化された日本語ブログ記事のアウトライン（見出し構成）を作成してください。

メインキーワード: ${keyword}
${fixedTitle ? `記事タイトル（必須・変更不可）: ${fixedTitle}` : ''}
記事全体の目標文字数: ${targetWordCount}文字
${competitorInsights}
${customInstructions ? `## カスタム指示\n${customInstructions}\n` : ''}

【構成ルール - ターゲット文字数 ${targetWordCount}文字 に合わせてください】
${structureRules}
3. 各セクションの「推定文字数」の合計が、目標文字数（${targetWordCount}）とほぼ一致するように調整してください。

## 出力フォーマット
以下の形式で必ず出力してください：

タイトル: [記事全体のタイトル]

見出し0 (Lead): リード文
説明: 読者の興味を惹きつける導入部分。
推定文字数: 200

見出し1 (H2): [見出しテキスト]
説明: [セクション内容の簡潔な説明]
推定文字数: 400

...（ターゲット文字数に応じて、適宜セクションを追加してください）
`;

  const text = await callAI(prompt, aiConfig, 1500);
  return parseOutline(text, keyword, fixedTitle);
}

function parseOutline(text: string, keyword: string, fixedTitle: string | null = null): ArticleOutline {
  const sections: OutlineSection[] = [];
  const lines = text.split('\n');
  let title = `${keyword} について`;

  const titleMatch = text.match(/タイトル:\s*(.+)/);
  if (fixedTitle) {
    title = fixedTitle;
  } else if (titleMatch) {
    title = titleMatch[1].trim();
  }

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
        { title: `${keyword} の基本`, level: 2, description: '概要', isLead: false, estimatedWordCount: 500 },
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
  aiConfig: AIConfig,
  writingTone: string,
  customInstructions = ''
): Promise<string> {
  let toneInstruction = "専門性が高く、信頼感のある硬めの文体で書いてください。論理的かつ客観的な表現を用いてください。"; // Default to professional

  if (writingTone === 'casual') {
    toneInstruction = "カジュアルで親しみやすい「です・ます」調で書いてください。固苦しい表現を避け、ブログ読者に語りかけるようなトーンにしてください。";
  } else if (writingTone === 'technical') {
    toneInstruction = "技術的な内容を正確に伝えるための専門的な文体で書いてください。用語の正確さを重視し、論理的な構成を保ってください。";
  } else if (writingTone === 'friendly') {
    toneInstruction = "親しみやすい、読者に語りかけるような「です・ます」調で書いてください。共感を誘う表現を多用してください。";
  } else if (writingTone === 'professional') {
    toneInstruction = "専門性が高く、信頼感のある硬めの文体で書いてください。論理的かつ客観的な表現を用いてください。";
  }

  const isConcise = (outline.sections.reduce((acc, s) => acc + s.estimatedWordCount, 0) < 1500);
  const styleInstruction = isConcise
    ? "**スタイル: 冗長な表現を一切省き、結論から簡潔に述べる「要約・まとめ」のようなスタイルで書いてください。** 余計な肉付けは避けてください。"
    : "**スタイル: プロのWebライターとして、読者の疑問を解決する丁寧で詳細な解説を心がけてください。** 論理的な展開と、具体例を交えた充実した内容にしてください。";

  const prompt = `
  あなたはSEOに精通したプロのWebライターです。
  ブログ記事の以下のセクションのみを執筆してください。

【記事タイトル】
${outline.title}

【今回執筆するセクション】
${section.title} (${section.level === 2 ? 'H2見出し' : 'H3見出し'})
  内容説明: ${section.description}

【文体指示】
${toneInstruction}
${styleInstruction}

${customInstructions ? `【カスタム指示】\n${customInstructions}\n` : ''}

【文脈（直前の内容）】
${previousContent.slice(-1000)}

【指示】
- ** 重要: 指定された見出しの本文テキストのみを出力してください。**
    - 見出し自体（## や ###）は含めないでください。
  - 目標文字数: ${section.estimatedWordCount} 文字程度
    - ${section.isLead ? 'これはリード文です。読者の期待を高める書き出しにしてください。' : '前の章からの流れを意識して、自然な日本語で書いてください。'}
  - 箇条書きや改行を適宜使い、読みやすくしてください。
  - 指定された文字数に見合うよう、内容の密度を調整してください。
  `;

  const content = await callAI(prompt, aiConfig, aiConfig.max_tokens || 2000);
  return content.trim();
}

function assembleArticle(sections: (OutlineSection & { content: string })[]): string {
  return sections.map(s => {
    if (s.isLead) return s.content;
    const tag = s.level === 2 ? 'h2' : 'h3';
    return `< ${tag}> ${s.title} </${tag}>\n\n${s.content}`;
  }).join('\n\n');
}

// カテゴリーIDをスラッグまたは名前から取得
async function getCategoryIdBySlugOrName(
  config: WordPressConfig,
  categoryIdentifier: string
): Promise<number | null> {
  const auth = btoa(`${config.username}:${config.password}`);

  try {
    // まずスラッグで検索
    let response = await fetch(
      `${config.url}/wp-json/wp/v2/categories?slug=${encodeURIComponent(categoryIdentifier)}`,
      { headers: { 'Authorization': `Basic ${auth}` } }
    );

    if (response.ok) {
      const data = await response.json();
      if (data.length > 0) {
        console.log(`Found category by slug "${categoryIdentifier}": ID ${data[0].id}`);
        return data[0].id;
      }
    }

    // スラッグで見つからなければ名前で検索
    response = await fetch(
      `${config.url}/wp-json/wp/v2/categories?search=${encodeURIComponent(categoryIdentifier)}`,
      { headers: { 'Authorization': `Basic ${auth}` } }
    );

    if (response.ok) {
      const data = await response.json();
      // 完全一致を探す
      const exactMatch = data.find((cat: any) =>
        cat.name.toLowerCase() === categoryIdentifier.toLowerCase()
      );
      if (exactMatch) {
        console.log(`Found category by name "${categoryIdentifier}": ID ${exactMatch.id}`);
        return exactMatch.id;
      }
      // 完全一致がなければ最初の結果を返す
      if (data.length > 0) {
        console.log(`Found category by partial match "${categoryIdentifier}": ID ${data[0].id}`);
        return data[0].id;
      }
    }

    console.warn(`Category "${categoryIdentifier}" not found`);
    return null;
  } catch (error) {
    console.error(`Error searching for category "${categoryIdentifier}":`, error);
    return null;
  }
}

// WordPress投稿
async function publishToWordPress(
  config: WordPressConfig,
  title: string,
  content: string,
  status: string
): Promise<string> {
  const auth = btoa(`${config.username}:${config.password}`);

  // カスタム投稿タイプに対応したエンドポイントを構築
  const postType = config.post_type || 'posts';
  const wpApiUrl = `${config.url}/wp-json/wp/v2/${postType}`;
  console.log(`Publishing to WordPress: ${wpApiUrl}`);

  // カテゴリIDの取得（数値ID、スラッグ、名前に対応）
  let categoryIds: number[] = [];
  if (config.category) {
    const trimmed = config.category.trim();

    // まず数値IDとしてパースを試みる
    const parsed = parseInt(trimmed, 10);
    if (!isNaN(parsed)) {
      categoryIds = [parsed];
      console.log(`Using category ID: ${parsed}`);
    } else {
      // スラッグまたは名前として検索
      console.log(`Looking up category by slug/name: ${trimmed}`);
      const categoryId = await getCategoryIdBySlugOrName(config, trimmed);
      if (categoryId) {
        categoryIds = [categoryId];
        console.log(`Found category ID: ${categoryId} for "${trimmed}"`);
      } else {
        console.warn(`Category "${trimmed}" not found. WordPress will use default category.`);
      }
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

// Chatwork通知送信
async function sendChatworkNotifications(
  apiToken: string,
  roomIdsStr: string,
  template: string,
  title: string,
  url: string,
  keyword: string,
  status: string
): Promise<void> {
  const roomIds = roomIdsStr.split(',').map(id => id.trim()).filter(id => id);

  if (roomIds.length === 0) return;

  // メッセージの構築
  let body = template;
  if (!body) {
    // デフォルトテンプレート
    body = `いつもお世話になっております。
記事の投稿が完了しましたので、ご報告いたします。

■ 記事タイトル
{title}

■ キーワード
{keyword}

■ 投稿URL
{url}

■ 投稿状態
{status}

問題などございましたら、お気軽にお知らせください。

今後ともよろしくお願いいたします。`;
  }

  // 変数置換
  body = body
    .replace(/{title}/g, title)
    .replace(/{url}/g, url)
    .replace(/{keyword}/g, keyword)
    .replace(/{status}/g, status);

  const errors = [];

  for (const roomId of roomIds) {
    try {
      const response = await fetch(`https://api.chatwork.com/v2/rooms/${roomId}/messages`, {
        method: 'POST',
        headers: {
          'X-ChatWorkToken': apiToken,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: `body=${encodeURIComponent(body)}`
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Status ${response.status}: ${text}`);
      }
      console.log(`Chatwork message sent to room ${roomId}`);
    } catch (error) {
      console.error(`Failed to send to Chatwork room ${roomId}:`, error);
      errors.push(error);
    }
  }
}

// 競合調査ヘルパー関数（SerpAPI経由）
async function conductCompetitorResearch(keyword: string, serpApiKey: string, limit: number = 5) {
  const searchUrl = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(keyword)}&api_key=${serpApiKey}&gl=jp&hl=ja&num=${limit}`;

  const searchRes = await fetch(searchUrl);
  if (!searchRes.ok) {
    throw new Error(`SerpAPI error: ${searchRes.status}`);
  }

  const searchData = await searchRes.json();
  const results = searchData.organic_results || [];

  const articles = [];

  for (const item of results.slice(0, limit)) {
    const url = item.link;
    console.log(`Scraping: ${url}`);

    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 8000);

      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        signal: controller.signal
      });
      clearTimeout(id);

      if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);

      const html = await res.text();

      // 簡易的な見出し抽出（正規表現ベース）
      const h2Matches = html.match(/<h2[^>]*>([^<]+)<\/h2>/gi) || [];
      const h3Matches = html.match(/<h3[^>]*>([^<]+)<\/h3>/gi) || [];

      const headings = [...h2Matches, ...h3Matches]
        .map(h => h.replace(/<\/?[^>]+(>|$)/g, '').trim())
        .filter(h => h.length > 2 && h.length < 100)
        .slice(0, 10);

      articles.push({
        title: item.title,
        url: url,
        domain: new URL(url).hostname,
        headings: headings.length > 0 ? headings : [item.title],
        metaDescription: item.snippet || ''
      });
    } catch (err: any) {
      console.error(`Scraping failed for ${url}:`, err.message);
      articles.push({
        title: item.title,
        url: url,
        domain: new URL(url).hostname,
        headings: [item.title],
        metaDescription: item.snippet || ''
      });
    }
  }

  return {
    articles,
    averageLength: 2500,
    commonTopics: []
  };
}

// === ファクトチェック用ヘルパー関数 ===

/**
 * 記事からファクト情報を抽出（正規表現ベース）
 */
async function extractFactsFromContent(
  content: string,
  userMarkedText?: string
): Promise<any[]> {
  const items: any[] = [];

  // ユーザーマーク箇所を最優先で追加 [[]]
  if (userMarkedText) {
    const regex = /\[\[(.+?)\]\]/g;
    let match;
    while ((match = regex.exec(userMarkedText)) !== null) {
      const start = Math.max(0, match.index - 50);
      const end = Math.min(userMarkedText.length, match.index + match[0].length + 50);

      items.push({
        claim: match[1],
        context: userMarkedText.substring(start, end),
        priority: 'high'
      });
    }
  }

  // 数値の抽出（例: 「85%」「100万円」「2023年」）
  const numberRegex = /(\d+(?:,\d{3})*(?:\.\d+)?[%円万億兆ドル年月日人件個])/g;
  let match;

  while ((match = numberRegex.exec(content)) !== null) {
    const start = Math.max(0, match.index - 30);
    const end = Math.min(content.length, match.index + match[0].length + 30);

    items.push({
      claim: match[0],
      context: content.substring(start, end),
      priority: 'normal'
    });
  }

  // 日付の抽出
  const dateRegex = /(\d{4}年\d{1,2}月\d{1,2}日|\d{4}年\d{1,2}月|\d{4}年)/g;
  while ((match = dateRegex.exec(content)) !== null) {
    const start = Math.max(0, match.index - 30);
    const end = Math.min(content.length, match.index + match[0].length + 30);

    items.push({
      claim: match[0],
      context: content.substring(start, end),
      priority: 'normal'
    });
  }

  // 優先度でソート（high → normal）
  return items.sort((a, b) => a.priority === 'high' ? -1 : 1);
}

/**
 * Perplexity APIで複数の事実を一括検証（バッチ処理）
 */
async function verifyFactsBatch(
  items: any[],
  apiKey: string,
  keyword: string,
  modelName: string = 'sonar',
  batchSize: number = 5
): Promise<any[]> {
  const results: any[] = [];

  // バッチに分割
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);

    // バッチ用プロンプト作成
    const claimsList = batch.map((item, idx) =>
      `${idx + 1}. 【主張】${item.claim}\n   【文脈】${item.context}`
    ).join('\n\n');

    const prompt = `以下のリストにある各主張について、最新のWeb情報を元に一括でファクトチェックしてください。

【検証リスト】
${claimsList}

【関連キーワード】${keyword}

【回答形式】
JSON配列で以下の形式で返してくださ い:
[
  {
    "claim_number": 1,
    "verdict": "correct | incorrect | partially_correct | unverified",
    "confidence": 0-100,
    "correct_info": "正しい情報（誤りの場合のみ）",
    "explanation": "説明",
    "source_url": "出典URL"
  }
]`;

    try {
      const response = await fetch('https://api.perplexity.ai/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: modelName,
          messages: [
            { role: 'system', content: 'You are a fact-checking expert. Verify the truth of the provided information and provide reliable sources in Japanese.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.1
        })
      });

      if (!response.ok) {
        throw new Error(`Perplexity API error: ${response.status}`);
      }

      const data = await response.json();
      const content = data.choices[0].message.content;

      // JSONパース
      let batchResults;
      try {
        // JSON配列を抽出（マークダウンコードブロックを除去）
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        batchResults = JSON.parse(jsonMatch ? jsonMatch[0] : content);
      } catch {
        console.error('Failed to parse batch results, treating as unverified');
        batchResults = batch.map((_, idx) => ({
          claim_number: idx + 1,
          verdict: 'unverified',
          confidence: 0,
          explanation: 'パース失敗',
          source_url: ''
        }));
      }

      // 結果をマージ
      batch.forEach((item, idx) => {
        const result = batchResults.find((r: any) => r.claim_number === idx + 1) || batchResults[idx];
        results.push({
          claim: item.claim,
          verdict: result.verdict,
          confidence: result.confidence,
          correctInfo: result.correct_info,
          sourceUrl: result.source_url,
          explanation: result.explanation
        });
      });

      // Rate limiting対策: バッチ間で2秒待機
      if (i + batchSize < items.length) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

    } catch (error: any) {
      console.error(`Batch verification failed for items ${i}-${i + batchSize}:`, error);
      // エラー時は未検証として記録
      batch.forEach(item => {
        results.push({
          claim: item.claim,
          verdict: 'unverified',
          confidence: 0,
          explanation: `エラー: ${error.message}`,
          sourceUrl: ''
        });
      });
    }
  }

  return results;
}