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
    console.log(lastMessage)

    const context = await getContext(lastMessage.content, '')
    console.log(lastMessage)

    const prompt = [
        {
            role: 'system',
            content: `You have been hired by Pointsbet to be a helpful assistant. 
      You will answer questions only using the context below.
      Do not rely on prior knowledge. 
      Do not answer questions that are unrelated to the content.
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
        model: 'gpt-4',
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
