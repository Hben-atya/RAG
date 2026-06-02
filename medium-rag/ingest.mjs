import fs from 'fs';
import csv from 'csv-parser';
import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';
import dotenv from 'dotenv';
// Import the encoder for OpenAI models (text-embedding-3-small uses cl100k_base)
import { encode, decode } from 'gpt-tokenizer/model/text-embedding-3-small';

// Load environment variables
dotenv.config({ path: '.env.local' });

const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });

const openai = new OpenAI({ 
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: "https://api.llmod.ai/v1" 
});

const index = pinecone.Index(process.env.PINECONE_INDEX_NAME);

// EXACT HYPERPARAMETERS (Now explicitly in tokens!)
const CHUNK_SIZE_TOKENS = 600; // Well under the 1024 max target
const OVERLAP_RATIO = 0.2;     // 20% overlap (Safely under the 30% max)
const OVERLAP_SIZE_TOKENS = Math.floor(CHUNK_SIZE_TOKENS * OVERLAP_RATIO);

// New function that splits text strictly by token counts
function chunkTextByTokens(text) {
    // Convert the entire raw text into an array of token IDs
    const tokens = encode(text);
    const chunks = [];
    
    let i = 0;
    while (i < tokens.length) {
        // Grab a slice of token IDs up to your maximum chunk size
        const tokenSlice = tokens.slice(i, i + CHUNK_SIZE_TOKENS);
        
        // Decode those token IDs back into readable string text for the vectorizer/metadata
        const textChunk = decode(tokenSlice);
        chunks.push(textChunk);
        
        // Move the window forward, subtracting the token overlap
        i += (CHUNK_SIZE_TOKENS - OVERLAP_SIZE_TOKENS);
    }
    return chunks;
}

async function runIngestion() {
    console.log("Starting CSV processing (Token-based)...");
    const articles = [];
    
    fs.createReadStream('medium-english-50mb.csv')
        .pipe(csv({ mapHeaders: ({ header }) => header.trim().toLowerCase() }))
        .on('data', (row) => articles.push(row))
        .on('end', async () => {
            console.log(`Total rows read: ${articles.length}`);
            
            // Re-running the full dataset
            const testBatch = articles; 

            for (let i = 0; i < testBatch.length; i++) {
                const article = testBatch[i];
                const textToChunk = article.text || "";
                
                if (!textToChunk.trim()) continue;
                
                // Chunking by tokens now!
                const chunks = chunkTextByTokens(textToChunk);
                
                const vectorsToUpsert = [];
                
                for (let j = 0; j < chunks.length; j++) {
                    const chunk = chunks[j];
                    
                    try {
                        const response = await openai.embeddings.create({
                            model: "4UHRUIN-text-embedding-3-small",
                            input: chunk,
                        });
                        
                        const safeId = `article-${i}-chunk-${j}`;
                        
                        vectorsToUpsert.push({
                            id: safeId,
                            values: response.data[0].embedding,
                            metadata: {
                                article_id: article.url || "N/A",
                                title: article.title || "Untitled",
                                chunk: chunk
                            }
                        });
                    } catch (err) {
                        console.error("OpenAI Error:", err.message);
                    }
                }
                
                if (vectorsToUpsert.length > 0) {
                    try {
                        await index.upsert({ records: vectorsToUpsert });
                        if (i % 100 === 0) {
                            console.log(`Progress: Ingested ${i}/${testBatch.length} articles...`);
                        }
                    } catch (err) {
                        console.error("Pinecone Error:", err.message);
                    }
                }
            }
            console.log("Token-based ingestion complete!");
        });
}

runIngestion().catch(console.error);