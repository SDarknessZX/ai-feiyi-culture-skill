import { readFileSync } from 'node:fs'

const templateVideoVersion = '20260813-1'
const templateVideo = (fileName) => `/templates/${fileName}?v=${templateVideoVersion}`

export const costumeEthnicItems = [
  ['ethnic-miao', '苗族'],
  ['ethnic-yi', '彝族'],
  ['ethnic-dong', '侗族'],
  ['ethnic-zang', '藏族'],
  ['ethnic-uyghur', '维吾尔族'],
  ['ethnic-mongol', '蒙古族'],
]

const costumeEthnicPromptFiles = {
  'ethnic-miao': 'miao.txt',
  'ethnic-yi': 'yi.txt',
  'ethnic-dong': 'dong.txt',
  'ethnic-zang': 'tibetan.txt',
  'ethnic-uyghur': 'uyghur.txt',
  'ethnic-mongol': 'mongolian.txt',
}

const costumeEthnicPrompts = Object.fromEntries(
  Object.entries(costumeEthnicPromptFiles).map(([id, fileName]) => [
    id,
    readFileSync(new URL(`../prompts/costume/${fileName}`, import.meta.url), 'utf8').trim(),
  ]),
)

export const costumeDynastyItems = [
  ['dynasty-song', '宋代雅韵'],
  ['dynasty-dunhuang', '敦煌飞天'],
]

const costumeDynastyPromptFiles = {
  'dynasty-song': 'song.txt',
  'dynasty-dunhuang': 'dunhuang.txt',
}

const costumeDynastyPrompts = Object.fromEntries(
  Object.entries(costumeDynastyPromptFiles).map(([id, fileName]) => [
    id,
    readFileSync(new URL(`../prompts/dynasty/${fileName}`, import.meta.url), 'utf8').trim(),
  ]),
)

export const costumeImageMap = {
  'ethnic-miao': '/templates/ethnic-miao.webp',
  'ethnic-yi': '/templates/ethnic-yi.webp',
  'ethnic-dong': '/templates/ethnic-dong.webp',
  'ethnic-zang': '/templates/ethnic-zang.webp',
  'ethnic-uyghur': '/templates/ethnic-uyghur.webp',
  'ethnic-mongol': '/templates/ethnic-mongol.webp',
  'dynasty-song': '/templates/song-jin-street.webp',
  'dynasty-dunhuang': '/templates/dunhuang-flying-silk.webp',
}

export const costumeVideoMap = {
  'ethnic-miao': templateVideo('非遗苗族.mp4'),
  'ethnic-yi': templateVideo('非遗彝族.mp4'),
  'ethnic-dong': templateVideo('非遗侗族.mp4'),
  'ethnic-zang': templateVideo('非遗藏族.mp4'),
  'ethnic-uyghur': templateVideo('非遗维吾尔族.mp4'),
  'ethnic-mongol': templateVideo('非遗蒙古族.mp4'),
  'dynasty-song': templateVideo('宋代雅韵.mp4'),
  'dynasty-dunhuang': templateVideo('敦煌飞天.mp4'),
}

// 图活非遗画作的统一提示词。修改 prompts/painting/paint.txt 后，服务会自动重启并生效。
const paintingPrompt = readFileSync(
  new URL('../prompts/painting/paint.txt', import.meta.url),
  'utf8',
).trim()
export const foodSystemPrompt = readFileSync(new URL('../prompts/food/food.txt', import.meta.url), 'utf8')

const originalitySafetyPrompt =
  '全部视觉必须为原创设计，不模仿、不复刻、不暗示任何影视、动漫、游戏、品牌、明星、网红、名人、商业角色、角色造型、海报构图或受版权保护作品；不要出现商标、品牌标识、品牌名、影视角色、动漫角色、游戏角色、知名人物脸、知名服装造型或可识别版权元素。'

