import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://jozinzyaiudwxtyjflfm.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpvemluenlhaXVkd3h0eWpmbGZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE5MDE3NTEsImV4cCI6MjA3NzQ3Nzc1MX0._gcIiXjVdaDlMgUXGI4xn1uaaPdvdhgiE1JZ00UAH_U';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function checkLatestArticle() {
    console.log('Fetching latest article...');
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
    // Parse created_at safely
    const createdAt = new Date(data.created_at);
    console.log(`Created At: ${createdAt.toLocaleString()}`);

    const now = new Date();
    const diffMinutes = (now.getTime() - createdAt.getTime()) / 1000 / 60;
    console.log(`Time since creation: ${diffMinutes.toFixed(1)} minutes`);

    console.log('\n--- Content Snippet (End) ---');

    const content = data.content || '';
    // Check for summary heading
    const summaryMatches = content.match(/##\s*(まとめ|結論|おわりに|最後に|総括|総まとめ|summary|conclusion)/i);

    if (summaryMatches) {
        const summaryIndex = summaryMatches.index;
        const summaryContent = content.substring(summaryIndex);
        console.log(summaryContent.substring(0, 500) + '...'); // Print first 500 chars of summary

        // Check if summary has content
        const lines = summaryContent.split('\n').filter(line => line.trim().length > 0);
        // Heading + at least 2 lines of text
        if (lines.length > 2) {
            console.log('\n✅ Summary section found and has content!');
        } else {
            console.log('\n⚠️ Summary section found but might be empty/short.');
        }

    } else {
        // Check strictly at the end
        const lastPart = content.slice(-500);
        console.log(lastPart);
        console.log('\n❌ Summary section NOT found with "## まとめ" heading.');
    }

    // Check title quality
    if (data.title.includes('?')) {
        console.log('\n⚠️ Title contains "?". Verify if it is too weak (e.g. "XXXとは？").');
    } else {
        console.log('\n✅ Title does not contain "?" (Good sign for assertive title).');
    }
}

checkLatestArticle();
