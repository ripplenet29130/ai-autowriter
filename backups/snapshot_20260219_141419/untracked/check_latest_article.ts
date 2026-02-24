import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://jozinzyaiudwxtyjflfm.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpvemluenlhaXVkd3h0eWpmbGZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE5MDE3NTEsImV4cCI6MjA3NzQ3Nzc1MX0._gcIiXjVdaDlMgUXGI4xn1uaaPdvdhgiE1JZ00UAH_U';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function checkLatestArticle() {
    const { data, error } = await supabase
        .from('articles')
        .select('id, title, content, created_at, keywords')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

    if (error) {
        console.error('Error fetching article:', error);
        return;
    }

    console.log('--- Latest Generated Article ---');
    console.log(`ID: ${data.id}`);
    console.log(`Title: ${data.title}`);
    console.log(`Keywords: ${data.keywords}`);
    console.log(`Created At: ${new Date(data.created_at).toLocaleString()}`);
    console.log('\n--- Content Snippet (End) ---');

    const content = data.content || '';
    const summaryIndex = content.lastIndexOf('## まとめ');

    if (summaryIndex !== -1) {
        console.log(content.substring(summaryIndex));
        console.log('\n✅ Summary section found!');
    } else {
        console.log(content.slice(-500));
        console.log('\n❌ Summary section NOT found with "## まとめ" heading.');
    }

    // Check title quality (simple heuristic)
    if (data.title.includes('?')) {
        console.log('\n⚠️ Title contains "?". Verify if it is too weak.');
    } else {
        console.log('\n✅ Title does not contain "?".');
    }
}

checkLatestArticle();
