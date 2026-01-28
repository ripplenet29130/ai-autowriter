// Supabase Edge Function for scheduled article generation
// supabase/functions/scheduler/index.ts

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
    // CORS対応
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        console.log('✅ スケジューラー起動')

        // Supabaseクライアント作成
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        const supabase = createClient(supabaseUrl, supabaseKey)

        // 現在時刻（JST）
        const now = new Date()
        const jstTime = new Date(now.getTime() + (9 * 60 * 60 * 1000))
        const currentHour = jstTime.getHours()
        const currentMinute = jstTime.getMinutes()
        const timeString = `${String(currentHour).padStart(2, '0')}:${String(currentMinute).padStart(2, '0')}`

        console.log(`🕒 現在時刻(JST): ${timeString}`)

        // 有効なスケジュール取得
        const { data: schedules, error: scheduleError } = await supabase
            .from('schedule_settings')
            .select('*')
            .eq('status', true)

        if (scheduleError) throw scheduleError
        if (!schedules?.length) {
            return new Response(
                JSON.stringify({ message: 'アクティブなスケジュールがありません' }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // 現在時刻に該当するスケジュールを抽出（±5分の余裕）
        const matchingSchedules = schedules.filter(s => {
            if (!s.post_time) return false
            const [targetHour, targetMinute] = s.post_time.split(':').map(Number)
            const timeDiff = Math.abs((currentHour * 60 + currentMinute) - (targetHour * 60 + targetMinute))
            return timeDiff <= 5
        })

        if (matchingSchedules.length === 0) {
            return new Response(
                JSON.stringify({ message: '現在時刻に該当するスケジュールがありません' }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // ランダムに1つ選択
        const schedule = matchingSchedules[Math.floor(Math.random() * matchingSchedules.length)]
        console.log(`🎯 選択されたスケジュール: ID ${schedule.id}`)

        // WordPress設定取得
        const { data: wp, error: wpError } = await supabase
            .from('wp_configs')
            .select('*')
            .eq('id', schedule.wp_config_id)
            .single()

        if (wpError || !wp) {
            throw new Error(`WordPress設定が見つかりません (ID: ${schedule.wp_config_id})`)
        }

        console.log(`🌐 投稿先: ${wp.sitename || wp.url}`)

        // キーワードをランダムに選択
        let keywords = ['最新情報']
        try {
            if (Array.isArray(schedule.keyword)) {
                keywords = schedule.keyword
            } else if (typeof schedule.keyword === 'string') {
                keywords = JSON.parse(schedule.keyword)
            }
        } catch (e) {
            console.warn('キーワードのパースに失敗:', e)
        }

        const keyword = keywords[Math.floor(Math.random() * keywords.length)]
        console.log(`🧩 選択されたキーワード: ${keyword}`)

        // AI記事生成（aiServiceを呼び出す）
        // 注意: Edge Functionでは外部モジュールのインポートに制限があるため、
        // ここでは直接AIを呼び出すか、別のEdge Functionを呼び出す必要があります

        // AI設定取得
        const { data: aiConfig } = await supabase
            .from('ai_configs')
            .select('*')
            .eq('is_active', true)
            .single()

        if (!aiConfig) {
            throw new Error('AI設定が見つかりません')
        }

        // Gemini APIを直接呼び出し（例）
        const geminiResponse = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${aiConfig.model}:generateContent?key=${aiConfig.api_key}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        parts: [{
                            text: `以下のキーワードで日本語のブログ記事を書いてください。

キーワード: ${keyword}

要件:
- タイトルと本文を分けて出力
- 見出しには ## を使用
- 2000文字程度
- SEOを意識した内容`
                        }]
                    }]
                })
            }
        )

        const geminiData = await geminiResponse.json()
        const generatedText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || ''

        const lines = generatedText.split('\n')
        const title = lines[0].replace(/^#+\s*/, '').trim()
        const content = lines.slice(1).join('\n').trim()

        console.log(`✅ 記事生成完了: ${title}`)

        // WordPress投稿
        const wpAuth = btoa(`${wp.username}:${wp.application_password}`)
        const wpResponse = await fetch(`${wp.url}/wp-json/wp/v2/posts`, {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${wpAuth}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                title,
                content,
                status: 'publish'
            })
        })

        if (!wpResponse.ok) {
            throw new Error(`WordPress投稿失敗: ${wpResponse.status}`)
        }

        const wpPost = await wpResponse.json()
        console.log(`📰 投稿完了: ${wpPost.link}`)

        // Supabaseに記事保存
        const { error: insertError } = await supabase
            .from('articles')
            .insert({
                title,
                content,
                category: wp.category,
                wordpress_id: wp.id,
                wordpress_post_id: String(wpPost.id),
                wordpress_url: wpPost.link,
                status: 'published',
                is_published: true,
                published_at: new Date().toISOString(),
                created_at: new Date().toISOString()
            })

        if (insertError) throw insertError

        console.log('💾 Supabaseへ保存完了')

        return new Response(
            JSON.stringify({
                success: true,
                message: '記事投稿完了',
                title,
                url: wpPost.link
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

    } catch (error) {
        console.error('💥 エラー:', error)
        return new Response(
            JSON.stringify({ error: error.message }),
            {
                status: 500,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            }
        )
    }
})
