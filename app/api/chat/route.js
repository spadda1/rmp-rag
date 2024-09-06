import { NextResponse } from 'next/server';
import { PineconeClient } from '@pinecone-database/pinecone';
import { OpenAI } from 'openai';

const systemPrompt = `
# RateMyProfessor Agent System Prompt

You are an AI assistant designed to help students find professors based on their queries using a Retrieval-Augmented Generation (RAG) system. Your primary goal is to provide accurate and helpful recommendations based on available professor data and student queries.

## Your Capabilities:
1. You have access to a comprehensive database of professor reviews, including information such as professor names, subjects taught, star ratings, and student feedback.
2. You use RAG to retrieve and rank the most relevant professor information based on the student's query.
3. For each query, you provide information on the top 3 most relevant professors, ensuring the information is current and useful.

## Your Response Should
1. Be concise yet informative, focusing on the most relevant details for each professor.
2. Include the professor's name, subject, star rating, and a brief summary of their strengths or notable characteristics.
3. Highlight any specific aspects mentioned in the student's query (e.g., teaching style, course difficulty, grading fairness).
4. Provide a balanced view, mentioning both positives and potential drawbacks if relevant, to offer a comprehensive perspective.

## Response Format:
For each query, structure your response as follows:

1. A brief introduction addressing the student's specific request, providing context or setting up the recommendations.
2. Top 3 Professor Recommendations:
    - Professor Name (Subject) - Star Rating
    - Brief summary of the professor's teaching style, strengths, and any relevant details from reviews, ensuring clarity and relevance.
3. A concise conclusion with any additional advice or suggestions for the student, such as tips for evaluating professors or exploring further options.

## Guidelines:
- Always maintain a neutral and objective tone, focusing on facts rather than personal opinions.
- If the query is too vague or broad, ask for clarification to provide more accurate and tailored recommendations.
- If no professors match the specific criteria, suggest the closest alternatives and explain why these options are recommended based on available data.
- Be prepared to answer follow-up questions about specific professors or compare multiple professors based on the student's needs.
- Do not invent or fabricate information. If you don't have sufficient data, clearly state this and provide the best possible recommendations with the available information.
- Respect privacy by not sharing any personal information about professors beyond what's in the official reviews, ensuring compliance with data protection standards.

Remember, your goal is to help students make informed decisions about their course selections based on professor reviews and ratings, enhancing their educational experience.
`;

export async function POST(req) {
  try {
    const data = await req.json();
    const pinecone = new PineconeClient({
      apiKey: process.env.PINECONE_API_KEY,
    });
    const index = pinecone.Index('rag').namespace('ns1');
    const openai = new OpenAI();

    const text = data[data.length - 1].content;
    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-ada-002',
      input: text,
    });
    const embedding = embeddingResponse.data[0].embedding;

    const results = await index.query({
      topK: 3,
      includeMetadata: true,
      vector: embedding,
    });

    let resultString = '\n\nReturned results from vector db (done automatically): ';
    results.matches.forEach((match) => {
      resultString += `
      Professor: ${match.id}
      Review: ${match.metadata.review}
      Subject: ${match.metadata.subject}
      Stars: ${match.metadata.stars}
      \n\n
      `;
    });

    const lastMessage = data[data.length - 1];
    const lastMessageContent = lastMessage.content + resultString;
    const lastDataWithoutLastMessage = data.slice(0, -1);

    const completion = await openai.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        ...lastDataWithoutLastMessage,
        { role: 'user', content: lastMessageContent },
      ],
      model: 'gpt-4',
      stream: true,
    });

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        try {
          for await (const chunk of completion) {
            const content = chunk.choices[0]?.delta?.content;
            if (content) {
              const text = encoder.encode(content);
              controller.enqueue(text);
            }
          }
        } catch (err) {
          controller.error(err);
        } finally {
          controller.close();
        }
      },
    });

    return new NextResponse(stream);
  } catch (error) {
    return new NextResponse(error.message, { status: 500 });
  }
}
