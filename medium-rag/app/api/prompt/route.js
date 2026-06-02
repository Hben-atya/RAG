import { NextResponse } from 'next/server';
import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';

const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
// const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const openai = new OpenAI({ 
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: "https://api.llmod.ai/v1" // <-- REPLACE WITH THE URL FROM YOUR DASHBOARD
});

const SYSTEM_PROMPT = `You are a Medium-article assistant that answers questions strictly and only based on the Medium articles dataset context provided to you (metadata and article passages). You must not use any external knowledge, the open internet, or information that is not explicitly contained in the retrieved context. If the answer cannot be determined from the provided context, respond: "I don't know based on the provided Medium articles data." Always explain your answer using the given context, quoting or paraphrasing the relevant article passage or metadata when helpful.`;

export async function POST(request) {
    try {
        const body = await request.json();
        const question = body.question;

        const queryEmbeddingRes = await openai.embeddings.create({
            model: "4UHRUIN-text-embedding-3-small",
            input: question,
        });

        const index = pinecone.Index(process.env.PINECONE_INDEX_NAME);
        const queryResponse = await index.query({
            vector: queryEmbeddingRes.data[0].embedding,
            topK: 7,
            includeMetadata: true,
        });

        const contextData = queryResponse.matches.map(match => ({
            article_id: match.metadata.article_id || "unknown",
            title: match.metadata.title || "Untitled",
            chunk: match.metadata.chunk || "",
            score: match.score || 0
        }));

        const contextString = contextData.map(c => 
            `Title: ${c.title}\nText: ${c.chunk}`
        ).join("\n\n---\n\n");

        const userPrompt = `Context:\n${contextString}\n\nQuestion: ${question}`;

        const chatRes = await openai.chat.completions.create({
            model: "4UHRUIN-gpt-5-mini",
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: userPrompt }
            ]
        });

        return NextResponse.json({
            "response": chatRes.choices[0].message.content,
            "context": contextData,
            "Augmented_prompt": {
                "System": SYSTEM_PROMPT,
                "User": userPrompt
            }
        });

    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}