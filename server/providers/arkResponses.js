function getArkBaseUrl() {
  return (process.env.ARK_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/$/, '')
}

function getArkLlmApiKey() {
  return process.env.ARK_LLM_API_KEY || process.env.ARK_API_KEY || ''
}

function findOutputText(data) {
  if (typeof data?.output_text === 'string') return data.output_text

  for (const output of data?.output || []) {
    if (typeof output?.text === 'string') return output.text
    for (const content of output?.content || []) {
      if (typeof content?.text === 'string' && ['output_text', 'text'].includes(content.type)) {
        return content.text
      }
    }
  }

  return ''
}

function cleanGeneratedPrompt(text) {
  return text
    .trim()
    .replace(/^```(?:text|markdown)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()
}

export async function generateFoodVideoPrompt({ imageUrl, systemPrompt }) {
  const apiKey = getArkLlmApiKey()
  const model = process.env.ARK_LLM_MODEL || 'doubao-seed-2-0-mini-260428'

  if (!apiKey) {
    throw new Error('缺少 ARK_LLM_API_KEY，无法识别美食并生成视频提示词。')
  }

  const instruction = [
    systemPrompt,
    '现在请分析图一中的美食，先在内部判断美食名称、原料特征、地域文化和关键制作步骤，再严格按照以上规范生成一份可直接提交给视频生成模型的完整中文提示词。',
    '最终只输出视频生成提示词正文，不输出分析过程、说明、标题前言、Markdown代码块或额外对话。',
    '输出内容使用正向、原创描述，不包含平台名、品牌名、具体影视作品名或具体受版权保护的音乐名称。',
  ].join('\n\n')

  const response = await fetch(`${getArkBaseUrl()}/responses`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_image',
              image_url: imageUrl,
            },
            {
              type: 'input_text',
              text: instruction,
            },
          ],
        },
      ],
    }),
  })

  const raw = await response.text()
  let data
  try {
    data = raw ? JSON.parse(raw) : {}
  } catch {
    data = { raw }
  }

  if (!response.ok || data.error) {
    const detail = data?.error?.message || data?.message || data?.raw || response.statusText
    throw new Error(`Ark 美食提示词生成失败：HTTP ${response.status} ${detail}`)
  }

  const generatedPrompt = cleanGeneratedPrompt(findOutputText(data))
  if (!generatedPrompt) {
    throw new Error(`Ark 美食提示词响应里没有找到输出文本：${JSON.stringify(data)}`)
  }

  return generatedPrompt
}

export async function generateCasualChatReply({ message }) {
  const apiKey = getArkLlmApiKey()
  const model = process.env.ARK_LLM_MODEL || 'doubao-seed-2-0-mini-260428'

  if (!apiKey) {
    throw new Error('缺少 ARK_LLM_API_KEY，无法发起闲聊回复。')
  }

  const response = await fetch(`${getArkBaseUrl()}/responses`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: 'system',
          content: [
            {
              type: 'input_text',
              text:
                '你是 AI非遗文化skill 的轻量互动助手。请用自然、简短、友好的中文回答用户的非创作类闲聊，不生成视频提示词，不要求用户付费，不承诺实际抽奖或权益。回答控制在 60 字以内，可自然引导用户上传图片体验非遗短视频创作。',
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: String(message || '').slice(0, 300),
            },
          ],
        },
      ],
    }),
  })

  const raw = await response.text()
  let data
  try {
    data = raw ? JSON.parse(raw) : {}
  } catch {
    data = { raw }
  }

  if (!response.ok || data.error) {
    const detail = data?.error?.message || data?.message || data?.raw || response.statusText
    throw new Error(`Ark 闲聊回复生成失败：HTTP ${response.status} ${detail}`)
  }

  const reply = cleanGeneratedPrompt(findOutputText(data))
  if (!reply) {
    throw new Error(`Ark 闲聊响应里没有找到输出文本：${JSON.stringify(data)}`)
  }

  return reply
}
