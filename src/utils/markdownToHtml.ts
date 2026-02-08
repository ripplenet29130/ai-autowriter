/**
 * Convert Markdown/HTML content to Gutenberg block format
 * Gutenberg uses HTML comments to define blocks
 */
export function convertToGutenbergBlocks(content: string): string {
    if (!content) return '';

    let result = '';
    const lines = content.split('\n');
    let inList = false;
    let listItems: string[] = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        // Skip empty lines
        if (!line) {
            // Close list if we were in one
            if (inList) {
                result += createListBlock(listItems);
                inList = false;
                listItems = [];
            }
            continue;
        }

        // Headers (h1-h6)
        const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
        if (headerMatch) {
            if (inList) {
                result += createListBlock(listItems);
                inList = false;
                listItems = [];
            }
            const level = headerMatch[1].length;
            const text = headerMatch[2];
            result += createHeadingBlock(text, level);
            continue;
        }

        // Check if line already has HTML tags (like <h2>)
        const htmlHeaderMatch = line.match(/^<h([1-6])>(.*?)<\/h[1-6]>$/);
        if (htmlHeaderMatch) {
            if (inList) {
                result += createListBlock(listItems);
                inList = false;
                listItems = [];
            }
            const level = parseInt(htmlHeaderMatch[1]);
            const text = htmlHeaderMatch[2];
            result += createHeadingBlock(text, level);
            continue;
        }

        // List items
        const listMatch = line.match(/^[-*]\s+(.+)$/);
        if (listMatch) {
            inList = true;
            listItems.push(listMatch[1]);
            continue;
        }

        // Check for <li> tags
        const liMatch = line.match(/^<li>(.*?)<\/li>$/);
        if (liMatch) {
            inList = true;
            listItems.push(liMatch[1]);
            continue;
        }

        // Regular paragraph
        if (inList) {
            result += createListBlock(listItems);
            inList = false;
            listItems = [];
        }

        // Process inline formatting (bold, italic)
        let processedLine = line;

        // Remove existing HTML tags if any
        processedLine = processedLine.replace(/<\/?p>/g, '');

        // Process markdown formatting
        processedLine = processedLine.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        processedLine = processedLine.replace(/\*(.+?)\*/g, '<em>$1</em>');

        if (processedLine) {
            result += createParagraphBlock(processedLine);
        }
    }

    // Close any remaining list
    if (inList) {
        result += createListBlock(listItems);
    }

    return result;
}

function createHeadingBlock(text: string, level: number): string {
    // Clean text from any existing HTML tags
    const cleanText = text.replace(/<[^>]*>/g, '');

    return `<!-- wp:heading {"level":${level}} -->
<h${level} class="wp-block-heading">${cleanText}</h${level}>
<!-- /wp:heading -->

`;
}

function createParagraphBlock(text: string): string {
    return `<!-- wp:paragraph -->
<p>${text}</p>
<!-- /wp:paragraph -->

`;
}

function createListBlock(items: string[]): string {
    const listItems = items.map(item => `<li>${item}</li>`).join('');
    return `<!-- wp:list -->
<ul class="wp-block-list">${listItems}</ul>
<!-- /wp:list -->

`;
}

/**
 * Legacy function - converts markdown to simple HTML
 * Use convertToGutenbergBlocks for WordPress posts
 */
export function convertMarkdownToHtml(markdown: string): string {
    if (!markdown) return '';

    let html = markdown;

    // Headers (h1-h6)
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
    html = html.replace(/^\s*[-*]\s+(.*$)/gim, '<li>$1</li>');

    return html;
}
