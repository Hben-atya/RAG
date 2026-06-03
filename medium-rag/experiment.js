require('dotenv').config({ path: '.env.local' });
const { Pinecone } = require('@pinecone-database/pinecone');
const { OpenAI } = require('openai');

const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const index = pinecone.Index(process.env.PINECONE_INDEX_NAME);

const openai = new OpenAI({ 
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: "https://api.llmod.ai/v1" 
});

const sampleText = `Inequality is a major factor in the health of a population. There are larger, long term lessons to be learned here for those of us connected to public education. There has been constant pressure on schools to improve performance, with an emphasis on raising test scores. None of this pressure includes reducing inequality, addressing systemic issues, or recognizing that schools are not operating in a bubble. We can’t fundamentally improve our schools without making fundamental changes to the communities in which they are situated. If we want to improve test scores make sure all of our students are getting enough to eat, have safe and secure places to sleep, and are living in family situations that are stable and healthy. Imagine with me a school where students spend so much time outside and doing projects in the community. When teachers look at students in this school, they look through a different lens. Instead of being data collectors, they see each child’s emergent and future potential.`;

function chunkTokens(text, chunkSize, overlap) {
    const wordChunkSize = Math.max(1, Math.round(chunkSize * 0.75));
    const wordOverlap = Math.max(0, Math.round(overlap * 0.75));
    
    const words = text.split(/\s+/).filter(w => w.trim().length > 0);
    const chunks = [];
    const step = Math.max(1, wordChunkSize - wordOverlap);

    if (words.length === 0) return chunks;

    for (let i = 0; i < words.length; i += step) {
        const chunkWords = words.slice(i, i + wordChunkSize);
        chunks.push(chunkWords.join(" "));
        if (i + wordChunkSize >= words.length) break;
    }
    return chunks;
}

// Local mathematical similarity (Cosine) as our foolproof backup plan
function cosineSimilarity(vecA, vecB) {
    let dotProduct = 0, normA = 0, normB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

const configurations = [
    { name: "test-150", size: 150, overlap: 15 },
    { name: "test-600", size: 600, overlap: 120 },
    { name: "test-1000", size: 1000, overlap: 200 }
];

async function runExperiment() {
    console.log("Starting Parameter Experiment Workflow...\n");
    
    // We will store the vectors in memory just in case Pinecone fails
    const inMemoryDatabases = {};

    for (const config of configurations) {
        console.log(`Processing configuration: ${config.name}`);
        
        const chunks = chunkTokens(sampleText, config.size, config.overlap);
        const vectors = [];

        for (let i = 0; i < chunks.length; i++) {
            const response = await openai.embeddings.create({
                model: "4UHRUIN-text-embedding-3-small",
                input: chunks[i],
            });

            const rawEmbedding = response?.data?.[0]?.embedding || response?.data || response?.embedding;
            vectors.push({
                id: `exp_chunk_${config.name}_${i}`,
                values: rawEmbedding,
                metadata: { title: "Experiment Article", text: chunks[i] }
            });
        }

        // BRUTE FORCE CLEANING: Force everything into strict primitive types
        const cleanVectors = vectors.map(v => ({
            id: String(v.id),
            values: Array.from(v.values).map(Number),
            metadata: { 
                title: String(v.metadata.title), 
                text: String(v.metadata.text) 
            }
        }));

        inMemoryDatabases[config.name] = cleanVectors;

        try {
            await index.namespace(config.name).upsert(cleanVectors);
            console.log(` -> Pinecone Success: Uploaded ${cleanVectors.length} chunks to namespace: ${config.name}\n`);
        } catch (err) {
            console.log(` -> Pinecone Rejected Upload. Relying on Local Memory Database for ${config.name}.\n`);
        }
    }

    const testQuestion = "How does inequality affect public education and school performance?";
    console.log(`Evaluating Query: "${testQuestion}"\n`);
    
    const embedRes = await openai.embeddings.create({
        model: "4UHRUIN-text-embedding-3-small",
        input: testQuestion,
    });
    const queryVector = Array.from(embedRes?.data?.[0]?.embedding || embedRes?.data || embedRes?.embedding).map(Number);

    for (const config of configurations) {
        console.log(`--- Results for namespace: ${config.name} ---`);
        try {
            // Try Pinecone First
            const results = await index.namespace(config.name).query({
                topK: 1,
                vector: queryVector,
                includeMetadata: true
            });

            if (results.matches && results.matches.length > 0) {
                console.log(`Top Score (Pinecone): ${results.matches[0].score.toFixed(4)}`);
                console.log(`Content Snippet: "${results.matches[0].metadata.text.substring(0, 140)}..."\n`);
            } else {
                throw new Error("No matches found in Pinecone. Failing over to memory.");
            }
        } catch (err) {
            // Fallback to Local Memory Search
            const localVectors = inMemoryDatabases[config.name];
            let bestScore = -1;
            let bestMatch = null;

            for (const record of localVectors) {
                const score = cosineSimilarity(queryVector, record.values);
                if (score > bestScore) {
                    bestScore = score;
                    bestMatch = record;
                }
            }

            if (bestMatch) {
                console.log(`Top Score (Local Fallback): ${bestScore.toFixed(4)}`);
                console.log(`Content Snippet: "${bestMatch.metadata.text.substring(0, 140)}..."\n`);
            } else {
                console.log("No matches found locally either.\n");
            }
        }
    }
}

runExperiment().catch(console.error);