// Filename: server.js
// --- Dependencies ---
// To run this, you need Node.js installed.
// Then, in your terminal, run:
// npm install express node-fetch puppeteer cors
// You will also need to get a Gemini API key from Google AI Studio.

import express from 'express';
import fetch from 'node-fetch';
import puppeteer from 'puppeteer';
import cors from 'cors';

// --- Configuration ---
const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.GEMINI_API_KEY || ""; // IMPORTANT: Set this as an environment variable for security

// --- Middleware ---
app.use(cors()); // Allows your frontend to call this backend
app.use(express.json()); // Allows the server to understand JSON in request bodies

/**
 * Fetches and cleans the HTML content of a given URL using Puppeteer.
 * @param {string} url - The URL of the website to scrape.
 * @returns {Promise<string>} - The cleaned HTML content of the page body.
 */
async function getWebsiteContent(url) {
    console.log(`Launching browser to fetch content for: ${url}`);
    const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
        const bodyHTML = await page.evaluate(() => {
            // Remove script and style tags to reduce token count and noise
            document.querySelectorAll('script, style, link[rel="stylesheet"]').forEach(el => el.remove());
            return document.body.innerText; // Get inner text to focus on content
        });
        console.log("Successfully fetched and cleaned website content.");
        return bodyHTML.trim().substring(0, 10000); // Limit content to avoid overly large payloads
    } catch (error) {
        console.error(`Puppeteer error fetching ${url}:`, error);
        throw new Error(`Could not fetch or process the content of the URL. It might be down or blocking scrapers.`);
    } finally {
        await browser.close();
        console.log("Browser closed.");
    }
}

/**
 * Defines the JSON schema for the AI's response to ensure consistency.
 */
const responseSchema = {
    type: "OBJECT",
    properties: {
        "heuristics": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "title": { "type": "STRING" },
                    "finding": { "type": "STRING" },
                    "recommendation": { "type": "STRING" },
                    "severity": { "type": "STRING", "enum": ["Critical", "High", "Medium", "Positive"] },
                    "effort": { "type": "STRING", "enum": ["High", "Medium", "Low", "N/A"] }
                },
                "required": ["title", "finding", "recommendation", "severity", "effort"]
            }
        },
        "golden-rules": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "title": { "type": "STRING" },
                    "finding": { "type": "STRING" },
                    "recommendation": { "type": "STRING" },
                    "severity": { "type": "STRING", "enum": ["Critical", "High", "Medium", "Positive"] },
                    "effort": { "type": "STRING", "enum": ["High", "Medium", "Low", "N/A"] }
                },
                "required": ["title", "finding", "recommendation", "severity", "effort"]
            }
        },
         "user-flow": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "title": { "type": "STRING" },
                    "finding": { "type": "STRING" },
                    "recommendation": { "type": "STRING" },
                    "severity": { "type": "STRING", "enum": ["Critical", "High", "Medium", "Positive"] },
                    "effort": { "type": "STRING", "enum": ["High", "Medium", "Low", "N/A"] }
                },
                 "required": ["title", "finding", "recommendation", "severity", "effort"]
            }
        },
        "benchmark": {
            "type": "OBJECT",
            "properties": {
                "designScore": { "type": "NUMBER" },
                "summary": { "type": "STRING" }
            },
            "required": ["designScore", "summary"]
        }
    },
    "required": ["heuristics", "golden-rules", "user-flow", "benchmark"]
};


/**
 * Generates the UX audit by calling the Gemini API.
 * @param {string} websiteContent - The text content of the website.
 * @returns {Promise<Object>} - The parsed JSON response from the AI.
 */
async function generateAuditWithAI(websiteContent) {
    console.log("Generating AI audit...");
    if (!API_KEY) {
        throw new Error("GEMINI_API_KEY is not set. Please add it to your environment variables.");
    }
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${API_KEY}`;
    
    const prompt = `
        Please act as a senior UX researcher. Analyze the following website content and perform a comprehensive UX audit.
        Based on the text content provided, evaluate the site against Nielsen's Heuristics, Shneiderman's Golden Rules, and common user flow issues.
        Also, provide a competitive benchmark score and summary.
        
        Your response MUST be a valid JSON object that strictly follows the provided schema.
        Do not include any text outside of the JSON object.
        
        Website Content to Analyze:
        ---
        ${websiteContent}
        ---
    `;

    const payload = {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: responseSchema,
        }
    };
    
    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorBody = await response.text();
            console.error("Gemini API Error Response:", errorBody);
            throw new Error(`Gemini API request failed with status ${response.status}`);
        }

        const result = await response.json();
        const jsonText = result.candidates[0].content.parts[0].text;
        console.log("Successfully received JSON from AI.");
        return JSON.parse(jsonText);
        
    } catch (error) {
        console.error("Error calling Gemini API:", error);
        throw new Error("Failed to generate audit from AI.");
    }
}


// --- API Endpoint ---
app.post('/api/audit', async (req, res) => {
    const { url } = req.body;
    if (!url) {
        return res.status(400).json({ error: 'URL is required.' });
    }
    
    console.log(`\n--- New Audit Request for ${url} ---`);

    try {
        // 1. Get website content
        const websiteContent = await getWebsiteContent(url);
        
        // 2. Generate the audit using the AI
        const auditData = await generateAuditWithAI(websiteContent);
        
        // 3. Send the successful response to the frontend
        res.json(auditData);

    } catch (error) {
        console.error("Error during audit process:", error.message);
        res.status(500).json({ error: error.message || 'An internal server error occurred.' });
    }
});

// --- Server Start ---
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    if (!API_KEY) {
        console.warn("WARNING: GEMINI_API_KEY environment variable is not set. The API calls will fail.");
    }
});
