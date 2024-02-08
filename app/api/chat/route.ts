import { kv } from '@vercel/kv'
import { Message, OpenAIStream, StreamingTextResponse } from 'ai'
import OpenAI from 'openai'

import { auth } from '@/auth'
import { nanoid } from '@/lib/utils'

import { getContext } from '@/lib/context'

export const runtime = 'edge'

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
})

export async function POST(req: Request) {
    const json = await req.json()
    const { messages, previewToken } = json
    const userId = (await auth())?.user.id

    const lastMessage = messages[messages.length - 1]

    const context = await getContext(lastMessage.content, '')

    const prompt = [
        {
            role: 'system',
        content: `You have been hired by Pointsbet to be a helpful assistant.
      Help the user with Pointsbet suppport questions and sports betting questions.
      The context below are recent support documents that you can use to solve the users question.
      Do not rely on prior knowledge unless its related to a sports betting question.
      Do not answer questions that are unrelated sports betting or Pointsbet support.
    START CONTEXT BLOCK
    ${context}
    END OF CONTEXT BLOCK
    `,
        },
    ]

    if (!userId) {
        return new Response('Unauthorized', {
            status: 401
        })
    }

    if (previewToken) {
        openai.apiKey = previewToken
    }

    const res = await openai.chat.completions.create({
        model: 'gpt-4-0125-preview',
        messages: [...prompt, ...messages.filter((message: Message) => message.role === 'user')],
        temperature: 0.7,
        stream: true
    })

    const stream = OpenAIStream(res, {
        async onCompletion(completion) {
            const title = json.messages[0].content.substring(0, 100)
            const id = json.id ?? nanoid()
            const createdAt = Date.now()
            const path = `/chat/${id}`
            const payload = {
                id,
                title,
                userId,
                createdAt,
                path,
                messages: [
                    ...messages,
                    {
                        content: completion,
                        role: 'assistant'
                    }
                ]
            }
            await kv.hmset(`chat:${id}`, payload)
            await kv.zadd(`user:chat:${userId}`, {
                score: createdAt,
                member: `chat:${id}`
            })
        }
    })

    return new StreamingTextResponse(stream)
}
