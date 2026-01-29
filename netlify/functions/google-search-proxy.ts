import { Handler } from "@netlify/functions";

export const handler: Handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const params = JSON.parse(event.body || '{}');
        const qs = new URLSearchParams(params).toString();

        console.log('Proxying request to Google Custom Search API...');

        const response = await fetch(`https://www.googleapis.com/customsearch/v1?${qs}`);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error?.message || response.statusText);
        }

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*' // CORS対応
            },
            body: JSON.stringify(data)
        };
    } catch (error: any) {
        console.error('Google Proxy error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
};