const genderRequirements = {
  female:
    '最终人物必须明确为成年女性，面部结构、发型、体态、服装版型、造型和姿态均符合女性特征；不得生成男性化面孔、男性体态、胡须、喉结或男性发型。',
  male:
    '最终人物必须明确为成年男性，面部骨相、眉眼、肩颈轮廓、发型、服装版型、造型和姿态均符合男性特征；不得生成女性化面孔、女性体态、女性妆容、女性发饰、以裙装为主的女性造型或少女感。',
}

const costumeFinalPrompt =
  '可重新组织姿态、服饰和场景来完成非遗服饰短片。视频时长约 10 秒，画幅 9:16。'

export function buildCostumeReferencePrompt() {
  return [
    '图一是用户上传的人物身份参考图。必须以图一中的真实人物为唯一主角，严格保留其脸型、五官比例、眉眼、鼻子、嘴唇、肤色、年龄感和整体身份特征，不得替换成其他人物，不得生成模板脸或网红脸。',
    '保持图一人物原有的服装、发型、发色、妆容和配饰，不改变人物性别和年龄。',
    '只生成一张完整的竖版合成彩色铅笔素描写真图片，画面必须明确分成等大的5行×5列，共25个独立宫格。不能生成少于或多于25格，不能把25张图分开输出。',
    '25个宫格必须全部是图一中的同一个人，分别展示正面、左侧、右侧、背面，轻微俯视、轻微仰视以及不同自然表情。每格人物身份、性别、年龄、五官、发型和原有服装保持一致。',
    '每个宫格中的人物占画面约65%到80%，面部清晰，人物细节清楚。宫格之间边界整齐，布局规整，不出现文字、编号或品牌标识。',
    '整体为精致彩绘人物设定图，只对图一人物进行多角度整理，不进行服饰设计或换装。1024px',
    originalitySafetyPrompt,
  ].join(' ')
}

export function buildCostumeVideoPrompt({ stylePrompt, gender }) {
  return [
    genderRequirements[gender],
    stylePrompt,
    '将输入的5×5彩绘人物设定图作为视觉参考，只选择其中一套符合所选性别的原创服饰造型用于整段视频。',
    '如果参考图中的任何细节与所选性别冲突，始终以所选性别要求为最高优先级。',
    '视频必须生成完整音轨，包含与画面和所选服饰文化风格匹配的背景音乐及适量环境音，镜头、动作和转场与音乐节奏同步；遵循对应模板提示词中的具体音乐要求，不生成对白或人物说话声。',
    costumeFinalPrompt,
  ].join(' ')
}

export function buildEthnicCostumePrompt(id) {
  return costumeEthnicPrompts[id] || ''
}

export function buildDynastyCostumePrompt(id) {
  return costumeDynastyPrompts[id] || ''
}

export const paintingMotionTemplates = [
  {
    id: 'new-year-figure',
    title: '年画人物活化',
    imageUrl: '/templates/painting-new-year.webp',
    videoUrl: templateVideo('年画人物活化.mp4'),
    prompt: paintingPrompt,
  },
  {
    id: 'paper-shadow',
    title: '剪纸皮影光影',
    imageUrl: '/templates/painting-paper-shadow.webp',
    videoUrl: templateVideo('剪纸皮影光影.mp4'),
    prompt: paintingPrompt,
  },
  {
    id: 'mural-revive',
    title: '壁画复苏镜头',
    imageUrl: '/templates/painting-mural.webp',
    videoUrl: templateVideo('壁画复苏镜头.mp4'),
    prompt: paintingPrompt,
  },
]

export const foodShowcaseTemplates = {
  臊子面: [
    {
      title: '长安臊子局',
      imageUrl: '/templates/food-zongzi-town.webp',
      videoUrl: templateVideo('美食1.mp4'),
    },
  ],
  糖醋排骨: [
    {
      title: '老街酸甜局',
      imageUrl: '/templates/food-mooncake-bakery.webp',
      videoUrl: templateVideo('美食2.mp4'),
    },
  ],
  月饼: [
    {
      title: '月宫烘焙局',
      imageUrl: '/templates/food-tea-snack.webp',
      videoUrl: templateVideo('美食3.mp4'),
    },
  ],
}
