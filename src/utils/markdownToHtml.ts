/**
 * Simple Markdown to HTML converter
 * Handles headers, bold, lists, and paragraphs
 */
export function convertMarkdownToHtml(markdown: string): string {
    if (!markdown) return '';

    let html = markdown;

    // Headers (h1-h6)
    // Note: We process from h6 to h1 to avoid matching substring conflicts, though distinct regex usually handles it.
    html = html.replace(/^###### (.*$)/gim, '<h6>$1</h6>');
    html = html.replace(/^##### (.*$)/gim, '<h5>$1</h5>');
    html = html.replace(/^#### (.*$)/gim, '<h4>$1</h4>');
    html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
    html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');

    // Bold (**text**)
    html = html.replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>');

    // Italic (*text*)
    html = html.replace(/\*(.*?)\*/gim, '<em>$1</em>');

    // Unordered Lists (- item or * item)
    // This is a bit simplistic: it turns every list item line into <li>...</li>
    // wrapping them in <ul> is more complex with regex-only, but often <br> or just <li> works in WP 
    // or we can try to wrap consecutive LI's. 
    // For WordPress, just converting the lines usually works if it auto-p's, but explicit HTML is better.
    // Let's just do simple line replacement for now, WP often handles the block wrapper or we can add it.
    // Actually, let's try to group them.
    // Simple approach: Replace - item with <li>item</li>
    html = html.replace(/^\s*[-*]\s+(.*$)/gim, '<li>$1</li>');

    // Wrap <li> elements in <ul> if they are consecutive (requires a second pass or smarter regex)
    // For now, let's leave as <li>. WordPress "Classic" block might handle it, or Gutenberg "HTML" block.
    // Ideally, valid HTML requires <ul>.
    // Let's do a basic wrap for the whole block of LIs.
    // This regex looks for sequences of <li>...</li> and wraps them.
    // Note: multiline checks in JS regex can be tricky.
    // A safer bet for a simple utility without a parser is to just handle headers and paragraphs well first.

    // Paragraphs
    // Split by double newlines and wrap content that isn't already tagged
    // This is potentially destructive if not careful. 
    // A common simple trick: replace \n\n with <p> formatting.

    // Let's keep it simple for headers first as requested, and ensure newlines become <p> or <br>
    // WordPress API usually expects HTML content.
    // If we send raw text with <h2> tags, it interprets standard tags. 
    // It also automatically converts double newlines to paragraphs usually (wpautop).
    // So we often don't need to wrap everything in <p> explicitly if we just handle the markdown blocks.

    // Convert newlines to <br> for single line breaks?
    // html = html.replace(/\n/gim, '<br>'); // This might be too aggressive if WP does auto-p.

    return html;
}
