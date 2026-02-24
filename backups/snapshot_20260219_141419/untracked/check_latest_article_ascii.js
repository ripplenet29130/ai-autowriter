import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://jozinzyaiudwxtyjflfm.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpvemluenlhaXVkd3h0eWpmbGZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE5MDE3NTEsImV4cCI6MjA3NzQ3Nzc1MX0._gcIiXjVdaDlMgUXGI4xn1uaaPdvdhgiE1JZ00UAH_U';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function checkLatestArticle() {
    const { data, error } = await supabase
        .from('articles')
        .select('id, title, content')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

    if (error) {
        console.error('Error:', error);
        return;
    }

    console.log('ID: ' + data.id);
    console.log('Title length: ' + (data.title ? data.title.length : 0));

    const content = data.content || '';
    const summaryMatches = content.match(/##\s*(まとめ|結論|おわりに|最後に|総括|総まとめ|summary|conclusion)/i);

    if (summaryMatches) {
        console.log('Summary section found: YES');
        const summaryContent = content.substring(summaryMatches.index);
        console.log('Summary length: ' + summaryContent.length);
        console.log('Summary lines: ' + summaryContent.split('\n').filter(l => l.trim().length > 0).length);
    } else {
        console.log('Summary section found: NO');
    }
}

checkLatestArticle();
