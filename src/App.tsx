import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  Bell,
  Camera,
  ChefHat,
  Check,
  Crop,
  EllipsisVertical,
  Film,
  Grid2X2,
  ImageUp,
  Images,
  Info,
  LogIn,
  Loader2,
  MessageCircle,
  Palette,
  Play,
  RefreshCw,
  ShieldCheck,
  Shirt,
  Sparkles,
  Trash2,
  Volume2,
  VolumeX,
  Wand2,
  X,
} from 'lucide-react'
import {
  trackAmberCompleteTask,
  trackAmberEnter,
  trackAmberInteract,
  trackAmberLogin,
  trackAmberPublishRingtone,
  trackAmberSubmitTask,
} from './amber'
import { advanceQingyuanPageSeq, trackQingyuanPageLoad, trackQingyuanPageStay, trackQingyuanTraceLog, trackQingyuanUserLogin } from './qingyuan'
import './App.css'

type ModeId = 'costume' | 'food' | 'painting'
type GenderId = 'female' | 'male'
type CostumeGroupId = 'ethnic' | 'dynasty'
type TaskStatus = 'queued' | 'running' | 'succeeded' | 'failed'
type AppView = 'home' | 'library' | 'chat' | 'detail'
type CropRatio = '9:16' | '1:1' | 'free'
type UploadSource = 'camera' | 'gallery'

type CreateResult = {
  taskId?: string
  code?: string
  status: TaskStatus
  mode: ModeId
  message: string
  templateTitle?: string
  previewUrl?: string
  videoUrl?: string
  posterUrl?: string
  inputImageUrl?: string
  createdAt?: number
}

type ModeDraft = {
  file: File | null
  preview: string
  result: CreateResult | null
  busy: boolean
  polling: boolean
}

// Token 计费网关开启时，整页跳转去咪咕拿 taskId 之前，先把这次创作请求存起来，跳转回来后续用
type PendingCreation = {
  mode: ModeId
  template: string
  gender: GenderId
  templateTitle: string
  imageUrl: string
}

type CreationOverrides = {
  file?: File
  preview?: string
  gender?: GenderId
  templateId?: string
  templateTitle?: string
  skipAgreement?: boolean
}

type TokenRemainInfo = {
  status?: number
  rightsCount?: number
  experienceCount?: number
  consumePointsCount?: number
  availablePointsCount?: number
}

type TemplateItem = {
  id: string
  title: string
  imageUrl: string
  videoUrl?: string
  subtitle?: string
}

type SampleImage = {
  id: string
  title: string
  imageUrl: string
  thumbnailUrl: string
}

type CostumeOption = {
  id: string
  title: string
  group: CostumeGroupId
  imageUrl?: string
  videoUrl?: string
}

type WorkItem = {
  id: string
  taskId: string
  mode: ModeId
  title: string
  message: string
  videoUrl: string
  posterUrl?: string
  createdAt: string
}

type CreationRecord = {
  id: string
  taskId?: string
  code?: string
  mode: ModeId
  status: TaskStatus
  title: string
  message: string
  videoUrl?: string
  posterUrl?: string
  createdAt: string
  source: 'work' | 'draft'
}

type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
  imageUrl?: string
  loading?: boolean
  createdAt: number
}

type ChatResultHistoryItem = {
  id: string
  mode: ModeId
  result: CreateResult
  context?: CreationContext
  createdAt: number
}

type CreationContext = {
  id: string
  messageId: string
  createdAt: number
  file: File
  preview: string
  gender?: GenderId
  templateId?: string
  templateTitle: string
}

type PosterResponse = {
  posterUrl?: string
}

type FaceDetectResponse = {
  hasFace: boolean
  faceBoundingBoxes?: number[][]
  message?: string
}

type MiguEnv = {
  isInMiguAPP: boolean
  isInMiniprogram: boolean
}

type PendingLoginAction =
  | { kind: 'upload'; returnToPanel: boolean }
  | { kind: 'template'; mode: ModeId; templateId: string }

const worksStorageKey = 'ai-yitu-zhenying-works'
const pendingStorageKey = 'ai-yitu-zhenying-pending'
const chatMessagesStorageKey = 'ai-yitu-zhenying-chat-messages-v1'
const chatHistoryStorageKey = 'ai-yitu-zhenying-chat-history-v1'
const usageAcceptedStorageKey = 'ai-yitu-zhenying-usage-accepted-202605'
const mediaPermissionStorageKey = 'ai-yitu-zhenying-media-permission'
const cameraPermissionStorageKey = 'ai-yitu-zhenying-camera-permission'
const galleryPermissionStorageKey = 'ai-yitu-zhenying-gallery-permission'
// 默认启用真实登录；仅在明确设置 VITE_BYPASS_MIGU_LOGIN=true 时进入免登录测试模式。
const temporarilyBypassMiguLogin = import.meta.env.VITE_BYPASS_MIGU_LOGIN === 'true'
const miguSessionStorageKey = 'ai-yitu-zhenying-migu-session'
const miguLoginPendingKey = 'ai-yitu-zhenying-migu-login-pending'
const miguPendingLoginActionKey = 'ai-yitu-zhenying-migu-pending-login-action'
// btoken 官方有效期 1 小时，这里留一点余量提前判过期，避免临界点上用过期 token 发请求
const miguSessionTtlMs = 55 * 60 * 1000
const pendingCreationStorageKey = 'ai-yitu-zhenying-migu-pending-creation'
const miguTaskIdPendingKey = 'ai-yitu-zhenying-migu-taskid-pending'
const serviceProviderName = import.meta.env.VITE_SERVICE_PROVIDER_NAME?.trim() || '深圳市普威德科技有限公司'
const privacyPolicyUrl =
  import.meta.env.VITE_PRIVACY_POLICY_URL?.trim() ||
  'https://passport.migu.cn/portal/privacy/protocol?sourceid=220024'

const modes = [
  {
    id: 'costume' as const,
    name: '图秀千年华裳',
    short: '民族变装',
    icon: Shirt,
    desc: '上传人物照，智能匹配民族服饰或华夏朝代造型，生成一支有音乐、有镜头、有传统风韵的竖版短片。',
    placeholder: '上传人物正脸照片，选择服饰模板',
  },
  {
    id: 'food' as const,
    name: '图萌舌尖美味',
    short: '美食萌化',
    icon: ChefHat,
    desc: '上传美食图片，AI 识别食材和风格，生成萌系制作演示短片，让地方味道动起来。',
    placeholder: '上传美食照片，生成萌系短片',
  },
  {
    id: 'painting' as const,
    name: '年画生成展示',
    short: '画作活化',
    icon: Palette,
    desc: '上传年画、壁画或剪纸等传统画作，一键生成细节动效与镜头演绎。',
    placeholder: '上传年画、剪纸或壁画，生成动态视频',
  },
]

type ModeConfig = (typeof modes)[number]

const modeLabels: Record<ModeId, string> = {
  costume: '民族变装',
  food: '美食萌化',
  painting: '画作活化',
}

const creationPromptByTemplateId: Record<string, string> = {
  'ethnic-miao': '结合图片，生成一段苗族银饰风服饰变装视频',
  'ethnic-yi': '结合图片，生成一段彝族火纹风服饰变装视频',
  'ethnic-dong': '结合图片，生成一段侗族鼓楼风服饰变装视频',
  'ethnic-zang': '结合图片，生成一段藏族雪域风服饰变装视频',
  'ethnic-uyghur': '结合图片，生成一段维吾尔族花帽风服饰变装视频',
  'ethnic-mongol': '结合图片，生成一段蒙古族草原风服饰变装视频',
  'dynasty-song': '结合图片，生成一段宋代雅韵服饰变装视频',
  'dynasty-dunhuang': '结合图片，生成一段敦煌飞天造型变装视频',
  臊子面: '结合图片，生成一段10秒Q版非遗美食微缩景观趣味讲解视频',
  糖醋排骨: '结合图片，生成一段10秒Q版非遗美食微缩景观趣味讲解视频',
  月饼: '结合图片，生成一段10秒Q版非遗美食微缩景观趣味讲解视频',
  'new-year-figure': '结合图片，生成一段喜庆年画人物活化视频',
  'paper-shadow': '结合图片，生成一段剪纸皮影光影动画视频',
  'mural-revive': '结合图片，生成一段千年壁画复苏动画视频',
}

const sampleImagesByMode: Record<ModeId, SampleImage[]> = {
  costume: [
    { id: 'costume-sample-1', title: '民族变装人物样例一', imageUrl: '/samples/person1.png', thumbnailUrl: '/samples/thumbs/person1.webp' },
    { id: 'costume-sample-2', title: '民族变装人物样例二', imageUrl: '/samples/person2.png', thumbnailUrl: '/samples/thumbs/person2.webp' },
    { id: 'costume-sample-3', title: '民族变装人物样例三', imageUrl: '/samples/person3.png', thumbnailUrl: '/samples/thumbs/person3.webp' },
  ],
  food: [
    { id: 'food-sample-1', title: '美食萌化样例一', imageUrl: '/samples/food11.png', thumbnailUrl: '/samples/thumbs/food11.webp' },
    { id: 'food-sample-2', title: '美食萌化样例二', imageUrl: '/samples/food12.png', thumbnailUrl: '/samples/thumbs/food12.webp' },
    { id: 'food-sample-3', title: '美食萌化样例三', imageUrl: '/samples/food13.png', thumbnailUrl: '/samples/thumbs/food13.webp' },
  ],
  painting: [
    { id: 'painting-sample-1', title: '画作活化年画样例一', imageUrl: '/samples/nianhua1.png', thumbnailUrl: '/samples/thumbs/nianhua1.webp' },
    { id: 'painting-sample-2', title: '画作活化年画样例二', imageUrl: '/samples/nianhua2.png', thumbnailUrl: '/samples/thumbs/nianhua2.webp' },
    { id: 'painting-sample-3', title: '画作活化年画样例三', imageUrl: '/samples/nianhua3.png', thumbnailUrl: '/samples/thumbs/nianhua3.webp' },
  ],
}

const fallbackTemplateImage = '/templates/ethnic-miao.webp'

const ethnicCostumes: CostumeOption[] = [
  { id: 'ethnic-miao', title: '苗族银饰风', group: 'ethnic', imageUrl: '/templates/ethnic-miao.webp', videoUrl: '/templates/非遗苗族.mp4' },
  { id: 'ethnic-yi', title: '彝族火纹风', group: 'ethnic', imageUrl: '/templates/ethnic-yi.webp', videoUrl: '/templates/非遗彝族.mp4' },
  { id: 'ethnic-dong', title: '侗族鼓楼风', group: 'ethnic', imageUrl: '/templates/ethnic-dong.webp', videoUrl: '/templates/非遗侗族.mp4' },
  { id: 'ethnic-zang', title: '藏族雪域风', group: 'ethnic', imageUrl: '/templates/ethnic-zang.webp', videoUrl: '/templates/非遗藏族.mp4' },
  { id: 'ethnic-uyghur', title: '维吾尔花帽风', group: 'ethnic', imageUrl: '/templates/ethnic-uyghur.webp', videoUrl: '/templates/非遗维吾尔族.mp4' },
  { id: 'ethnic-mongol', title: '蒙古草原风', group: 'ethnic', imageUrl: '/templates/ethnic-mongol.webp', videoUrl: '/templates/非遗蒙古族.mp4' },
]

const dynastyCostumes: CostumeOption[] = [
  { id: 'dynasty-song', title: '宋代雅韵', group: 'dynasty', imageUrl: '/templates/song-jin-street.webp', videoUrl: '/templates/宋代雅韵.mp4' },
  { id: 'dynasty-dunhuang', title: '敦煌飞天', group: 'dynasty', imageUrl: '/templates/dunhuang-flying-silk.webp', videoUrl: '/templates/敦煌飞天.mp4' },
]

const foodTemplates: TemplateItem[] = [
  { id: '臊子面', title: '长安臊子局', imageUrl: '/templates/food-zongzi-town.webp', videoUrl: '/templates/美食1.mp4', subtitle: '臊子面' },
  { id: '糖醋排骨', title: '老街酸甜局', imageUrl: '/templates/food-mooncake-bakery.webp', videoUrl: '/templates/美食2.mp4', subtitle: '糖醋排骨' },
  { id: '月饼', title: '月宫烘焙局', imageUrl: '/templates/food-tea-snack.webp', videoUrl: '/templates/美食3.mp4', subtitle: '月饼' },
]

const paintingStyles: TemplateItem[] = [
  { id: 'new-year-figure', title: '年画人物活化', imageUrl: '/templates/painting-new-year.webp', videoUrl: '/templates/年画人物活化.mp4', subtitle: '民俗人物动效' },
  { id: 'paper-shadow', title: '剪纸皮影光影', imageUrl: '/templates/painting-paper-shadow.webp', videoUrl: '/templates/剪纸皮影光影.mp4', subtitle: '纸影层次演绎' },
  { id: 'mural-revive', title: '壁画复苏镜头', imageUrl: '/templates/painting-mural.webp', videoUrl: '/templates/壁画复苏镜头.mp4', subtitle: '壁画细节苏醒' },
]

type TemplateData = {
  ethnic: CostumeOption[]
  dynasty: CostumeOption[]
  food: TemplateItem[]
  paintings: TemplateItem[]
}

type ApiTemplatesResponse = {
  costumeEthnic?: CostumeOption[]
  costumeDynasty?: CostumeOption[]
  paintings?: TemplateItem[]
  food?: Record<string, { title?: string; imageUrl?: string; videoUrl?: string }[]>
}

type InspirationBubble = {
  id: string
  label: string
  mode: ModeId | null
  chatTopicIndex?: number
  templateId?: string
  sampleImageId?: string
  sampleGender?: GenderId
  icon: typeof MessageCircle
}

const inspirationBubbles: InspirationBubble[] = [
  { id: 'chat-morning', label: '早上好，新的一天加油呀', mode: null, chatTopicIndex: 0, icon: MessageCircle },
  { id: 'chat-joke', label: '讲个冷笑话', mode: null, chatTopicIndex: 1, icon: MessageCircle },
  { id: 'chat-lucky-number', label: '我今天的幸运数是什么', mode: null, chatTopicIndex: 2, icon: MessageCircle },
  {
    id: 'costume-miao',
    label: '邂逅银饰璀璨的苗族风情',
    mode: 'costume',
    templateId: 'ethnic-miao',
    sampleImageId: 'costume-sample-1',
    sampleGender: 'female',
    icon: Shirt,
  },
  {
    id: 'costume-yi',
    label: '体验热情似火的彝族风情',
    mode: 'costume',
    templateId: 'ethnic-yi',
    sampleImageId: 'costume-sample-2',
    sampleGender: 'male',
    icon: Shirt,
  },
  {
    id: 'costume-dong',
    label: '聆听侗族鼓楼下的悠扬歌声',
    mode: 'costume',
    templateId: 'ethnic-dong',
    sampleImageId: 'costume-sample-3',
    sampleGender: 'female',
    icon: Shirt,
  },
  {
    id: 'costume-zang',
    label: '感受雪域圣洁的藏族风情',
    mode: 'costume',
    templateId: 'ethnic-zang',
    sampleImageId: 'costume-sample-1',
    sampleGender: 'female',
    icon: Shirt,
  },
  {
    id: 'costume-uyghur',
    label: '戴上花帽共舞维吾尔风情',
    mode: 'costume',
    templateId: 'ethnic-uyghur',
    sampleImageId: 'costume-sample-2',
    sampleGender: 'male',
    icon: Shirt,
  },
  {
    id: 'costume-mongol',
    label: '奔赴辽阔豪迈的蒙古草原',
    mode: 'costume',
    templateId: 'ethnic-mongol',
    sampleImageId: 'costume-sample-3',
    sampleGender: 'female',
    icon: Shirt,
  },
  {
    id: 'costume-song',
    label: '一秒穿越宋代雅韵',
    mode: 'costume',
    templateId: 'dynasty-song',
    sampleImageId: 'costume-sample-1',
    sampleGender: 'female',
    icon: Shirt,
  },
  {
    id: 'costume-dunhuang',
    label: '化身敦煌飞天翩然起舞',
    mode: 'costume',
    templateId: 'dynasty-dunhuang',
    sampleImageId: 'costume-sample-3',
    sampleGender: 'female',
    icon: Shirt,
  },
  {
    id: 'food-noodle',
    label: '让长安臊子面萌动起来',
    mode: 'food',
    templateId: '臊子面',
    sampleImageId: 'food-sample-1',
    icon: ChefHat,
  },
  {
    id: 'food-mooncake',
    label: '开启月宫月饼奇遇',
    mode: 'food',
    templateId: '月饼',
    sampleImageId: 'food-sample-2',
    icon: ChefHat,
  },
  {
    id: 'painting-new-year',
    label: '唤醒喜庆吉祥的年画人物',
    mode: 'painting',
    templateId: 'new-year-figure',
    sampleImageId: 'painting-sample-1',
    icon: Palette,
  },
  {
    id: 'painting-mural',
    label: '让千年壁画翩然苏醒',
    mode: 'painting',
    templateId: 'mural-revive',
    sampleImageId: 'painting-sample-3',
    icon: Palette,
  },
]

const chatTopics = [
  {
    prompt: '早上好，新的一天加油呀',
    reply: '早上好！愿你今天灵感满满、事事顺利。',
  },
  {
    prompt: '讲个冷笑话',
    reply: '什么门永远关不上？答案是球门。',
  },
  {
    prompt: '我今天的幸运数是什么',
    reply: '你今天的幸运数是 8，愿好事成双、好运发生。',
  },
]

const usageNoticeTitle = 'AI应用照片采集使用须知'

function loadPendingTasks(): Partial<Record<ModeId, CreateResult>> {
  try {
    const raw = window.localStorage.getItem(pendingStorageKey)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Partial<Record<ModeId, CreateResult>>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function loadChatMessages(): ChatMessage[] {
  try {
    const raw = window.localStorage.getItem(chatMessagesStorageKey)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Partial<ChatMessage>[]
    if (!Array.isArray(parsed)) return []
    const fallbackStamp = Date.now() - parsed.length
    return parsed
      .filter((item) => item && typeof item.id === 'string' && (item.role === 'user' || item.role === 'assistant') && typeof item.text === 'string')
      .map((item, index) => ({
        id: item.id!,
        role: item.role!,
        text: item.text!,
        imageUrl: typeof item.imageUrl === 'string' ? item.imageUrl : undefined,
        loading: Boolean(item.loading),
        createdAt: Number.isFinite(item.createdAt) ? Number(item.createdAt) : fallbackStamp + index,
      }))
      .slice(-200)
  } catch {
    return []
  }
}

function loadChatHistory(): ChatResultHistoryItem[] {
  try {
    const raw = window.localStorage.getItem(chatHistoryStorageKey)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Partial<ChatResultHistoryItem>[]
    if (!Array.isArray(parsed)) return []
    const fallbackStamp = Date.now() - parsed.length
    return parsed
      .filter(
        (item) =>
          item &&
          typeof item.id === 'string' &&
          ['costume', 'food', 'painting'].includes(String(item.mode)) &&
          item.result &&
          typeof item.result === 'object',
      )
      .map((item, index) => ({
        id: item.id!,
        mode: item.mode!,
        result: item.result as CreateResult,
        createdAt: Number.isFinite(item.createdAt) ? Number(item.createdAt) : fallbackStamp + index,
      }))
      .slice(-100)
  } catch {
    return []
  }
}

function savePendingTask(mode: ModeId, task: CreateResult) {
  const pending = loadPendingTasks()
  pending[mode] = task
  window.localStorage.setItem(pendingStorageKey, JSON.stringify(pending))
}

function clearPendingTask(mode: ModeId) {
  const pending = loadPendingTasks()
  delete pending[mode]
  window.localStorage.setItem(pendingStorageKey, JSON.stringify(pending))
}

type MiguSession = {
  btoken: string
  vuid?: string
  projectId?: string
  releaseId?: string
  watermarkId?: string
  otherSet?: string
  isMiniPublish?: string
  obtainedAt: number
}

function readMiguSession(): MiguSession | null {
  try {
    const raw = window.localStorage.getItem(miguSessionStorageKey)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<MiguSession>
    // 文档以 btoken 作为登录成功凭据；vuid 有则使用，没有也不能把成功登录误判成失败。
    if (!parsed?.btoken || !parsed?.obtainedAt) return null
    return parsed as MiguSession
  } catch {
    return null
  }
}

function hasValidMiguSession(): boolean {
  const session = readMiguSession()
  return Boolean(session && Date.now() - session.obtainedAt < miguSessionTtlMs)
}

function savePendingLoginAction(action: PendingLoginAction) {
  window.sessionStorage.setItem(miguPendingLoginActionKey, JSON.stringify(action))
}

function takePendingLoginAction(): PendingLoginAction | null {
  const raw = window.sessionStorage.getItem(miguPendingLoginActionKey)
  if (!raw) return null
  window.sessionStorage.removeItem(miguPendingLoginActionKey)
  try {
    const action = JSON.parse(raw) as PendingLoginAction
    if (action.kind === 'upload') return action
    if (action.kind === 'template' && action.mode && action.templateId) return action
  } catch {
    // 登录前保存的动作损坏时直接丢弃，避免回调后误触发创作。
  }
  return null
}

function createEmptyDraft(): ModeDraft {
  return {
    file: null,
    preview: '',
    result: null,
    busy: false,
    polling: false,
  }
}

function App() {
  const [miguEnv, setMiguEnv] = useState<MiguEnv>({ isInMiguAPP: false, isInMiniprogram: false })
  const [view, setView] = useState<AppView>('home')
  const [libraryReturnView, setLibraryReturnView] = useState<Exclude<AppView, 'library'>>('home')
  const [works, setWorks] = useState<WorkItem[]>(loadWorks)
  const [mode, setMode] = useState<ModeId>('costume')
  const [chatMode, setChatMode] = useState<ModeId>('costume')
  const [gender, setGender] = useState<GenderId | null>(null)
  const [costumeStyle, setCostumeStyle] = useState('ethnic-miao')
  const [paintingStyle, setPaintingStyle] = useState(paintingStyles[0].id)
  const [foodShowcase, setFoodShowcase] = useState('茶点')
  const [acceptedAgreement, setAcceptedAgreement] = useState(() => window.localStorage.getItem(usageAcceptedStorageKey) === 'true')
  const [isLoggedIn, setIsLoggedIn] = useState(() => {
    const search = new URLSearchParams(window.location.search)
    if (search.get('btoken')) return true
    if (hasValidMiguSession()) return true
    return false
  })
  const [tokenGatingEnabled, setTokenGatingEnabled] = useState(false)
  const [tokenGatingReady, setTokenGatingReady] = useState(temporarilyBypassMiguLogin)
  const [tokenGatingLoadFailed, setTokenGatingLoadFailed] = useState(false)
  const [tokenRemain, setTokenRemain] = useState<TokenRemainInfo | null>(null)
  const [showInfo, setShowInfo] = useState(false)
  const [showBalanceDetail, setShowBalanceDetail] = useState(false)
  const [showLoginDialog, setShowLoginDialog] = useState(false)
  const [showUsageNotice, setShowUsageNotice] = useState(false)
  const [showMediaSourceSheet, setShowMediaSourceSheet] = useState(false)
  const [showPermissionDialog, setShowPermissionDialog] = useState(false)
  const [showCreationPanel, setShowCreationPanel] = useState(false)
  const [showQuickComposer, setShowQuickComposer] = useState(true)
  const [showCropSheet, setShowCropSheet] = useState(false)
  const [previewImageUrl, setPreviewImageUrl] = useState('')
  const [uploadFlowPending, setUploadFlowPending] = useState(false)
  const [uploadSource, setUploadSource] = useState<UploadSource>('gallery')
  const [cameraPermissionGranted, setCameraPermissionGranted] = useState(
    () =>
      window.localStorage.getItem(cameraPermissionStorageKey) === 'true' ||
      window.localStorage.getItem(mediaPermissionStorageKey) === 'true',
  )
  const [galleryPermissionGranted, setGalleryPermissionGranted] = useState(
    () =>
      window.localStorage.getItem(galleryPermissionStorageKey) === 'true' ||
      window.localStorage.getItem(mediaPermissionStorageKey) === 'true',
  )
  const [imageReviewing, setImageReviewing] = useState(false)
  const [faceReviewing, setFaceReviewing] = useState(false)
  const [cropRatio, setCropRatio] = useState<CropRatio>('9:16')
  const [toast, setToast] = useState('')
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(loadChatMessages)
  const [chatResultHistory, setChatResultHistory] = useState<ChatResultHistoryItem[]>(loadChatHistory)
  const [drafts, setDrafts] = useState<Record<ModeId, ModeDraft>>(() => ({
    costume: createEmptyDraft(),
    food: createEmptyDraft(),
    painting: createEmptyDraft(),
  }))
  const [templates, setTemplates] = useState<TemplateData>({
    ethnic: ethnicCostumes,
    dynasty: dynastyCostumes,
    food: foodTemplates,
    paintings: paintingStyles,
  })
  const fileRef = useRef<HTMLInputElement>(null)
  const resumeRef = useRef(false)
  const returnToCreationPanelRef = useRef(false)
  const publishRedirectingRef = useRef(false)
  const activeCreationContextRef = useRef<Partial<Record<ModeId, CreationContext>>>({})
  const creationStartingRef = useRef(false)
  const pollingTaskIdsRef = useRef(new Set<string>())
  // 咱们的 jobId -> 咪咕 taskId，创作完成事件上报要用，跨 pollTask 的多轮请求持续存在
  const miguTaskIdByJobRef = useRef<Record<string, string>>({})

  const activeMode = useMemo(() => modes.find((item) => item.id === mode)!, [mode])
  const usesIOSPermissionDialog = useMemo(
    () =>
      /iphone|ipad|ipod|mobilemusic/i.test(window.navigator.userAgent) ||
      (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1),
    [],
  )
  const visibleTemplates = useMemo(() => getVisibleTemplates(mode, templates), [mode, templates])
  const selectedTemplate = useMemo(() => {
    const selectedId = mode === 'costume' ? costumeStyle : mode === 'food' ? foodShowcase : paintingStyle
    return visibleTemplates.find((item) => item.id === selectedId) || visibleTemplates[0]
  }, [costumeStyle, foodShowcase, mode, paintingStyle, visibleTemplates])
  const { file, preview, busy } = drafts[mode]
  const hasRunningTask = Object.values(drafts).some(
    (draft) => draft.busy || draft.polling || draft.result?.status === 'queued' || draft.result?.status === 'running',
  )
  const chatResult = drafts[chatMode].result
  const chatVideoUrl = chatResult?.videoUrl || chatResult?.previewUrl
  const visibleBalance = tokenRemain?.availablePointsCount ?? tokenRemain?.experienceCount ?? (temporarilyBypassMiguLogin ? 430 : '--')

  useEffect(() => {
    const ua = window.navigator.userAgent.toLowerCase()
    const isIOS = /mobilemusic/.test(ua)
    const isAndroid = Boolean((window as unknown as { migumusicjs?: unknown }).migumusicjs)
    const isHarmony = /harmonymusic/.test(ua)
    const isInMiguAPP = isIOS || isAndroid || isHarmony
    const isInMiniprogram = /miniprogram/.test(ua)
    setMiguEnv({ isInMiguAPP, isInMiniprogram })

    if (isInMiguAPP && !new URLSearchParams(window.location.search).has('hideMiniPlayer')) {
      const nextUrl = new URL(window.location.href)
      nextUrl.searchParams.set('hideMiniPlayer', '1')
      window.history.replaceState(null, '', nextUrl.toString())
    }
  }, [])

  function updateDraft(targetMode: ModeId, nextDraft: Partial<ModeDraft>) {
    setDrafts((currentDrafts) => ({
      ...currentDrafts,
      [targetMode]: {
        ...currentDrafts[targetMode],
        ...nextDraft,
      },
    }))
  }

  async function chooseSampleImage(targetMode: ModeId, sample: SampleImage): Promise<File | null> {
    try {
      const response = await fetch(sample.imageUrl, { cache: 'force-cache' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const blob = await response.blob()
      const fileType = blob.type || 'image/webp'
      const extension = fileType.includes('png') ? 'png' : fileType.includes('jpeg') ? 'jpg' : 'webp'
      const sampleFile = new File([blob], `${sample.id}.${extension}`, { type: fileType })
      updateDraft(targetMode, {
        file: sampleFile,
        preview: sample.imageUrl,
      })
      return sampleFile
    } catch {
      setToast('样例图片加载失败，请重试')
      return null
    }
  }

  useEffect(() => {
    window.localStorage.setItem(worksStorageKey, JSON.stringify(works))
  }, [works])

  useEffect(() => {
    window.localStorage.setItem(chatMessagesStorageKey, JSON.stringify(chatMessages.filter((item) => !item.loading)))
  }, [chatMessages])

  useEffect(() => {
    const serializableHistory = chatResultHistory.map(({ context: _context, ...item }) => item)
    window.localStorage.setItem(chatHistoryStorageKey, JSON.stringify(serializableHistory))
  }, [chatResultHistory])

  useEffect(() => {
    const terminalResults = Object.entries(drafts).flatMap(([draftMode, draft]) => {
      const result = draft.result
      if (!result || !['succeeded', 'failed'].includes(result.status)) return []
      const context = activeCreationContextRef.current[draftMode as ModeId]
      const id = result.taskId || context?.id || `${draftMode}-${result.createdAt || Date.now()}`
      return [{
        id,
        mode: draftMode as ModeId,
        result,
        context,
        createdAt: result.createdAt || context?.createdAt || Date.now(),
      }]
    })
    if (!terminalResults.length) return
    setChatResultHistory((current) => {
      const existingIds = new Set(current.map((item) => item.id))
      const additions = terminalResults.filter((item) => !existingIds.has(item.id))
      return additions.length ? [...current, ...additions].slice(-100) : current
    })
  }, [drafts])

  useEffect(() => {
    const worksNeedingPosters = works.filter((item) => item.videoUrl && !item.posterUrl && item.taskId).slice(0, 4)
    if (!worksNeedingPosters.length) return

    let cancelled = false
    void (async () => {
      const posterEntries = await Promise.all(
        worksNeedingPosters.map(async (item) => {
          const posterUrl = await fetchWorkPoster(item)
          return posterUrl ? { id: item.id, posterUrl } : null
        }),
      )

      if (cancelled) return
      const posterMap = new Map(
        posterEntries
          .filter((entry): entry is { id: string; posterUrl: string } => Boolean(entry?.posterUrl))
          .map((entry) => [entry.id, entry.posterUrl]),
      )
      if (!posterMap.size) return

      setWorks((currentWorks) =>
        currentWorks.map((item) => {
          const posterUrl = posterMap.get(item.id)
          return posterUrl ? { ...item, posterUrl } : item
        }),
      )
    })()

    return () => {
      cancelled = true
    }
  }, [works])

  useEffect(() => {
    window.localStorage.setItem(usageAcceptedStorageKey, String(acceptedAgreement))
  }, [acceptedAgreement])

  useEffect(() => {
    window.localStorage.setItem(cameraPermissionStorageKey, String(cameraPermissionGranted))
  }, [cameraPermissionGranted])

  useEffect(() => {
    window.localStorage.setItem(galleryPermissionStorageKey, String(galleryPermissionGranted))
  }, [galleryPermissionGranted])

  // 咪咕登录回调：cToken 由服务端调接口现取现用，不会出现在我们的 URL 里，
  // 这里只处理登录回调带回来的 btoken+vuid。没有 btoken 就是登录失败——用 sessionStorage
  // 标记"刚发起过登录跳转"，回来后据此判断成功/失败。
  useEffect(() => {
    const search = new URLSearchParams(window.location.search)
    const btoken = search.get('btoken')
    const vuid = search.get('vuid')
    const loginToken = search.get('token')
    const projectId = search.get('projectId')
    const releaseId = search.get('releaseId')
    const watermarkId = search.get('watermarkId')
    const otherSet = search.get('otherSet')
    const isMiniPublish = search.get('isMiniPublish')
    const loginWasPending = window.sessionStorage.getItem(miguLoginPendingKey) === '1'
    if (!btoken && !vuid && !loginToken && !loginWasPending) return

    // URL 登录先回传一次性 token；再交给 AIGC 登录页换取最终的 btoken/vuid。
    if (loginToken && !btoken) {
      search.delete('token')
      const nextQuery = search.toString()
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}${window.location.hash}`,
      )
      if (!loginWasPending) return

      void (async () => {
        try {
          const response = await fetch(`/api/migu/aigc-login-url?token=${encodeURIComponent(loginToken)}`)
          const data = (await response.json()) as { url?: string; message?: string }
          if (response.ok && data.url) {
            window.location.replace(data.url)
            return
          }
          setToast(data.message || '无法继续咪咕登录，请重试')
        } catch {
          setToast('无法连接登录服务，请重试')
        }
        window.sessionStorage.removeItem(miguLoginPendingKey)
        window.sessionStorage.removeItem(miguPendingLoginActionKey)
        trackAmberLogin('fail')
        trackQingyuanUserLogin('fail', {
          isInMiguApp: miguEnv.isInMiguAPP,
          isInMiniprogram: miguEnv.isInMiniprogram,
        })
      })()
      return
    }

    if (loginWasPending) {
      window.sessionStorage.removeItem(miguLoginPendingKey)
    }
    if (btoken) {
      window.localStorage.setItem(
        miguSessionStorageKey,
        JSON.stringify({
          btoken,
          ...(vuid ? { vuid } : {}),
          ...(projectId ? { projectId } : {}),
          ...(releaseId ? { releaseId } : {}),
          ...(watermarkId ? { watermarkId } : {}),
          ...(otherSet ? { otherSet } : {}),
          ...(isMiniPublish ? { isMiniPublish } : {}),
          obtainedAt: Date.now(),
        }),
      )
      setIsLoggedIn(true)
      if (loginWasPending) {
        trackAmberLogin('success', vuid || undefined)
        trackQingyuanUserLogin('success', { isInMiguApp: miguEnv.isInMiguAPP, isInMiniprogram: miguEnv.isInMiniprogram })
      }
    } else if (loginWasPending) {
      window.sessionStorage.removeItem(miguPendingLoginActionKey)
      setToast('登录失败，请重试')
      trackAmberLogin('fail')
      trackQingyuanUserLogin('fail', { isInMiguApp: miguEnv.isInMiguAPP, isInMiniprogram: miguEnv.isInMiniprogram })
    }

    search.delete('btoken')
    search.delete('vuid')
    search.delete('token')
    search.delete('projectId')
    search.delete('releaseId')
    search.delete('watermarkId')
    search.delete('otherSet')
    search.delete('isMiniPublish')
    const nextQuery = search.toString()
    window.history.replaceState(null, '', `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}${window.location.hash}`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 登录页整页回跳后，自动续接用户登录前发起的上传或“做同款”动作。
  useEffect(() => {
    if (!isLoggedIn) return
    const action = takePendingLoginAction()
    if (!action) return

    if (action.kind === 'upload') {
      returnToCreationPanelRef.current = action.returnToPanel
      setUploadFlowPending(true)
      if (!acceptedAgreement) setShowUsageNotice(true)
      else setShowMediaSourceSheet(true)
      return
    }

    const template = getVisibleTemplates(action.mode, templates).find((item) => item.id === action.templateId)
    if (!template) {
      setToast('原模板已更新，请重新选择后创作')
      return
    }
    void createFromTemplate(template, action.mode)
    // 仅在登录态由 false 变为 true 时消费一次待续接动作。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn])

  // 从"获取 taskId 页面"跳转回来：URL 带 taskId（或失败态），配合 sessionStorage 里存的待提交创作请求续上流程
  useEffect(() => {
    const search = new URLSearchParams(window.location.search)
    const taskId = search.get('taskId')
    const resumeCode = search.get('resumeCode')
    const code = search.get('code')
    const callbackInfo = search.get('info')
    const taskIdWasPending = window.sessionStorage.getItem(miguTaskIdPendingKey) === '1'
    if (!taskId && !resumeCode && !code && !taskIdWasPending) return

    window.sessionStorage.removeItem(miguTaskIdPendingKey)
    search.delete('taskId')
    search.delete('resumeCode')
    search.delete('code')
    search.delete('info')
    const nextQuery = search.toString()
    window.history.replaceState(null, '', `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}${window.location.hash}`)

    const pendingRaw = window.sessionStorage.getItem(pendingCreationStorageKey)
    window.sessionStorage.removeItem(pendingCreationStorageKey)
    const session = readMiguSession()

    if (code === '200002') {
      setToast(callbackInfo || '渠道校验失败，请联系咪咕确认渠道配置')
      return
    }
    // code=200001 返回的是上一项仍在执行/结算的 taskId，不是本次创作的新 taskId。
    // 复用它再次预扣一定会失败，也会把本次素材错误绑定到旧任务，因此这里明确终止本次续接。
    if (code === '200001') {
      try {
        const pending = pendingRaw ? (JSON.parse(pendingRaw) as PendingCreation) : null
        if (pending) {
          setMode(pending.mode)
          setChatMode(pending.mode)
          setView('chat')
          updateDraft(pending.mode, {
            busy: false,
            result: {
              status: 'failed',
              code: 'MIGU_TASK_ALREADY_RUNNING',
              mode: pending.mode,
              message: callbackInfo || '上一项创作仍在执行或结算中，请稍后再发起。',
            },
          })
        }
      } catch {
        // 待续接数据损坏时仅展示统一提示。
      }
      setToast(callbackInfo || '上一项创作仍在执行或结算中，请稍后再试')
      return
    }
    const taskIdSucceeded = Boolean(taskId) && resumeCode === '3'
    if (!taskIdSucceeded) {
      if (resumeCode === '4') setToast(callbackInfo || '获取 taskId 失败，请重试')
      else if (taskIdWasPending) setToast(callbackInfo || '获取创作资格失败，请重试')
      return
    }
    if (!taskId || !pendingRaw || !session?.btoken) {
      if (taskIdWasPending) setToast(callbackInfo || '获取创作资格失败，请重试')
      return
    }

    try {
      const pending = JSON.parse(pendingRaw) as PendingCreation
      void resumeTokenGatedCreation(taskId, session.btoken, pending)
    } catch {
      setToast('创作请求已过期，请重新发起')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 2200)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const response = await fetch('/api/templates')
        if (!response.ok) return
        const data = (await response.json()) as ApiTemplatesResponse
        if (cancelled) return
        setTemplates((current) => ({
          ethnic: data.costumeEthnic?.length ? normalizeCostumeTitles(data.costumeEthnic) : current.ethnic,
          dynasty: data.costumeDynasty?.length ? normalizeCostumeTitles(data.costumeDynasty) : current.dynasty,
          paintings: data.paintings?.length ? data.paintings : current.paintings,
          food:
            data.food && Object.keys(data.food).length
              ? Object.entries(data.food).map(([id, items]) => ({
                  id,
                  title: items[0]?.title || id,
                  imageUrl: items[0]?.imageUrl || fallbackTemplateImage,
                  videoUrl: items[0]?.videoUrl,
                  subtitle: '美食故事模板',
                }))
              : current.food,
        }))
      } catch {
        // 服务未启动时保留内置模板。
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (resumeRef.current) return
    resumeRef.current = true
    const pendingEntries = Object.entries(loadPendingTasks()) as [ModeId, CreateResult][]
    for (const [pendingMode, task] of pendingEntries) {
      if (!task?.taskId) {
        clearPendingTask(pendingMode)
        continue
      }
      updateDraft(pendingMode, { result: task })
      void pollTask(task, pendingMode)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    trackAmberEnter(readMiguSession()?.vuid)

    const loadTime = typeof performance !== 'undefined' ? performance.now() : 0
    const pageContext = { isInMiguApp: miguEnv.isInMiguAPP, isInMiniprogram: miguEnv.isInMiniprogram }
    trackQingyuanPageLoad(loadTime, pageContext)

    const enteredAt = Date.now()
    let stayReported = false
    const reportStay = () => {
      if (stayReported) return
      stayReported = true
      trackQingyuanPageStay(Date.now() - enteredAt, pageContext)
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') reportStay()
    }
    window.addEventListener('pagehide', reportStay)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      window.removeEventListener('pagehide', reportStay)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 用 view 切换近似表示 SPA 内的"页面跳转"，驱动 qingyuan 埋点的 pageSeq 累加
  const previousViewRef = useRef(view)
  useEffect(() => {
    if (previousViewRef.current !== view) {
      advanceQingyuanPageSeq()
      previousViewRef.current = view
    }
  }, [view])

  useEffect(() => {
    // TEMP: 测试期间不启用依赖登录态的 Token 计费链路，创作会走原有直连接口。
    if (temporarilyBypassMiguLogin) {
      setTokenGatingEnabled(false)
      setTokenGatingReady(true)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const response = await fetch('/api/migu/token-gating')
        const data = (await response.json()) as { enabled?: boolean }
        if (!cancelled) setTokenGatingEnabled(Boolean(data.enabled))
      } catch {
        if (!cancelled) {
          setTokenGatingLoadFailed(true)
          setToast('创作服务初始化失败，请刷新页面重试')
        }
      } finally {
        if (!cancelled) setTokenGatingReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Token 网关开启且已通过真实咪咕登录时，查询当前玩法的分贝余量，展示在顶部角标上
  useEffect(() => {
    if (!tokenGatingEnabled) {
      setTokenRemain(null)
      return
    }
    const session = readMiguSession()
    if (!session?.btoken) {
      setTokenRemain(null)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const response = await fetch('/api/migu/token/remain', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ otoken: session.btoken, mode }),
        })
        if (!response.ok) return
        const data = (await response.json()) as TokenRemainInfo
        if (!cancelled) setTokenRemain(data)
      } catch {
        // 保留上一次查到的值，不打断使用
      }
    })()
    return () => {
      cancelled = true
    }
  }, [tokenGatingEnabled, mode, isLoggedIn])

  function saveWork(nextResult: CreateResult) {
    const nextVideoUrl = nextResult.videoUrl || nextResult.previewUrl
    const { taskId } = nextResult
    if (!nextVideoUrl || !taskId || nextResult.status !== 'succeeded') return

    setWorks((currentWorks) => {
      if (currentWorks.some((item) => item.taskId === taskId)) return currentWorks
      return [
        {
          id: `work-${taskId}`,
          taskId,
          mode: nextResult.mode,
          title: nextResult.templateTitle || modeLabels[nextResult.mode],
          message: nextResult.message,
          videoUrl: nextVideoUrl,
          posterUrl: nextResult.posterUrl,
          createdAt: new Date().toISOString(),
        },
        ...currentWorks,
      ]
    })
  }

  function deleteWork(id: string) {
    setWorks((currentWorks) => currentWorks.filter((item) => item.id !== id))
  }

  function clearDraftResult(targetMode: ModeId) {
    updateDraft(targetMode, { result: null, busy: false, polling: false })
    clearPendingTask(targetMode)
  }

  function chooseMode(nextMode: ModeId) {
    setMode(nextMode)
    setShowQuickComposer(true)
    setView('home')
  }

  function returnHome() {
    setShowQuickComposer(true)
    setView('home')
  }

  function openLibrary() {
    if (view !== 'library') setLibraryReturnView(view)
    setView('library')
  }

  function leaveLibrary() {
    setView(libraryReturnView)
  }

  function chooseTemplate(templateId: string) {
    if (mode === 'costume') setCostumeStyle(templateId)
    if (mode === 'food') setFoodShowcase(templateId)
    if (mode === 'painting') setPaintingStyle(templateId)
  }

  function selectTemplateForMode(targetMode: ModeId, templateId: string) {
    if (targetMode === 'costume') setCostumeStyle(templateId)
    if (targetMode === 'food') setFoodShowcase(templateId)
    if (targetMode === 'painting') setPaintingStyle(templateId)
  }

  function getTemplatePreset(targetMode: ModeId, templateId: string) {
    const configured = inspirationBubbles.find((item) => item.mode === targetMode && item.templateId === templateId)
    const targetTemplates = getVisibleTemplates(targetMode, templates)
    const templateIndex = Math.max(0, targetTemplates.findIndex((item) => item.id === templateId))
    const samples = sampleImagesByMode[targetMode]
    return {
      sample: samples.find((item) => item.id === configured?.sampleImageId) || samples[templateIndex % samples.length] || samples[0],
      gender: configured?.sampleGender || (targetMode === 'costume' ? ('female' as const) : undefined),
    }
  }

  async function createFromTemplate(template: TemplateItem, targetMode: ModeId = mode) {
    // 登录、权益、并发校验严格按产品顺序执行。
    if (!temporarilyBypassMiguLogin && !isLoggedIn) {
      savePendingLoginAction({ kind: 'template', mode: targetMode, templateId: template.id })
      setShowLoginDialog(true)
      return
    }
    if (hasRunningTask) {
      setToast('已有1项任务制作中，稍后再创作哦～可到我的作品页查看进度')
      return
    }

    selectTemplateForMode(targetMode, template.id)
    setMode(targetMode)
    setChatMode(targetMode)
    const preset = getTemplatePreset(targetMode, template.id)
    const sampleFile = await chooseSampleImage(targetMode, preset.sample)
    if (!sampleFile) return
    if (preset.gender) setGender(preset.gender)
    await createVideo(targetMode, {
      file: sampleFile,
      preview: preset.sample.imageUrl,
      gender: preset.gender,
      templateId: template.id,
      templateTitle: template.title,
      skipAgreement: true,
    })
  }

  function choosePanelTemplate(templateId: string) {
    chooseTemplate(templateId)
    const preset = getTemplatePreset(mode, templateId)
    const currentPreviewIsSample = sampleImagesByMode[mode].some((item) => item.imageUrl === drafts[mode].preview)
    if (!drafts[mode].file || currentPreviewIsSample) void chooseSampleImage(mode, preset.sample)
  }

  function choosePanelMode(nextMode: ModeId) {
    setMode(nextMode)
    const targetTemplates = getVisibleTemplates(nextMode, templates)
    const selectedId = nextMode === 'costume' ? costumeStyle : nextMode === 'food' ? foodShowcase : paintingStyle
    const targetTemplate = targetTemplates.find((item) => item.id === selectedId) || targetTemplates[0]
    if (!targetTemplate) return
    const preset = getTemplatePreset(nextMode, targetTemplate.id)
    const currentPreviewIsSample = sampleImagesByMode[nextMode].some((item) => item.imageUrl === drafts[nextMode].preview)
    if (!drafts[nextMode].file || currentPreviewIsSample) void chooseSampleImage(nextMode, preset.sample)
  }

  function closeUploadOverlays() {
    setShowLoginDialog(false)
    setShowUsageNotice(false)
    setShowMediaSourceSheet(false)
    setShowPermissionDialog(false)
    setShowCropSheet(false)
  }

  function restorePreviousPanel() {
    closeUploadOverlays()
    setUploadFlowPending(false)
    if (returnToCreationPanelRef.current) {
      window.setTimeout(() => setShowCreationPanel(true), 120)
    }
  }

  function openMediaSourceChooser() {
    closeUploadOverlays()
    window.setTimeout(() => setShowMediaSourceSheet(true), 120)
  }

  function requestUpload() {
    returnToCreationPanelRef.current = returnToCreationPanelRef.current || showCreationPanel
    setUploadFlowPending(true)
    setShowCreationPanel(false)
    setPreviewImageUrl('')
    closeUploadOverlays()

    if (!temporarilyBypassMiguLogin && !isLoggedIn) {
      savePendingLoginAction({ kind: 'upload', returnToPanel: returnToCreationPanelRef.current })
      setShowLoginDialog(true)
      return
    }
    if (!acceptedAgreement) {
      setShowUsageNotice(true)
      return
    }
    setShowMediaSourceSheet(true)
  }

  function confirmLogin() {
    // 点击动作内先进入同源后端，再由服务端 302 到咪咕，避免部分移动端 WebView
    // 拦截 fetch 完成后的异步跨域导航。cToken 始终只存在于服务端生成的跳转地址中。
    window.sessionStorage.setItem(miguLoginPendingKey, '1')
    window.location.assign(`/api/migu/login-redirect?_=${Date.now()}`)
  }

  async function openUsageDetail() {
    const session = readMiguSession()
    if (!session?.btoken) {
      setToast('请先登录咪咕账号后查看')
      return
    }
    try {
      const response = await fetch(`/api/migu/usage-detail-url?token=${encodeURIComponent(session.btoken)}`)
      const data = (await response.json()) as { url?: string; message?: string }
      if (response.ok && data.url) {
        window.open(data.url, '_blank', 'noopener,noreferrer')
        return
      }
      setToast(data.message || '暂时无法打开使用明细')
    } catch {
      setToast('无法连接本地服务，请稍后重试')
    }
  }

  function closeLoginDialog() {
    trackAmberLogin('cancel')
    window.sessionStorage.removeItem(miguPendingLoginActionKey)
    setShowLoginDialog(false)
    restorePreviousPanel()
  }

  function confirmUsageNotice() {
    setAcceptedAgreement(true)
    setShowUsageNotice(false)
    if (uploadFlowPending) {
      openMediaSourceChooser()
      return
    }
    restorePreviousPanel()
  }

  function chooseMediaSource(source: UploadSource) {
    setUploadSource(source)
    setShowMediaSourceSheet(false)
    window.setTimeout(() => setShowPermissionDialog(true), 120)
  }

  function closeMediaSourceSheet() {
    setShowMediaSourceSheet(false)
    restorePreviousPanel()
  }

  async function confirmMediaPermission() {
    if (uploadSource === 'camera' && navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true })
        stream.getTracks().forEach((track) => track.stop())
      } catch (error) {
        const denied = error instanceof DOMException && ['NotAllowedError', 'PermissionDeniedError'].includes(error.name)
        setToast(denied ? '相机权限未开启，请在系统设置中允许后重试' : '无法调用相机，请改用相册上传')
        return
      }
    }

    const jointPermission = !miguEnv.isInMiguAPP || miguEnv.isInMiniprogram
    if (jointPermission) {
      setCameraPermissionGranted(true)
      setGalleryPermissionGranted(true)
    } else if (uploadSource === 'camera') {
      setCameraPermissionGranted(true)
    } else {
      setGalleryPermissionGranted(true)
    }
    setShowPermissionDialog(false)
    if (uploadFlowPending) window.setTimeout(() => fileRef.current?.click(), 120)
  }

  function closeUsageNotice() {
    setShowUsageNotice(false)
    restorePreviousPanel()
  }

  function closePermissionDialog() {
    setShowPermissionDialog(false)
    restorePreviousPanel()
  }

  async function reviewImage(nextFile: File) {
    if (!nextFile.type.startsWith('image/') || nextFile.size > 12 * 1024 * 1024) return false
    const objectUrl = URL.createObjectURL(nextFile)
    try {
      const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
        const image = new Image()
        image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
        image.onerror = reject
        image.src = objectUrl
      })
      return dimensions.width >= 160 && dimensions.height >= 160
    } catch {
      return false
    } finally {
      URL.revokeObjectURL(objectUrl)
    }
  }

  async function chooseFile(nextFile?: File) {
    if (!nextFile) {
      restorePreviousPanel()
      return
    }

    setImageReviewing(true)
    setShowCreationPanel(false)
    closeUploadOverlays()
    const reviewPassed = await reviewImage(nextFile)
    await wait(350)
    setImageReviewing(false)

    if (!reviewPassed) {
      setToast('审核不通过，请重新上传')
      restorePreviousPanel()
      return
    }

    updateDraft(mode, {
      file: nextFile,
      preview: URL.createObjectURL(nextFile),
    })
    setUploadFlowPending(false)
    setCropRatio('9:16')
    setShowCropSheet(true)
  }

  async function validateFace(nextFile: File) {
    const formData = new FormData()
    formData.append('image', nextFile)
    const response = await fetch('/api/face-detect', {
      method: 'POST',
      body: formData,
    })
    const data = (await response.json().catch(() => ({
      hasFace: false,
      message: `人脸检测服务返回异常响应（HTTP ${response.status}）。`,
    }))) as FaceDetectResponse
    if (!response.ok) throw new Error(data.message || '人脸检测服务暂不可用，请稍后重试。')
    return data
  }

  async function finishCropAndCreate(croppedFile: File) {
    if (!file) {
      setToast('请重新上传图片')
      restorePreviousPanel()
      return
    }

    const croppedPreview = URL.createObjectURL(croppedFile)
    updateDraft(mode, { file: croppedFile, preview: croppedPreview })
    setShowCropSheet(false)
    if (mode === 'costume') {
      setFaceReviewing(true)
      try {
        const faceResult = await validateFace(croppedFile)
        if (!faceResult.hasFace) {
          setToast(faceResult.message || '未检测到清晰人脸，请重新上传')
          restorePreviousPanel()
          return
        }
      } catch (error) {
        setToast(error instanceof Error ? error.message : '人脸检测服务暂不可用，请稍后重试')
        restorePreviousPanel()
        return
      } finally {
        setFaceReviewing(false)
      }
    }

    returnToCreationPanelRef.current = false
    setToast(mode === 'costume' ? '人脸校验通过，正在发起创作' : '图片校验通过，正在发起创作')
    void createVideo(mode, { file: croppedFile, preview: croppedPreview })
  }

  function removeUploadedImage() {
    updateDraft(mode, {
      file: null,
      preview: '',
    })
    setPreviewImageUrl('')
  }

  async function handleBubbleClick(item: InspirationBubble) {
    if (!item.mode) {
      const topic = typeof item.chatTopicIndex === 'number' ? chatTopics[item.chatTopicIndex] : undefined
      startNonCreativeChat(topic)
      return
    }

    if (!temporarilyBypassMiguLogin && !isLoggedIn) {
      const templateId = item.templateId || getVisibleTemplates(item.mode, templates)[0]?.id
      if (templateId) savePendingLoginAction({ kind: 'template', mode: item.mode, templateId })
      setShowLoginDialog(true)
      return
    }
    if (hasRunningTask) {
      setToast('已有1项任务制作中，稍后再创作哦～可到我的作品页查看进度')
      return
    }

    if (item.mode === 'costume') {
      if (item.templateId) setCostumeStyle(item.templateId)
    }
    if (item.mode === 'food' && item.templateId) setFoodShowcase(item.templateId)
    if (item.mode === 'painting' && item.templateId) setPaintingStyle(item.templateId)

    const targetMode = item.mode
    setMode(targetMode)
    setChatMode(targetMode)
    setView('chat')

    const sample =
      sampleImagesByMode[targetMode].find((sampleItem) => sampleItem.id === item.sampleImageId) || sampleImagesByMode[targetMode][0]
    const sampleFile = await chooseSampleImage(targetMode, sample)
    if (!sampleFile) return

    if (item.sampleGender) setGender(item.sampleGender)
    const bubbleTemplate = getVisibleTemplates(targetMode, templates).find((template) => template.id === item.templateId)
    void createVideo(targetMode, {
      file: sampleFile,
      preview: sample.imageUrl,
      gender: item.sampleGender,
      templateId: item.templateId,
      templateTitle: bubbleTemplate?.title,
      skipAgreement: true,
    })
  }

  function startNonCreativeChat(topic?: (typeof chatTopics)[number]) {
    setShowQuickComposer(true)
    if (topic) {
      const stamp = Date.now()
      trackAmberInteract(readMiguSession()?.vuid)
      reportChatInteraction(topic.prompt)
      setChatMessages((current) => [
        ...current.filter((item) => !item.loading),
        { id: `user-topic-${stamp}`, role: 'user', text: topic.prompt, createdAt: stamp },
        { id: `assistant-topic-${stamp}`, role: 'assistant', text: topic.reply, createdAt: stamp + 1 },
      ])
      setView('chat')
      return
    }
    setChatMessages((current) =>
      current.length
        ? current
        : [{ id: `assistant-${Date.now()}`, role: 'assistant', text: '想聊点什么？我在这里。', createdAt: Date.now() }],
    )
    setView('chat')
  }

  // 用户交互行为上报接口：现在聊天入口都是 chatTopics 里的固定预设文案（"快捷输入"），
  // 属于文档里"安全的预设文本"，可以不经过机审直接上报；不阻塞聊天体验，失败就算了。
  function reportChatInteraction(ans: string) {
    if (!tokenGatingEnabled) return
    const session = readMiguSession()
    if (!session?.btoken) return
    void fetch('/api/migu/token/interact', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ otoken: session.btoken, ans, ansBy: 'shortcut' }),
    }).catch(() => {})
  }

  function shuffleTemplates() {
    const list = visibleTemplates
    if (!list.length) return
    const selectedIndex = list.findIndex((item) => item.id === selectedTemplate?.id)
    if (selectedIndex >= 0 && selectedIndex < list.length - 1) {
      chooseTemplate(list[selectedIndex + 1].id)
      return
    }
    const modeIndex = modes.findIndex((item) => item.id === mode)
    const nextMode = modes[(modeIndex + 1) % modes.length].id
    const nextTemplates = getVisibleTemplates(nextMode, templates)
    if (!nextTemplates.length) return
    setMode(nextMode)
    selectTemplateForMode(nextMode, nextTemplates[0].id)
  }

  function openTemplateDetail(template: TemplateItem) {
    chooseTemplate(template.id)
    setView('detail')
  }

  function useSameTemplate() {
    if (selectedTemplate) void createFromTemplate(selectedTemplate)
  }

  async function openRegeneratePanel(targetMode: ModeId, context?: CreationContext, fallbackImageUrl?: string) {
    if (context) {
      if (targetMode === 'costume' && context.templateId) setCostumeStyle(context.templateId)
      if (targetMode === 'food' && context.templateId) setFoodShowcase(context.templateId)
      if (targetMode === 'painting' && context.templateId) setPaintingStyle(context.templateId)
      if (context.gender) setGender(context.gender)
      updateDraft(targetMode, { file: context.file, preview: context.preview })
    } else if (fallbackImageUrl) {
      try {
        const imageResponse = await fetch(fallbackImageUrl, { cache: 'force-cache' })
        if (!imageResponse.ok) throw new Error(`HTTP ${imageResponse.status}`)
        const imageBlob = await imageResponse.blob()
        const extension = imageBlob.type.includes('png') ? 'png' : imageBlob.type.includes('webp') ? 'webp' : 'jpg'
        const imageFile = new File([imageBlob], `regenerate.${extension}`, { type: imageBlob.type || 'image/jpeg' })
        updateDraft(targetMode, { file: imageFile, preview: fallbackImageUrl })
      } catch {
        setToast('原始图片加载失败，请重新选择图片')
      }
    }
    setMode(targetMode)
    setChatMode(targetMode)
    setView('chat')
    setShowCreationPanel(true)
  }

  function templateIdFor(targetMode: ModeId) {
    if (targetMode === 'costume') return costumeStyle
    if (targetMode === 'painting') return paintingStyle
    return foodShowcase
  }

  function templateTitleFor(targetMode: ModeId) {
    const targetTemplates = getVisibleTemplates(targetMode, templates)
    const selectedId = targetMode === 'costume' ? costumeStyle : targetMode === 'food' ? foodShowcase : paintingStyle
    return targetTemplates.find((item) => item.id === selectedId)?.title || modeLabels[targetMode]
  }

  function updateCreationMessageImage(targetMode: ModeId, imageUrl: string) {
    const messageId = activeCreationContextRef.current[targetMode]?.messageId
    if (!messageId || !imageUrl) return
    setChatMessages((current) =>
      current.map((message) => (message.id === messageId ? { ...message, imageUrl } : message)),
    )
  }

  // 处理 /api/create 或 /api/create/start 的响应：两条路径完成后的收尾逻辑完全一样
  async function handleCreateApiResponse(targetMode: ModeId, response: Response) {
    let data: CreateResult
    try {
      data = (await response.json()) as CreateResult
    } catch {
      data = {
        status: 'failed',
        mode: targetMode,
        message: `服务返回了异常响应（HTTP ${response.status}），请稍后重试。`,
      }
    }
    const context = activeCreationContextRef.current[targetMode]
    data = { ...data, mode: targetMode, createdAt: context?.createdAt ? context.createdAt + 1 : Date.now() }
    if (data.inputImageUrl) updateCreationMessageImage(targetMode, data.inputImageUrl)
    updateDraft(targetMode, { result: data })
    saveWork(data)
    setChatMode(targetMode)
    setView('chat')

    if (response.ok && data.taskId && ['queued', 'running'].includes(data.status)) {
      savePendingTask(targetMode, data)
      void pollTask(data, targetMode)
    }
    return data
  }

  // Token 网关没开时的原始路径：一次请求直接建任务，不经过咪咕 taskId 页面
  async function submitLegacyCreate(targetMode: ModeId, file: File, overrides: CreationOverrides = {}) {
    const formData = new FormData()
    formData.append('image', file)
    formData.append('mode', targetMode)
    const template = overrides.templateId ?? templateIdFor(targetMode)
    if (template) formData.append('template', template)
    formData.append('gender', overrides.gender || gender || 'female')

    try {
      const response = await fetch('/api/create', { method: 'POST', body: formData })
      await handleCreateApiResponse(targetMode, response)
    } catch {
      updateDraft(targetMode, {
        result: {
          status: 'failed',
          mode: targetMode,
          message: '无法连接本地服务，请确认已经运行 npm run dev 后重试。',
        },
      })
    } finally {
      updateDraft(targetMode, { busy: false })
    }
  }

  // Token 网关开着时：先上传+机审拿 imageUrl，存好待提交状态，再整页跳转去咪咕拿 taskId
  async function beginTokenGatedCreation(targetMode: ModeId, file: File, btoken: string, overrides: CreationOverrides = {}) {
    const template = overrides.templateId ?? templateIdFor(targetMode)
    const formData = new FormData()
    formData.append('image', file)
    formData.append('mode', targetMode)
    if (template) formData.append('template', template)
    formData.append('gender', overrides.gender || gender || 'female')

    try {
      const prepareResponse = await fetch('/api/create/prepare', { method: 'POST', body: formData })
      const prepared = (await prepareResponse.json()) as {
        status?: string
        message?: string
        templateTitle?: string
        imageUrl?: string
      }
      if (!prepareResponse.ok || prepared.status !== 'ready' || !prepared.imageUrl) {
        updateDraft(targetMode, {
          result: { status: 'failed', mode: targetMode, message: prepared.message || '素材准备失败，请稍后重试。' },
        })
        return
      }
      updateCreationMessageImage(targetMode, prepared.imageUrl)

      const pending: PendingCreation = {
        mode: targetMode,
        template,
        gender: overrides.gender || gender || 'female',
        templateTitle: overrides.templateTitle || prepared.templateTitle || modeLabels[targetMode],
        imageUrl: prepared.imageUrl,
      }
      window.sessionStorage.setItem(pendingCreationStorageKey, JSON.stringify(pending))

      const taskIdUrlResponse = await fetch('/api/migu/task-id-url', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ btoken, mode: targetMode }),
      })
      const taskIdUrlData = (await taskIdUrlResponse.json()) as { url?: string; message?: string }
      if (!taskIdUrlResponse.ok || !taskIdUrlData.url) {
        window.sessionStorage.removeItem(pendingCreationStorageKey)
        updateDraft(targetMode, {
          result: { status: 'failed', mode: targetMode, message: taskIdUrlData.message || '暂时无法发起创作，请稍后重试。' },
        })
        return
      }

      window.sessionStorage.setItem(miguTaskIdPendingKey, '1')
      trackQingyuanTraceLog({
        processId: 1,
        processType: '2',
        goodsId: templateIdFor(targetMode),
        goodsName: pending.templateTitle,
        isInMiguApp: miguEnv.isInMiguAPP,
        isInMiniprogram: miguEnv.isInMiniprogram,
      })
      // 整页跳转到咪咕获取 taskId 页面，回来后由挂载时的 effect 接着走 resumeTokenGatedCreation
      window.location.href = taskIdUrlData.url
    } catch {
      updateDraft(targetMode, {
        result: { status: 'failed', mode: targetMode, message: '无法连接本地服务，请稍后重试。' },
      })
    }
  }

  // 从咪咕获取 taskId 页面跳转回来后续接创作：Token 预扣通过了才真正建任务
  async function resumeTokenGatedCreation(miguTaskId: string, btoken: string, pending: PendingCreation) {
    setMode(pending.mode)
    updateDraft(pending.mode, { busy: true, result: null })
    try {
      const response = await fetch('/api/create/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mode: pending.mode,
          template: pending.template,
          gender: pending.gender,
          templateTitle: pending.templateTitle,
          imageUrl: pending.imageUrl,
          taskId: miguTaskId,
          otoken: btoken,
        }),
      })
      const data = await handleCreateApiResponse(pending.mode, response)
      if (response.ok && data.taskId) {
        miguTaskIdByJobRef.current[data.taskId] = miguTaskId
        trackAmberSubmitTask(miguTaskId, pending.template, readMiguSession()?.vuid)
      } else {
        // Token 预扣减没通过，创作任务根本没建起来——直接算办理失败
        trackQingyuanTraceLog({
          processId: 2,
          processType: '8',
          orderId: miguTaskId,
          goodsId: pending.template,
          goodsName: pending.templateTitle,
          resultCode: '1',
          errorMessage: data.message,
          isInMiguApp: miguEnv.isInMiguAPP,
          isInMiniprogram: miguEnv.isInMiniprogram,
        })
      }
    } catch {
      updateDraft(pending.mode, {
        result: { status: 'failed', mode: pending.mode, message: '无法连接本地服务，请稍后重试。' },
      })
    } finally {
      updateDraft(pending.mode, { busy: false })
    }
  }

  async function createVideo(targetMode: ModeId = mode, overrides: CreationOverrides = {}) {
    if (!tokenGatingReady || tokenGatingLoadFailed) {
      setToast(tokenGatingLoadFailed ? '创作服务初始化失败，请刷新页面重试' : '创作服务正在初始化，请稍后再试')
      return
    }

    let shouldUseTokenGating = tokenGatingEnabled
    if (!temporarilyBypassMiguLogin) {
      try {
        const gatingResponse = await fetch('/api/migu/token-gating', { cache: 'no-store' })
        if (!gatingResponse.ok) throw new Error(`HTTP ${gatingResponse.status}`)
        const gatingData = (await gatingResponse.json()) as { enabled?: boolean }
        shouldUseTokenGating = Boolean(gatingData.enabled)
        if (shouldUseTokenGating !== tokenGatingEnabled) setTokenGatingEnabled(shouldUseTokenGating)
      } catch {
        setToast('创作服务状态确认失败，请稍后重试')
        return
      }
    }

    const targetDraft = drafts[targetMode]
    const targetIsWaiting = targetDraft.busy || targetDraft.polling

    if (!temporarilyBypassMiguLogin && !isLoggedIn) {
      const templateId = overrides.templateId ?? templateIdFor(targetMode)
      if (templateId) savePendingLoginAction({ kind: 'template', mode: targetMode, templateId })
      setShowLoginDialog(true)
      return
    }

    if (targetIsWaiting || hasRunningTask || creationStartingRef.current) {
      setToast('已有1项任务制作中，稍后再创作哦～可到我的作品页查看进度')
      return
    }

    const nextFile = overrides.file || targetDraft.file
    if (!nextFile) {
      if (targetMode !== mode) setMode(targetMode)
      setToast('请上传你的创意图片或选择参考图')
      requestUpload()
      return
    }

    const creationGender = overrides.gender || gender
    if (targetMode === 'costume' && !creationGender) {
      setToast('请选择性别')
      setShowCreationPanel(true)
      return
    }

    if (!acceptedAgreement && !overrides.skipAgreement) {
      returnToCreationPanelRef.current = showCreationPanel
      setShowCreationPanel(false)
      setShowUsageNotice(true)
      return
    }

    const file = nextFile
    const session = readMiguSession()
    const previousResult = targetDraft.result
    const previousContext = activeCreationContextRef.current[targetMode]
    if (previousResult) {
      setChatResultHistory((current) => {
        const historyId = previousResult.taskId || previousContext?.id || `${targetMode}-${previousResult.status}-${previousResult.message}`
        if (current.some((item) => item.id === historyId)) return current
        return [...current, {
          id: historyId,
          mode: targetMode,
          result: previousResult,
          context: previousContext,
          createdAt: previousResult.createdAt || previousContext?.createdAt || Date.now(),
        }]
      })
    }

    const stamp = Date.now()
    const templateTitle = overrides.templateTitle || templateTitleFor(targetMode)
    const creationTemplateId = overrides.templateId ?? templateIdFor(targetMode)
    const messagePreview = overrides.preview || targetDraft.preview
    const messageId = `user-create-${stamp}`
    creationStartingRef.current = true
    setShowCreationPanel(false)
    activeCreationContextRef.current[targetMode] = {
      id: `creation-${stamp}`,
      messageId,
      createdAt: stamp,
      file,
      preview: messagePreview,
      gender: creationGender || undefined,
      templateId: creationTemplateId,
      templateTitle,
    }
    setChatMessages((current) => [
      ...current.filter((item) => !item.loading),
      {
        id: messageId,
        role: 'user',
        text: getCreationPrompt(targetMode, creationTemplateId),
        imageUrl: messagePreview || undefined,
        createdAt: stamp,
      },
    ])
    setChatMode(targetMode)
    setView('chat')
    updateDraft(targetMode, {
      busy: true,
      result: { status: 'queued', mode: targetMode, message: '创作请求已提交', templateTitle, createdAt: stamp + 1 },
    })

    try {
      if (shouldUseTokenGating && session?.btoken) {
        await beginTokenGatedCreation(targetMode, file, session.btoken, { ...overrides, gender: creationGender || undefined })
        // 成功时上面那步已经整页跳转离开了，走不到这里；只有失败/降级路径需要收尾复位
        updateDraft(targetMode, { busy: false })
        return
      }

      await submitLegacyCreate(targetMode, file, { ...overrides, gender: creationGender || undefined })
    } finally {
      creationStartingRef.current = false
    }
  }

  async function pollTask(initial: CreateResult, targetMode: ModeId) {
    if (!initial.taskId) return
    if (pollingTaskIdsRef.current.has(initial.taskId)) return
    pollingTaskIdsRef.current.add(initial.taskId)
    updateDraft(targetMode, { polling: true })
    let current = initial
    let consecutiveFailures = 0

    try {
      for (let attempt = 0; attempt < 200; attempt += 1) {
        if (attempt > 0) await wait(3000)

        let data: CreateResult
        try {
          const response = await fetch(`/api/tasks/${current.taskId}?mode=${targetMode}`)
          data = (await response.json()) as CreateResult
          consecutiveFailures = 0
        } catch {
          consecutiveFailures += 1
          if (consecutiveFailures >= 5) {
            updateDraft(targetMode, {
              result: {
                ...current,
                status: 'running',
                message: '查询任务状态时网络中断，任务可能仍在生成，可点击“刷新状态”继续查询。',
              },
            })
            return
          }
          continue
        }

        current = { ...current, ...data, mode: targetMode }
        updateDraft(targetMode, { result: current })

        if (current.status === 'succeeded') {
          saveWork(current)
          clearPendingTask(targetMode)
          const miguTaskId = current.taskId ? miguTaskIdByJobRef.current[current.taskId] : undefined
          if (miguTaskId && current.videoUrl) {
            trackAmberCompleteTask(
              miguTaskId,
              current.videoUrl,
              templateIdFor(targetMode),
              current.templateTitle,
              readMiguSession()?.vuid,
            )
            trackQingyuanTraceLog({
              processId: 2,
              processType: '8',
              orderId: miguTaskId,
              goodsId: templateIdFor(targetMode),
              goodsName: current.templateTitle,
              contentId: current.taskId,
              resultCode: '0',
              isInMiguApp: miguEnv.isInMiguAPP,
              isInMiniprogram: miguEnv.isInMiniprogram,
            })
          }
          return
        }

        if (current.status === 'failed') {
          clearPendingTask(targetMode)
          const miguTaskId = current.taskId ? miguTaskIdByJobRef.current[current.taskId] : undefined
          if (miguTaskId) {
            trackQingyuanTraceLog({
              processId: 2,
              processType: '8',
              orderId: miguTaskId,
              goodsId: templateIdFor(targetMode),
              contentId: current.taskId,
              resultCode: '1',
              errorMessage: current.message,
              isInMiguApp: miguEnv.isInMiguAPP,
              isInMiniprogram: miguEnv.isInMiniprogram,
            })
          }
          return
        }
      }

      updateDraft(targetMode, {
        result: {
          ...current,
          status: 'running',
          message: '任务仍在生成中，可点击“刷新状态”继续查询，也可以稍后重新打开页面。',
        },
      })
    } finally {
      pollingTaskIdsRef.current.delete(initial.taskId)
      updateDraft(targetMode, { polling: false })
    }
  }

  async function publishVideo(videoUrl?: string, videoCover?: string, resourceId?: string, templateId?: string) {
    if (publishRedirectingRef.current) return
    if (!videoUrl) {
      setToast('缺少可发布的视频地址')
      return
    }
    if (!videoCover) {
      setToast('视频封面尚未生成，请稍后重试')
      return
    }

    publishRedirectingRef.current = true
    try {
      const session = readMiguSession()
      const response = await fetch('/api/migu/publish-url', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          videoUrl,
          videoCover,
          projectId: session?.projectId,
          releaseId: session?.releaseId,
          watermarkId: session?.watermarkId,
          otherSet: session?.otherSet,
          isMiniPublish: session?.isMiniPublish,
        }),
      })
      const data = (await response.json()) as { url?: string; message?: string }
      if (!response.ok || !data.url) {
        setToast(data.message || '暂时无法打开视频彩铃发布页')
        return
      }
      // 发布页 token 每次现取且只能使用一次，必须整页跳转，不能 window.open。
      trackAmberPublishRingtone(resourceId || videoUrl, videoUrl, templateId, readMiguSession()?.vuid)
      window.location.href = data.url
    } catch {
      setToast('无法连接发布服务，请稍后重试')
    } finally {
      publishRedirectingRef.current = false
    }
  }

  return (
    <main
      className={`app-shell view-${view}${miguEnv.isInMiguAPP ? ' in-migu' : ''}${miguEnv.isInMiniprogram ? ' in-miniprogram' : ''}`}
    >
      <header className="app-topbar">
        <button
          className="icon-button"
          type="button"
          onClick={() => (view === 'home' ? undefined : view === 'library' ? leaveLibrary() : returnHome())}
          aria-label={view === 'library' ? '返回上一页' : '返回首页'}
        >
          <ArrowLeft size={20} />
        </button>
        <button className="title-button" type="button" onClick={() => setShowInfo(true)}>
          <strong>AI非遗文化skill</strong>
          <Info size={14} />
        </button>
        <div className="topbar-actions">
          <button className="credit-badge" type="button" onClick={() => setShowBalanceDetail(true)} aria-label="查看分贝明细">
            <Sparkles size={13} />
            {visibleBalance}
          </button>
          <button className="works-pill" type="button" onClick={() => (view === 'library' ? leaveLibrary() : openLibrary())}>
            我的作品
          </button>
        </div>
      </header>

      {view === 'home' && (
        <HomeView
          mode={mode}
          selectedTemplate={selectedTemplate}
          templates={visibleTemplates}
          onBubbleClick={handleBubbleClick}
          onChooseTemplate={chooseTemplate}
          onOpenTemplate={openTemplateDetail}
          onUseTemplate={(template) => void createFromTemplate(template)}
          onOpenChat={() => startNonCreativeChat()}
          onShuffle={shuffleTemplates}
        />
      )}

      {view === 'detail' && selectedTemplate && (
        <TemplateDetail template={selectedTemplate} onBack={returnHome} onUse={useSameTemplate} />
      )}

      {view === 'chat' && (
        <ChatView
          history={chatResultHistory}
          messages={chatMessages}
          mode={chatMode}
          result={chatResult}
          polling={drafts[chatMode].polling}
          videoUrl={chatVideoUrl}
          topics={chatTopics}
          onCreativeBubble={handleBubbleClick}
          onRegenerate={() => void openRegeneratePanel(chatMode, activeCreationContextRef.current[chatMode], chatResult?.inputImageUrl)}
          onRegenerateHistory={(item) => void openRegeneratePanel(item.mode, item.context, item.result.inputImageUrl)}
          onPublishHistory={(item) =>
            void publishVideo(
              item.result.videoUrl || item.result.previewUrl,
              item.result.posterUrl,
              item.result.taskId,
              item.context?.templateId,
            )
          }
          onRefresh={() => {
            if (chatResult) void pollTask(chatResult, chatMode)
          }}
          onPublish={() =>
            void publishVideo(chatVideoUrl, chatResult?.posterUrl, chatResult?.taskId, templateIdFor(chatMode))
          }
          onTopic={startNonCreativeChat}
          onUnlockHome={returnHome}
        />
      )}

      {view === 'library' && (
        <LibraryView
          balance={typeof visibleBalance === 'number' ? visibleBalance : undefined}
          drafts={drafts}
          onBack={leaveLibrary}
          onDelete={deleteWork}
          onClearDraft={clearDraftResult}
          onOpenBalance={() => setShowBalanceDetail(true)}
          onPickMode={chooseMode}
          onPublish={(record) => void publishVideo(record.videoUrl, record.posterUrl, record.taskId)}
          onUnlockHome={returnHome}
          works={works}
        />
      )}

      {(view === 'home' || view === 'chat') && (
        <CreationDock
          acceptedAgreement={acceptedAgreement}
          activeMode={activeMode}
          busy={busy}
          fileRef={fileRef}
          imageReviewing={imageReviewing || faceReviewing}
          isWaiting={hasRunningTask}
          mode={mode}
          modeItems={modes}
          preview={hasRunningTask ? '' : preview}
          prompt={getCreationPrompt(mode, selectedTemplate?.id)}
          showComposer={view === 'chat' || showQuickComposer}
          uploadSource={uploadSource}
          onAgreementChange={(accepted) => {
            if (accepted) {
              returnToCreationPanelRef.current = false
              setUploadFlowPending(false)
              setShowUsageNotice(true)
            } else {
              setAcceptedAgreement(false)
            }
          }}
          onChooseFile={chooseFile}
          onChooseMode={setMode}
          onCreate={() => void createVideo()}
          onExpandComposer={() => setShowQuickComposer(true)}
          onOpenCreationPanel={() => {
            returnToCreationPanelRef.current = false
            setShowCreationPanel(true)
            if (!drafts[mode].file) void chooseSampleImage(mode, sampleImagesByMode[mode][0])
          }}
          onOpenUsageNotice={() => {
            returnToCreationPanelRef.current = false
            setUploadFlowPending(false)
            setShowUsageNotice(true)
          }}
          onRequestUpload={requestUpload}
        />
      )}

      {showInfo && (
        <InfoModal
          loginTemporarilyDisabled={temporarilyBypassMiguLogin}
          onClose={() => setShowInfo(false)}
          onViewUsageDetail={openUsageDetail}
        />
      )}
      {showBalanceDetail && (
        <BalanceModal
          balance={tokenRemain}
          visibleBalance={visibleBalance}
          loginTemporarilyDisabled={temporarilyBypassMiguLogin}
          onClose={() => setShowBalanceDetail(false)}
          onViewOfficial={() => void openUsageDetail()}
        />
      )}
      {!temporarilyBypassMiguLogin && showLoginDialog && <LoginDialog onCancel={closeLoginDialog} onConfirm={confirmLogin} />}
      {showUsageNotice && <UsageNoticeSheet onAccept={confirmUsageNotice} onClose={closeUsageNotice} />}
      {showMediaSourceSheet && (
        <MediaSourceSheet onCancel={closeMediaSourceSheet} onChoose={chooseMediaSource} />
      )}
      {showPermissionDialog && (
        <PermissionDialog
          isIOS={usesIOSPermissionDialog}
          isJoint={!miguEnv.isInMiguAPP || miguEnv.isInMiniprogram}
          source={uploadSource}
          onCancel={closePermissionDialog}
          onConfirm={confirmMediaPermission}
        />
      )}
      {(imageReviewing || faceReviewing) && <ReviewingOverlay kind={faceReviewing ? 'face' : 'machine'} />}
      {showCropSheet && (
        <CropSheet
          cropRatio={cropRatio}
          preview={preview}
          onClose={restorePreviousPanel}
          onConfirm={finishCropAndCreate}
          onRatioChange={setCropRatio}
          onRequestUpload={requestUpload}
        />
      )}
      {showCreationPanel && (
        <CreationPanel
          activeMode={activeMode}
          acceptedAgreement={acceptedAgreement}
          imageReviewing={imageReviewing}
          gender={gender}
          mode={mode}
          preview={preview}
          samples={sampleImagesByMode[mode]}
          selectedTemplate={selectedTemplate}
          templates={visibleTemplates}
          onClose={() => {
            returnToCreationPanelRef.current = false
            setShowCreationPanel(false)
          }}
          onAgreementChange={(accepted) => {
            if (accepted) {
              returnToCreationPanelRef.current = true
              setUploadFlowPending(false)
              setShowCreationPanel(false)
              setShowUsageNotice(true)
            } else {
              setAcceptedAgreement(false)
            }
          }}
          onCreate={() => {
            void createVideo()
          }}
          onGenderChange={setGender}
          onChooseMode={choosePanelMode}
          onPreviewImage={setPreviewImageUrl}
          onRemoveImage={removeUploadedImage}
          onOpenUsageNotice={() => {
            returnToCreationPanelRef.current = true
            setUploadFlowPending(false)
            setShowCreationPanel(false)
            setShowUsageNotice(true)
          }}
          onRequestUpload={requestUpload}
          onSelectSample={(sample) => void chooseSampleImage(mode, sample)}
          onSelectTemplate={choosePanelTemplate}
        />
      )}
      {previewImageUrl && <ImagePreviewModal src={previewImageUrl} onClose={() => setPreviewImageUrl('')} onReplace={requestUpload} />}
      {toast && <div className="toast">{toast}</div>}
    </main>
  )
}

function HomeView({
  mode,
  selectedTemplate,
  templates,
  onBubbleClick,
  onChooseTemplate,
  onOpenChat,
  onOpenTemplate,
  onUseTemplate,
  onShuffle,
}: {
  mode: ModeId
  selectedTemplate?: TemplateItem
  templates: TemplateItem[]
  onBubbleClick: (item: InspirationBubble) => void
  onChooseTemplate: (id: string) => void
  onOpenChat: () => void
  onOpenTemplate: (template: TemplateItem) => void
  onUseTemplate: (template: TemplateItem) => void
  onShuffle: () => void
}) {
  const topBubbles = inspirationBubbles.filter((_, index) => index % 2 === 0)
  const bottomBubbles = inspirationBubbles.filter((_, index) => index % 2 === 1)

  function renderBubble(item: (typeof inspirationBubbles)[number]) {
    const Icon = item.icon
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => onBubbleClick(item)}
        className={item.mode === mode && item.templateId === selectedTemplate?.id ? 'selected' : ''}
      >
        <Icon size={16} />
        {item.label}
      </button>
    )
  }

  return (
    <section className="home-view">
      <div className="welcome-copy">
        <h1>Hi，欢迎来到AI非遗文化skill</h1>
        <p>用AI活化非遗影像，上传图片生成专属创意视频</p>
      </div>

      <div
        className="bubble-row"
        aria-label="玩法快捷词条"
        onWheel={(event) => {
          if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
          event.preventDefault()
          event.currentTarget.scrollLeft += event.deltaY
        }}
      >
        <div className="bubble-track bubble-track-top">{topBubbles.map(renderBubble)}</div>
        <div className="bubble-track bubble-track-bottom">{bottomBubbles.map(renderBubble)}</div>
      </div>

      <div className="template-section">
        <TemplateCarousel
          items={templates}
          mode={mode}
          selectedId={selectedTemplate?.id || ''}
          onOpenTemplate={onOpenTemplate}
          onSelect={onChooseTemplate}
          onUseTemplate={onUseTemplate}
        />
        <button className="shuffle-button" type="button" onClick={onShuffle}>
          <RefreshCw size={12} />
          换一批
        </button>
      </div>

      <button className="history-toggle" type="button" onClick={onOpenChat}>
        <MessageCircle size={14} />
        点击展示历史创作
      </button>
    </section>
  )
}

function CreationDock({
  acceptedAgreement,
  activeMode,
  busy,
  fileRef,
  imageReviewing,
  isWaiting,
  mode,
  modeItems,
  preview,
  prompt,
  showComposer,
  uploadSource,
  onAgreementChange,
  onChooseFile,
  onChooseMode,
  onCreate,
  onExpandComposer,
  onOpenCreationPanel,
  onOpenUsageNotice,
  onRequestUpload,
}: {
  acceptedAgreement: boolean
  activeMode: ModeConfig
  busy: boolean
  fileRef: React.RefObject<HTMLInputElement | null>
  imageReviewing: boolean
  isWaiting: boolean
  mode: ModeId
  modeItems: ModeConfig[]
  preview: string
  prompt: string
  showComposer: boolean
  uploadSource: UploadSource
  onAgreementChange: (accepted: boolean) => void
  onChooseFile: (file?: File) => void | Promise<void>
  onChooseMode: (mode: ModeId) => void
  onCreate: () => void
  onExpandComposer: () => void
  onOpenCreationPanel: () => void
  onOpenUsageNotice: () => void
  onRequestUpload: () => void
}) {
  return (
    <aside className={`creation-dock${showComposer ? ' with-composer' : ''}`} aria-label="快速创作">
      <div className="dock-handle" />
      <div className="mode-tabs" role="tablist" aria-label="创作类型">
        {modeItems.map((item) => {
          const Icon = item.icon
          return (
            <button
              key={item.id}
              className={item.id === mode ? 'active' : ''}
              onClick={() => {
                onChooseMode(item.id)
                onExpandComposer()
              }}
              type="button"
            >
              <Icon size={16} />
              <span>{item.short}</span>
            </button>
          )
        })}
      </div>

      {showComposer && (
        <>
          <div className="upload-preview">
            <button className="camera-button" type="button" onClick={onRequestUpload} aria-label="上传照片">
              {imageReviewing ? <Loader2 className="spin" size={23} /> : <Camera size={24} />}
            </button>
            <button className="prompt-input" type="button" onClick={onOpenCreationPanel}>
              {preview && !isWaiting ? <img src={preview} alt="" /> : null}
              <span>
                {isWaiting
                  ? prompt
                  : preview
                    ? `已选择图片，使用${activeMode.short}模板`
                    : activeMode.placeholder}
              </span>
            </button>
            <button
              className="send-button"
              type="button"
              disabled={imageReviewing}
              aria-busy={busy || isWaiting}
              onClick={onCreate}
            >
              <small>消耗 3</small>
              发送
            </button>
          </div>
          <AgreementRow
            accepted={acceptedAgreement}
            inputId="dock-usage-agreement"
            onChange={onAgreementChange}
            onOpenNotice={onOpenUsageNotice}
          />
        </>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture={uploadSource === 'camera' ? 'environment' : undefined}
        onChange={(event) => {
          void onChooseFile(event.target.files?.[0])
          event.currentTarget.value = ''
        }}
        hidden
      />
    </aside>
  )
}

function AgreementRow({
  accepted,
  inputId,
  onChange,
  onOpenNotice,
}: {
  accepted: boolean
  inputId: string
  onChange: (accepted: boolean) => void
  onOpenNotice: () => void
}) {
  return (
    <div className="agreement-row">
      <input id={inputId} type="checkbox" checked={accepted} onChange={(event) => onChange(event.target.checked)} />
      <span>
        <label htmlFor={inputId}>已阅读并同意</label>
        <button type="button" onClick={onOpenNotice}>
          《{usageNoticeTitle}》
        </button>
      </span>
    </div>
  )
}

function TemplateCarousel({
  items,
  mode,
  selectedId,
  onOpenTemplate,
  onSelect,
  onUseTemplate,
}: {
  items: TemplateItem[]
  mode: ModeId
  selectedId: string
  onOpenTemplate: (template: TemplateItem) => void
  onSelect: (id: string) => void
  onUseTemplate: (template: TemplateItem) => void
}) {
  const activeRef = useRef<HTMLElement | null>(null)
  const railRef = useRef<HTMLDivElement | null>(null)
  const selectedIndex = Math.max(0, items.findIndex((item) => item.id === selectedId))
  const displayItems = items.length > 2 ? [items[items.length - 1], ...items, items[0]] : items

  useEffect(() => {
    const rail = railRef.current
    const active = activeRef.current
    if (!rail || !active) return
    rail.scrollLeft = active.offsetLeft - (rail.clientWidth - active.clientWidth) / 2
  }, [items, selectedId])

  function step(delta: number) {
    if (!items.length) return
    const next = items[(selectedIndex + delta + items.length) % items.length]
    onSelect(next.id)
  }

  useEffect(() => {
    if (items.length <= 1 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') step(1)
    }, 4200)
    return () => window.clearInterval(timer)
    // selectedId is intentionally included so each user selection gets a full preview interval.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, selectedId])

  return (
    <div className="template-carousel-shell">
      <button className="rail-arrow prev" type="button" onClick={() => step(-1)} aria-label="上一个模板">
        ‹
      </button>
      <div
        className="template-rail"
        ref={railRef}
        onWheel={(event) => {
          if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
          event.preventDefault()
          event.currentTarget.scrollLeft += event.deltaY
        }}
      >
        {displayItems.map((item, displayIndex) => {
          const selected = item.id === selectedId && (items.length <= 2 || displayIndex === selectedIndex + 1)
          return (
            <article
              key={`${item.id}-${displayIndex}`}
              ref={selected ? activeRef : undefined}
              className={selected ? 'template-card selected' : 'template-card'}
              onMouseEnter={() => onSelect(item.id)}
            >
              <button
                className="template-preview-button"
                type="button"
                aria-label={`查看${item.title}模板详情`}
                onClick={() => {
                  onSelect(item.id)
                  onOpenTemplate(item)
                }}
              >
                <TemplateMedia item={item} preferVideo />
              </button>
              <AiContentPageMark />
              <span>{modeLabels[mode]}</span>
              <strong>{item.title}</strong>
              <button className="template-use-button" type="button" onClick={() => onUseTemplate(item)}>
                做同款
              </button>
            </article>
          )
        })}
      </div>
      <button className="rail-arrow next" type="button" onClick={() => step(1)} aria-label="下一个模板">
        ›
      </button>
    </div>
  )
}

function TemplateDetail({
  template,
  onBack,
  onUse,
}: {
  template: TemplateItem
  onBack: () => void
  onUse: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isMuted, setIsMuted] = useState(true)

  function toggleVideo() {
    const video = videoRef.current
    if (!video) return
    if (video.muted || video.volume === 0) {
      video.muted = false
      video.defaultMuted = false
      video.volume = 1
      setIsMuted(false)
      void video.play().then(() => setIsPlaying(true)).catch(() => undefined)
      return
    }
    if (video.paused) {
      void video.play().then(() => setIsPlaying(true)).catch(() => undefined)
      return
    }
    video.pause()
    setIsPlaying(false)
  }

  function toggleDetailSound() {
    const video = videoRef.current
    if (!video) return
    video.muted = !video.muted
    video.defaultMuted = video.muted
    if (!video.muted) video.volume = 1
    setIsMuted(video.muted)
  }

  return (
    <section className="detail-view">
      <button className="detail-back" type="button" onClick={onBack} aria-label="返回首页">
        <ArrowLeft size={21} />
      </button>
      <div className="detail-media" onClick={template.videoUrl ? toggleVideo : undefined}>
        {template.videoUrl ? (
          <video
            ref={videoRef}
            src={template.videoUrl}
            poster={template.imageUrl}
            muted={isMuted}
            playsInline
            preload="metadata"
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onVolumeChange={(event) => setIsMuted(event.currentTarget.muted || event.currentTarget.volume === 0)}
          />
        ) : (
          <TemplateMedia item={template} />
        )}
        <AiContentPageMark />
        {template.videoUrl && (
          <button
            className="detail-sound-toggle"
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              toggleDetailSound()
            }}
            aria-label={isMuted ? '开启声音' : '关闭声音'}
          >
            {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
        )}
        {template.videoUrl && (
          <button
            className={`play-button ${isPlaying ? 'playing' : ''}`}
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              toggleVideo()
            }}
            aria-label={isPlaying ? '暂停模板预览' : '播放模板预览'}
          >
            {isPlaying ? <PauseIcon /> : <Play size={30} fill="currentColor" />}
          </button>
        )}
        {template.videoUrl && isMuted && <div className="sound-hint">点击播放开启声音</div>}
        <div className="detail-caption">
          <strong>{template.title}</strong>
        </div>
      </div>
      <button className="detail-use" type="button" onClick={onUse}>
        做同款
      </button>
    </section>
  )
}

function PauseIcon() {
  return (
    <span className="pause-icon" aria-hidden="true">
      <i />
      <i />
    </span>
  )
}

function AiContentPageMark() {
  return (
    <span className="ai-content-page-mark" aria-label="内容由人工智能生成">
      内容由AI生成
    </span>
  )
}

function TemplateMedia({ item, className = '', preferVideo = false }: { item: TemplateItem; className?: string; preferVideo?: boolean }) {
  if (preferVideo && item.videoUrl) {
    return <video className={className} src={item.videoUrl} poster={item.imageUrl} muted autoPlay loop playsInline preload="metadata" />
  }
  if (item.imageUrl) return <img className={className} src={item.imageUrl} alt="" loading="lazy" decoding="async" />
  if (item.videoUrl) return <VideoPosterFrame src={item.videoUrl} className={className} />
  return <img className={className} src={fallbackTemplateImage} alt="" loading="lazy" decoding="async" />
}

function ChatView({
  history,
  messages,
  mode,
  result,
  polling,
  videoUrl,
  topics,
  onCreativeBubble,
  onRegenerate,
  onRegenerateHistory,
  onPublishHistory,
  onRefresh,
  onPublish,
  onTopic,
  onUnlockHome,
}: {
  history: ChatResultHistoryItem[]
  messages: ChatMessage[]
  mode: ModeId
  result: CreateResult | null
  polling: boolean
  videoUrl?: string
  topics: typeof chatTopics
  onCreativeBubble: (item: InspirationBubble) => void
  onRegenerate: () => void
  onRegenerateHistory: (item: ChatResultHistoryItem) => void
  onPublishHistory: (item: ChatResultHistoryItem) => void
  onRefresh: () => void
  onPublish: () => void
  onTopic: (topic: (typeof chatTopics)[number]) => void | Promise<void>
  onUnlockHome: () => void
}) {
  const creativeBubbles = inspirationBubbles.filter((item) => item.mode === mode)
  const [playRecord, setPlayRecord] = useState<CreationRecord | null>(null)
  const visibleHistory = history.filter(
    (item) => item.result !== result && (!result?.taskId || item.result.taskId !== result.taskId),
  )
  const timeline = [
    ...messages.map((message) => ({ kind: 'message' as const, createdAt: message.createdAt, message })),
    ...visibleHistory.map((item) => ({ kind: 'result' as const, createdAt: item.createdAt, item, current: false })),
    ...(result
      ? [{
          kind: 'result' as const,
          createdAt: result.createdAt || Date.now(),
          item: { id: result.taskId || `current-${mode}`, mode, result, createdAt: result.createdAt || Date.now() },
          current: true,
        }]
      : []),
  ].sort((left, right) => left.createdAt - right.createdAt)

  function openVideo(item: ChatResultHistoryItem) {
    const resultVideoUrl = item.result.videoUrl || item.result.previewUrl
    if (!resultVideoUrl) return
    setPlayRecord({
      id: item.id,
      taskId: item.result.taskId,
      code: item.result.code,
      mode: item.mode,
      status: 'succeeded',
      title: item.result.templateTitle || modeLabels[item.mode],
      message: item.result.message,
      videoUrl: resultVideoUrl,
      posterUrl: item.result.posterUrl,
      createdAt: new Date(item.createdAt).toISOString(),
      source: 'draft',
    })
  }

  return (
    <section className={result ? 'chat-view generation-view' : 'chat-view'}>
      <div className="message-list">
        {timeline.map((entry) => {
          if (entry.kind === 'message') {
            const message = entry.message
            if (message.role === 'user') {
              return (
                <div key={message.id} className={`message-turn user-turn${message.loading ? ' loading' : ''}`}>
                  {message.imageUrl && (
                    <div className="message-source-image">
                      <img src={message.imageUrl} alt="本次创作使用的原图" />
                    </div>
                  )}
                  <div className="message user">
                    <span>{message.text}</span>
                  </div>
                </div>
              )
            }
            return (
              <div key={message.id} className={`message ${message.role}${message.loading ? ' loading' : ''}`}>
                <span>{message.text}</span>
              </div>
            )
          }
          const item = entry.item
          return (
            <ChatTaskCard
              key={`${entry.current ? 'current' : 'history'}-${item.id}`}
              result={item.result}
              videoUrl={entry.current ? videoUrl : item.result.videoUrl || item.result.previewUrl}
              onPlay={(item.result.videoUrl || item.result.previewUrl) ? () => openVideo(item) : undefined}
              onPublish={
                item.result.status === 'succeeded'
                  ? entry.current
                    ? onPublish
                    : () => onPublishHistory(item)
                  : undefined
              }
              onRegenerate={
                item.result.status === 'succeeded'
                  ? entry.current
                    ? onRegenerate
                    : () => onRegenerateHistory(item)
                  : undefined
              }
              onRefresh={
                entry.current && !polling && item.result.taskId && ['queued', 'running'].includes(item.result.status)
                  ? onRefresh
                  : undefined
              }
            />
          )
        })}

        {!result ? (
          <>
            <div className="try-divider">试试新创意</div>
            {topics.map((topic) => (
              <button key={topic.prompt} className="topic-chip" type="button" onClick={() => void onTopic(topic)}>
                {topic.prompt}
              </button>
            ))}
          </>
        ) : (
          <>
            <div className="try-divider">试试同类创意</div>
            {creativeBubbles.map((item) => {
              const Icon = item.icon
              return (
                <button key={item.id} className="topic-chip creative" type="button" onClick={() => onCreativeBubble(item)}>
                  <Icon size={15} />
                  {item.label}
                </button>
              )
            })}
          </>
        )}
      </div>

      {!result && (
        <button className="unlock-home" type="button" onClick={onUnlockHome}>
          <Wand2 size={14} />
          点击解锁更多玩法
        </button>
      )}
      {playRecord && <RecordVideoModal record={playRecord} onClose={() => setPlayRecord(null)} />}
    </section>
  )
}

function ChatTaskCard({
  result,
  videoUrl,
  onRegenerate,
  onRefresh,
  onPublish,
  onPlay,
}: {
  result: CreateResult
  videoUrl?: string
  onRegenerate?: () => void
  onRefresh?: () => void
  onPublish?: () => void
  onPlay?: () => void
}) {
  const taskProgress = getTaskProgress(result)
  return (
    <article className={`task-card status-${videoUrl ? 'succeeded' : result.status}`}>
      {videoUrl ? (
        <button className="task-thumb task-video-button" type="button" onClick={onPlay} aria-label="播放生成的视频">
          <VideoPosterFrame src={videoUrl} poster={result.posterUrl || ''} showPlay showPageMark={false} />
        </button>
      ) : (
        <div className="task-thumb">
          <>
            {result.status === 'failed' ? <X size={24} /> : <Loader2 className="spin" size={30} />}
            <span>{result.status === 'failed' ? '失败' : `${taskProgress}%`}</span>
          </>
        </div>
      )}
      <div className="task-info">
        <strong>{videoUrl ? '视频生成完成' : result.status === 'failed' ? '生成失败' : 'AI非遗视频创作中...'}</strong>
        {videoUrl ? (
          <>
            <p className="task-success-hint">不满意了？点击「重新生成」试试新创意</p>
            {(onRegenerate || onPublish) && (
              <div className="task-actions">
                {onRegenerate && (
                  <button type="button" onClick={onRegenerate}>
                    <RefreshCw size={14} />
                    重新生成
                  </button>
                )}
                {onPublish && (
                  <button className="publish-action" type="button" onClick={onPublish}>
                    <Bell size={14} />
                    发布
                  </button>
                )}
              </div>
            )}
          </>
        ) : result.status === 'failed' ? (
          <p>{getChatFailureMessage(result.message, result.code)}</p>
        ) : (
          <>
            <p className="task-wait-hint">正在生成你的专属创意视频，请稍候</p>
            <div className="task-progress" aria-label={`创作进度 ${taskProgress}%`}>
              <span style={{ width: `${taskProgress}%` }} />
            </div>
            {onRefresh && (
              <div className="task-actions">
                <button type="button" onClick={onRefresh}>
                  <RefreshCw size={14} />
                  刷新状态
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </article>
  )
}

function VideoPosterFrame({
  src,
  poster = '',
  className = '',
  showPlay = false,
  showPageMark = true,
}: {
  src: string
  poster?: string
  className?: string
  showPlay?: boolean
  showPageMark?: boolean
}) {
  const [generatedPoster, setGeneratedPoster] = useState('')
  const [captureFailed, setCaptureFailed] = useState(false)
  const [pausedFrameReady, setPausedFrameReady] = useState(false)
  const posterUrl = poster || generatedPoster

  useEffect(() => {
    setGeneratedPoster('')
    setCaptureFailed(false)
    setPausedFrameReady(false)
  }, [src, poster])

  function capturePoster(video: HTMLVideoElement) {
    if (poster || generatedPoster || captureFailed) return
    try {
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth || 720
      canvas.height = video.videoHeight || 1280
      const context = canvas.getContext('2d')
      if (!context) {
        setCaptureFailed(true)
        return
      }
      context.drawImage(video, 0, 0, canvas.width, canvas.height)
      setGeneratedPoster(canvas.toDataURL('image/jpeg', 0.84))
    } catch {
      setCaptureFailed(true)
      setPausedFrameReady(true)
    }
  }

  function seekPosterFrame(video: HTMLVideoElement) {
    if (poster || generatedPoster || captureFailed) return
    const duration = Number.isFinite(video.duration) ? video.duration : 0
    if (duration <= 0) {
      setCaptureFailed(true)
      return
    }
    try {
      video.currentTime = Math.max(0, duration - 2)
    } catch {
      setCaptureFailed(true)
    }
  }

  return (
    <div className={`video-poster-frame ${className}`}>
      {posterUrl ? (
        <img src={posterUrl} alt="" />
      ) : captureFailed ? (
        <PausedVideoFrame src={src} onReady={() => setPausedFrameReady(true)} />
      ) : (
        <div className="video-poster-placeholder">
          <Play size={22} fill="currentColor" />
        </div>
      )}
      {!poster && !generatedPoster && !captureFailed && (
        <video
          aria-hidden="true"
          className="poster-capture-video"
          src={src}
          crossOrigin="anonymous"
          muted
          playsInline
          preload="metadata"
          onLoadedMetadata={(event) => seekPosterFrame(event.currentTarget)}
          onSeeked={(event) => capturePoster(event.currentTarget)}
          onError={() => setCaptureFailed(true)}
        />
      )}
      {showPlay && (
        <span className={`poster-play-mark ${pausedFrameReady || posterUrl ? '' : 'loading'}`} aria-hidden="true">
          <Play size={20} fill="currentColor" />
        </span>
      )}
      {showPageMark && <AiContentPageMark />}
    </div>
  )
}

function PausedVideoFrame({ src, onReady }: { src: string; onReady: () => void }) {
  const [ready, setReady] = useState(false)

  function seekPosterFrame(video: HTMLVideoElement) {
    const duration = Number.isFinite(video.duration) ? video.duration : 0
    if (duration <= 0) return
    try {
      video.currentTime = Math.max(0, duration - 2)
    } catch {
      // 保持视频第一帧作为兜底封面。
    }
  }

  function markReady() {
    setReady(true)
    onReady()
  }

  return (
    <>
      {!ready && (
        <div className="video-poster-placeholder">
          <Play size={22} fill="currentColor" />
        </div>
      )}
      <video
        aria-hidden="true"
        className={ready ? 'paused-frame-video ready' : 'paused-frame-video'}
        src={src}
        muted
        playsInline
        preload="metadata"
        onLoadedMetadata={(event) => seekPosterFrame(event.currentTarget)}
        onLoadedData={markReady}
        onSeeked={markReady}
      />
    </>
  )
}

function PreviewVideo({ src, poster = '', className = '' }: { src: string; poster?: string; className?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isMuted, setIsMuted] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [activated, setActivated] = useState(false)

  useEffect(() => {
    setActivated(false)
    setIsPlaying(false)
  }, [src])

  useEffect(() => {
    if (!activated) return
    const timer = window.setTimeout(() => playWithSound(), 0)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activated])

  function prepareSound(video: HTMLVideoElement) {
    video.defaultMuted = false
    video.muted = false
    video.volume = 1
    setIsMuted(false)
  }

  function toggleSound() {
    const video = videoRef.current
    if (!video) return

    if (video.muted || video.volume === 0) {
      prepareSound(video)
      void video.play().catch(() => undefined)
      return
    }

    video.muted = true
    setIsMuted(true)
  }

  function playWithSound() {
    const video = videoRef.current
    if (!video) return
    prepareSound(video)
    void video.play().then(() => setIsPlaying(true)).catch(() => undefined)
  }

  return (
    <div className="video-player">
      {!activated ? (
        <button className="video-poster-button" type="button" onClick={() => setActivated(true)} aria-label="播放视频">
          <VideoPosterFrame src={src} poster={poster} className={className} showPlay showPageMark={false} />
          <span>点击播放视频</span>
        </button>
      ) : (
        <>
          <video
            ref={videoRef}
            className={className}
            src={src}
            poster={poster}
            controls
            playsInline
            preload="metadata"
            onLoadedMetadata={(event) => prepareSound(event.currentTarget)}
            onClick={playWithSound}
            onPause={() => setIsPlaying(false)}
            onPlay={() => setIsPlaying(true)}
            onVolumeChange={(event) => setIsMuted(event.currentTarget.muted || event.currentTarget.volume === 0)}
          />
          {!isPlaying && (
            <button className="video-play-overlay" type="button" onClick={playWithSound} aria-label="播放视频并开启声音">
              <Play size={26} fill="currentColor" />
              <span>播放并开启声音</span>
            </button>
          )}
          <button
            className="sound-toggle"
            type="button"
            onClick={toggleSound}
            title={isMuted ? '开启声音' : '关闭声音'}
            aria-label={isMuted ? '开启声音' : '关闭声音'}
          >
            {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
        </>
      )}
      <AiContentPageMark />
    </div>
  )
}

function LibraryView({
  balance,
  drafts,
  works,
  onBack,
  onClearDraft,
  onDelete,
  onPickMode,
  onOpenBalance,
  onPublish,
  onUnlockHome,
}: {
  balance?: number
  drafts: Record<ModeId, ModeDraft>
  works: WorkItem[]
  onBack: () => void
  onClearDraft: (mode: ModeId) => void
  onDelete: (id: string) => void
  onPickMode: (mode: ModeId) => void
  onOpenBalance: () => void
  onPublish: (record: CreationRecord) => void
  onUnlockHome: () => void
}) {
  const [actionRecord, setActionRecord] = useState<CreationRecord | null>(null)
  const [detailRecord, setDetailRecord] = useState<CreationRecord | null>(null)
  const [playRecord, setPlayRecord] = useState<CreationRecord | null>(null)
  const [redoRecord, setRedoRecord] = useState<CreationRecord | null>(null)
  const [deleteRecord, setDeleteRecord] = useState<CreationRecord | null>(null)
  const [batchMode, setBatchMode] = useState(false)
  const [selectedRecordIds, setSelectedRecordIds] = useState<Set<string>>(() => new Set())
  const [confirmBatchDelete, setConfirmBatchDelete] = useState(false)
  const records = buildCreationRecords(works, drafts)

  function deleteRecordNow(record: CreationRecord) {
    if (record.source === 'work') onDelete(record.id)
    else onClearDraft(record.mode)
    setDeleteRecord(null)
  }

  function redo(record: CreationRecord) {
    setRedoRecord(null)
    onPickMode(record.mode)
  }

  function toggleBatchMode() {
    setBatchMode((current) => !current)
    setSelectedRecordIds(new Set())
  }

  function toggleRecordSelection(id: string) {
    setSelectedRecordIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function deleteSelectedRecords() {
    records.filter((record) => selectedRecordIds.has(record.id)).forEach((record) => {
      if (record.source === 'work') onDelete(record.id)
      else onClearDraft(record.mode)
    })
    setConfirmBatchDelete(false)
    setSelectedRecordIds(new Set())
    setBatchMode(false)
  }

  return (
    <section className="library-view">
      <div className="library-titlebar">
        <button type="button" onClick={onBack} aria-label="返回上一页">
          <ArrowLeft size={21} />
        </button>
        <h1>我的作品</h1>
        <button className="usage-detail" type="button" onClick={onOpenBalance}>
          {balance ?? '--'} 分贝&nbsp;&nbsp;使用明细
        </button>
      </div>

      <div className="retention-banner">预览的AI内容保留6个月，请及时发布</div>

      <div className="library-grid-tools">
        <button className={batchMode ? 'active' : ''} type="button" onClick={toggleBatchMode} aria-label={batchMode ? '退出批量管理' : '批量管理'}>
          <Grid2X2 size={18} />
          <span>{batchMode ? '完成' : '批量管理'}</span>
        </button>
      </div>

      {records.length === 0 ? (
        <div className="empty-works-page">
          <div className="empty-works-icon">
            <Film size={48} />
            <Sparkles size={20} />
          </div>
          <strong>期待你的创作~</strong>
          <button type="button" onClick={onUnlockHome}>
            去创作
          </button>
        </div>
      ) : (
        <div className="creation-record-grid">
          {records.map((record) => (
            <CreationRecordCard
              key={record.id}
              batchMode={batchMode}
              record={record}
              selected={selectedRecordIds.has(record.id)}
              onDelete={() => setDeleteRecord(record)}
              onMore={() => setActionRecord(record)}
              onOpenVideo={() => setPlayRecord(record)}
              onPublish={() => onPublish(record)}
              onRedo={() => setRedoRecord(record)}
              onToggle={() => toggleRecordSelection(record.id)}
            />
          ))}
        </div>
      )}

      {batchMode && records.length > 0 && (
        <div className="batch-action-bar">
          <span>已选择 {selectedRecordIds.size} 项</span>
          <button type="button" disabled={!selectedRecordIds.size} onClick={() => setConfirmBatchDelete(true)}>
            <Trash2 size={15} /> 删除
          </button>
        </div>
      )}

      {actionRecord && (
        <RecordActionSheet
          record={actionRecord}
          onClose={() => setActionRecord(null)}
          onDelete={() => {
            setDeleteRecord(actionRecord)
            setActionRecord(null)
          }}
          onDetail={() => {
            setDetailRecord(actionRecord)
            setActionRecord(null)
          }}
          onRedo={() => {
            setRedoRecord(actionRecord)
            setActionRecord(null)
          }}
        />
      )}

      {detailRecord && <RecordDetailModal record={detailRecord} onClose={() => setDetailRecord(null)} />}
      {playRecord && (
        <RecordVideoModal
          record={playRecord}
          onClose={() => setPlayRecord(null)}
          onPublish={() => onPublish(playRecord)}
        />
      )}
      {redoRecord && (
        <ConfirmDialog
          title="提示"
          message="重做一次将使用原记录中上传的参数生成，不会覆盖原作品，但会消耗150分页（当前可用：430分页），是否确认再做一次？"
          confirmText="确定"
          onCancel={() => setRedoRecord(null)}
          onConfirm={() => redo(redoRecord)}
        />
      )}
      {deleteRecord && (
        <ConfirmDialog
          title="提示"
          message="删除后将无法恢复，是否确认删除？"
          confirmText="确定"
          onCancel={() => setDeleteRecord(null)}
          onConfirm={() => deleteRecordNow(deleteRecord)}
        />
      )}
      {confirmBatchDelete && (
        <ConfirmDialog
          title="批量删除"
          message={`将删除已选择的 ${selectedRecordIds.size} 项记录，删除后无法恢复，是否继续？`}
          confirmText="删除"
          onCancel={() => setConfirmBatchDelete(false)}
          onConfirm={deleteSelectedRecords}
        />
      )}
    </section>
  )
}

function CreationRecordCard({
  batchMode,
  record,
  selected,
  onDelete,
  onMore,
  onOpenVideo,
  onPublish,
  onRedo,
  onToggle,
}: {
  batchMode: boolean
  record: CreationRecord
  selected: boolean
  onDelete: () => void
  onMore: () => void
  onOpenVideo: () => void
  onPublish: () => void
  onRedo: () => void
  onToggle: () => void
}) {
  const statusClass = record.status === 'succeeded' ? 'success' : record.status === 'failed' ? 'failed' : 'running'

  return (
    <article className={`creation-record-card ${statusClass}${batchMode ? ' batch-mode' : ''}${selected ? ' selected' : ''}`}>
      <div
        className="record-media"
        onClick={batchMode ? onToggle : record.status === 'succeeded' ? onOpenVideo : undefined}
        onKeyDown={(event) => {
          if (!['Enter', ' '].includes(event.key)) return
          if (batchMode) onToggle()
          else if (record.status === 'succeeded') onOpenVideo()
        }}
        role={batchMode || record.status === 'succeeded' ? 'button' : undefined}
        tabIndex={batchMode || record.status === 'succeeded' ? 0 : undefined}
      >
        {batchMode && (
          <span className="record-select-mark" aria-label={selected ? '已选择' : '未选择'}>
            {selected && <Check size={15} />}
          </span>
        )}
        {record.status === 'succeeded' && record.videoUrl ? (
          <>
            <VideoPosterFrame src={record.videoUrl} poster={record.posterUrl || ''} showPageMark={false} />
            <span className="record-play">
              <Play size={20} fill="currentColor" />
            </span>
          </>
        ) : record.status === 'failed' ? (
          <div className="record-failed-state">
            <Film size={35} />
            <strong>生成失败</strong>
            <span>{getRecordFailureMessage(record.message, record.code)}</span>
          </div>
        ) : (
          <div className="record-running-state">
            <Sparkles size={28} />
            <strong>{getTaskProgress(record)}%</strong>
            <div className="record-progress"><span style={{ width: `${getTaskProgress(record)}%` }} /></div>
          </div>
        )}
        <div className="record-gradient" />
        <strong className="record-title">{record.title}</strong>
        {!batchMode && <button
          className="record-more"
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            onMore()
          }}
          aria-label="更多操作"
        >
          <EllipsisVertical size={18} />
        </button>}
      </div>

      {!batchMode && record.status === 'succeeded' ? (
        <div className="record-actions">
          <button type="button" onClick={onPublish}>
            发布
          </button>
          <button type="button" onClick={onRedo}>
            再次创作
          </button>
        </div>
      ) : !batchMode && record.status === 'failed' ? (
        <div className="record-actions">
          <button type="button" onClick={onRedo}>
            再次创作
          </button>
          <button type="button" onClick={onDelete}>
            删除
          </button>
        </div>
      ) : null}
    </article>
  )
}

function RecordVideoModal({
  record,
  onClose,
  onPublish,
}: {
  record: CreationRecord
  onClose: () => void
  onPublish?: () => void
}) {
  if (!record.videoUrl) return null

  return (
    <div className="record-video-view" role="dialog" aria-modal="true" aria-label={`${record.title}视频预览`}>
      <button className="record-video-close" type="button" onClick={onClose} aria-label="关闭视频预览">
        <X size={24} />
      </button>
      <PreviewVideo src={record.videoUrl} poster={record.posterUrl || ''} />
      <div className="record-video-caption">
        <strong>{record.title}</strong>
        <span>点击播放按钮开启声音</span>
      </div>
      {onPublish && (
        <button className="record-video-publish" type="button" onClick={onPublish}>
          发布视频
        </button>
      )}
    </div>
  )
}

function RecordActionSheet({
  record,
  onClose,
  onDelete,
  onDetail,
  onRedo,
}: {
  record: CreationRecord
  onClose: () => void
  onDelete: () => void
  onDetail: () => void
  onRedo: () => void
}) {
  return (
    <div className="sheet-backdrop record-menu-backdrop" role="presentation">
      <section className="record-action-sheet" role="dialog" aria-modal="true" aria-label={`${record.title}更多操作`}>
        <div className="sheet-handle" />
        <button type="button" onClick={onDetail}>
          <Info size={18} />
          查看详情
        </button>
        <button type="button" onClick={onRedo}>
          <RefreshCw size={18} />
          再次创作
        </button>
        <button type="button" onClick={onDelete}>
          <Trash2 size={18} />
          删除记录
        </button>
        <button className="record-menu-close" type="button" onClick={onClose}>
          关闭
        </button>
      </section>
    </div>
  )
}

function RecordDetailModal({ record, onClose }: { record: CreationRecord; onClose: () => void }) {
  return (
    <div className="modal-backdrop soft" role="presentation">
      <section className="record-detail-modal" role="dialog" aria-modal="true" aria-labelledby="record-detail-title">
        <h2 id="record-detail-title">作品详情</h2>
        <p>创建时间:{formatFullTime(record.createdAt)}</p>
        <p>玩法模板:{record.title}</p>
        <p>状态:{getRecordStatusText(record.status)}</p>
        <button type="button" onClick={onClose}>
          我知道了
        </button>
      </section>
    </div>
  )
}

function ConfirmDialog({
  title,
  message,
  confirmText,
  onCancel,
  onConfirm,
}: {
  title: string
  message: string
  confirmText: string
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="modal-backdrop soft" role="presentation">
      <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <h2 id="confirm-title">{title}</h2>
        <p>{message}</p>
        <div className="confirm-actions">
          <button type="button" onClick={onCancel}>
            取消
          </button>
          <button type="button" onClick={onConfirm}>
            {confirmText}
          </button>
        </div>
      </section>
    </div>
  )
}

function UsageNoticeSheet({ onAccept, onClose }: { onAccept: () => void; onClose: () => void }) {
  return (
    <div className="sheet-backdrop notice-backdrop" role="presentation" onClick={onClose}>
      <section
        className="bottom-sheet notice-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="usage-notice-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sheet-handle" />
        <h2 id="usage-notice-title">{usageNoticeTitle}</h2>
        <div className="notice-copy">
          <p>
            1. AI智创彩铃服务由<strong>{serviceProviderName}</strong>提供，您同意使用本服务并上传图片，视为您授权
            <strong>{serviceProviderName}</strong>在本次服务内使用，您需对上传图片的版权负责。系统将通过后期技术在页面上生成新的AI创意视频，在此过程中，您所上传的图片将仅被用于本服务。如您上传的内容出现版权纠纷，
            <strong>{serviceProviderName}</strong>
            可删除您上传的素材及制作的内容。咪咕音乐不承担因此带来的任何第三方责任及法律风险。请仔细阅读《{usageNoticeTitle}》，您接受协议所述条款和条件后方可点击“我已阅读并同意”，或勾选“已阅读并同意《{usageNoticeTitle}》”。
          </p>
          <p>
            2. 请上传清晰的图片。
            <strong>
              不得上传涉及隐私、违规披露个人信息、淫秽色情、暴力血腥、违反国家法律法规及可能对咪咕音乐运营及
              {serviceProviderName}带来潜在威胁的内容。您保证对于上传的内容拥有相应的合法权利或已取得他人合法授权并有权用于参与本服务。
            </strong>
            否则，造成的一切后果及损失由您自行承担。
          </p>
          <p>
            3. 本管理政策如果有未涉及的情况，则参考《咪咕用户服务协议》和相关法律法规及政策要求处理。用户违反上述规定的，咪咕音乐有权依据《咪咕用户服务协议》和本公告处理。
          </p>
          <p className="privacy-policy-link">
            本公司的隐私政策链接：
            <a href={privacyPolicyUrl} target="_blank" rel="noreferrer">
              《隐私政策》
            </a>
          </p>
        </div>
        <button className="sheet-primary" type="button" onClick={onAccept}>
          我已阅读并同意
        </button>
      </section>
    </div>
  )
}

function LoginDialog({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="modal-backdrop soft permission-backdrop" role="presentation">
      <section className="permission-dialog login-dialog" role="dialog" aria-modal="true" aria-labelledby="login-title">
        <LogIn size={24} />
        <h2 id="login-title">登录后继续创作</h2>
        <p>上传照片前需要完成登录校验。登录状态会在当前设备上保留，避免重复校验。</p>
        <div className="dialog-actions">
          <button type="button" onClick={onCancel}>
            暂不登录
          </button>
          <button type="button" onClick={onConfirm}>
            登录并继续
          </button>
        </div>
      </section>
    </div>
  )
}

function MediaSourceSheet({
  onCancel,
  onChoose,
}: {
  onCancel: () => void
  onChoose: (source: UploadSource) => void
}) {
  return (
    <div className="sheet-backdrop media-source-backdrop" role="presentation">
      <section className="bottom-sheet media-source-sheet" role="dialog" aria-modal="true" aria-labelledby="media-source-title">
        <div className="sheet-handle" />
        <h2 id="media-source-title">请选择照片来源</h2>
        <div className="media-source-actions">
          <button type="button" onClick={() => onChoose('camera')}>
            <Camera size={22} />
            <span>
              <strong>拍照</strong>
              <small>打开相机拍摄照片</small>
            </span>
          </button>
          <button type="button" onClick={() => onChoose('gallery')}>
            <Images size={22} />
            <span>
              <strong>从相册选择</strong>
              <small>使用设备中的照片</small>
            </span>
          </button>
        </div>
        <button className="sheet-secondary" type="button" onClick={onCancel}>
          取消
        </button>
      </section>
    </div>
  )
}

function ReviewingOverlay({ kind }: { kind: 'machine' | 'face' }) {
  return (
    <div className="modal-backdrop soft reviewing-backdrop" role="status" aria-live="polite">
      <div className="reviewing-card">
        <Loader2 className="spin" size={25} />
        <strong>{kind === 'machine' ? '图片机审中…' : '人脸校验中…'}</strong>
        <span>{kind === 'machine' ? '正在检查图片内容与清晰度' : '正在确认照片中有清晰人脸'}</span>
      </div>
    </div>
  )
}

function PermissionDialog({
  isIOS,
  isJoint,
  source,
  onCancel,
  onConfirm,
}: {
  isIOS: boolean
  isJoint: boolean
  source: UploadSource
  onCancel: () => void
  onConfirm: () => void
}) {
  if (isIOS) {
    return (
      <div className="modal-backdrop soft permission-backdrop ios-permission-backdrop" role="presentation">
        <section className="permission-dialog ios-permission-dialog" role="dialog" aria-modal="true" aria-labelledby="ios-permission-copy">
          <p id="ios-permission-copy">访问您的相机/储存，用于AI应用内容创作服务</p>
          <div className="dialog-actions">
            <button type="button" onClick={onCancel}>取消</button>
            <button type="button" onClick={onConfirm}>确定</button>
          </div>
        </section>
      </div>
    )
  }

  return (
    <div className="modal-backdrop soft permission-backdrop" role="presentation">
      <section className="permission-dialog" role="dialog" aria-modal="true" aria-labelledby="permission-title">
        <ShieldCheck size={24} />
        <h2 id="permission-title">请允许我们使用{isJoint ? '相机/相册' : source === 'camera' ? '相机' : '相册'}</h2>
        <p>
          {isJoint
            ? '我们需要相机/相册权限，用于AI应用内容创作服务。'
            : `我们需要${source === 'camera' ? '相机' : '相册'}权限，用于AI应用内容创作服务。`}
        </p>
        <div className="dialog-actions">
          <button type="button" onClick={onCancel}>
            取消
          </button>
          <button type="button" onClick={onConfirm}>
            确定
          </button>
        </div>
      </section>
    </div>
  )
}

function CropSheet({
  cropRatio,
  preview,
  onClose,
  onConfirm,
  onRatioChange,
  onRequestUpload,
}: {
  cropRatio: CropRatio
  preview: string
  onClose: () => void
  onConfirm: (file: File) => void | Promise<void>
  onRatioChange: (ratio: CropRatio) => void
  onRequestUpload: () => void
}) {
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 })
  const [freeFrame, setFreeFrame] = useState({ width: 72, height: 58 })
  const [isExporting, setIsExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const cropStageRef = useRef<HTMLDivElement | null>(null)
  const cropImageRef = useRef<HTMLImageElement | null>(null)
  const cropFrameRef = useRef<HTMLDivElement | null>(null)
  const pointersRef = useRef(new Map<number, { x: number; y: number }>())
  const freeResizeRef = useRef({
    pointerId: -1,
    startX: 0,
    startY: 0,
    startWidth: 72,
    startHeight: 58,
  })
  const gestureRef = useRef({
    startX: 0,
    startY: 0,
    startScale: 1,
    startDistance: 0,
    startCenterX: 0,
    startCenterY: 0,
  })

  function getPointerCenter() {
    const points = [...pointersRef.current.values()]
    const x = points.reduce((sum, point) => sum + point.x, 0) / points.length
    const y = points.reduce((sum, point) => sum + point.y, 0) / points.length
    return { x, y }
  }

  function getPointerDistance() {
    const points = [...pointersRef.current.values()]
    if (points.length < 2) return 0
    return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y)
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId)
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const center = getPointerCenter()
    gestureRef.current = {
      startX: transform.x,
      startY: transform.y,
      startScale: transform.scale,
      startDistance: getPointerDistance(),
      startCenterX: center.x,
      startCenterY: center.y,
    }
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!pointersRef.current.has(event.pointerId)) return
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const center = getPointerCenter()
    const distance = getPointerDistance()
    const isPinching = pointersRef.current.size >= 2 && gestureRef.current.startDistance > 0
    const nextScale = isPinching
      ? clamp(gestureRef.current.startScale * (distance / gestureRef.current.startDistance), 0.7, 3)
      : gestureRef.current.startScale
    setTransform({
      x: clamp(gestureRef.current.startX + center.x - gestureRef.current.startCenterX, -220, 220),
      y: clamp(gestureRef.current.startY + center.y - gestureRef.current.startCenterY, -260, 260),
      scale: nextScale,
    })
  }

  function handlePointerEnd(event: React.PointerEvent<HTMLDivElement>) {
    pointersRef.current.delete(event.pointerId)
    if (pointersRef.current.size) {
      const center = getPointerCenter()
      gestureRef.current = {
        startX: transform.x,
        startY: transform.y,
        startScale: transform.scale,
        startDistance: getPointerDistance(),
        startCenterX: center.x,
        startCenterY: center.y,
      }
    }
  }

  function handleFreeResizeStart(event: React.PointerEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    freeResizeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startWidth: freeFrame.width,
      startHeight: freeFrame.height,
    }
  }

  function handleFreeResizeMove(event: React.PointerEvent<HTMLButtonElement>) {
    if (freeResizeRef.current.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    const stage = cropStageRef.current
    if (!stage) return
    const bounds = stage.getBoundingClientRect()
    setFreeFrame({
      width: clamp(freeResizeRef.current.startWidth + ((event.clientX - freeResizeRef.current.startX) / bounds.width) * 200, 34, 88),
      height: clamp(freeResizeRef.current.startHeight + ((event.clientY - freeResizeRef.current.startY) / bounds.height) * 200, 28, 84),
    })
  }

  function handleFreeResizeEnd(event: React.PointerEvent<HTMLButtonElement>) {
    if (freeResizeRef.current.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    freeResizeRef.current.pointerId = -1
  }

  async function exportCrop() {
    const stage = cropStageRef.current
    const image = cropImageRef.current
    const frame = cropFrameRef.current
    if (!stage || !image || !frame || !image.naturalWidth || !image.naturalHeight || isExporting) return

    setIsExporting(true)
    setExportError('')
    try {
      const stageBounds = stage.getBoundingClientRect()
      const frameBounds = frame.getBoundingClientRect()
      const imageAspect = image.naturalWidth / image.naturalHeight
      const stageAspect = stageBounds.width / stageBounds.height
      const containedWidth = imageAspect > stageAspect ? stageBounds.width : stageBounds.height * imageAspect
      const containedHeight = imageAspect > stageAspect ? stageBounds.width / imageAspect : stageBounds.height
      const renderedWidth = containedWidth * transform.scale
      const renderedHeight = containedHeight * transform.scale
      const imageLeft = (stageBounds.width - containedWidth) / 2 + transform.x + (containedWidth - renderedWidth) / 2
      const imageTop = (stageBounds.height - containedHeight) / 2 + transform.y + (containedHeight - renderedHeight) / 2
      const frameLeft = frameBounds.left - stageBounds.left
      const frameTop = frameBounds.top - stageBounds.top

      const outputWidth = 1080
      const outputHeight = Math.max(1, Math.min(1920, Math.round(outputWidth * (frameBounds.height / frameBounds.width))))
      const canvas = document.createElement('canvas')
      canvas.width = outputWidth
      canvas.height = outputHeight
      const context = canvas.getContext('2d')
      if (!context) throw new Error('当前浏览器不支持图片裁剪')

      context.fillStyle = '#000'
      context.fillRect(0, 0, outputWidth, outputHeight)
      const outputScaleX = outputWidth / frameBounds.width
      const outputScaleY = outputHeight / frameBounds.height
      context.drawImage(
        image,
        (imageLeft - frameLeft) * outputScaleX,
        (imageTop - frameTop) * outputScaleY,
        renderedWidth * outputScaleX,
        renderedHeight * outputScaleY,
      )

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92))
      if (!blob) throw new Error('裁剪图片生成失败')
      const croppedFile = new File([blob], `cropped-${Date.now()}.jpg`, { type: blob.type, lastModified: Date.now() })
      await onConfirm(croppedFile)
    } catch (error) {
      setExportError(error instanceof Error ? error.message : '裁剪图片生成失败，请重试')
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div className="sheet-backdrop crop-backdrop" role="presentation">
      <section className="bottom-sheet crop-sheet" role="dialog" aria-modal="true" aria-labelledby="crop-title">
        <div className="sheet-handle" />
        <div className="crop-header">
          <button type="button" onClick={onRequestUpload}>
            重新选择
          </button>
          <h2 id="crop-title">编辑图片</h2>
          <button type="button" onClick={() => void exportCrop()} disabled={isExporting}>
            {isExporting ? '处理中…' : '确定'}
          </button>
        </div>
        <div
          className="crop-stage"
          ref={cropStageRef}
          onPointerCancel={handlePointerEnd}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
        >
          {preview ? (
            <img
              ref={cropImageRef}
              src={preview}
              alt="裁剪预览"
              draggable={false}
              style={{
                transform: `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})`,
              }}
            />
          ) : (
            <ImageUp size={30} />
          )}
          <div
            ref={cropFrameRef}
            className={`crop-frame ratio-${cropRatio.replace(':', '-')}`}
            style={cropRatio === 'free' ? { width: `${freeFrame.width}%`, height: `${freeFrame.height}%` } : undefined}
          >
            <Crop size={20} />
            {cropRatio === 'free' && (
              <button
                className="crop-resize-handle"
                type="button"
                aria-label="拖动调整自由裁剪框大小"
                onPointerCancel={handleFreeResizeEnd}
                onPointerDown={handleFreeResizeStart}
                onPointerMove={handleFreeResizeMove}
                onPointerUp={handleFreeResizeEnd}
              />
            )}
          </div>
        </div>
        <div className="crop-options">
          <button className={cropRatio === '9:16' ? 'selected' : ''} type="button" onClick={() => onRatioChange('9:16')}>
            9:16
          </button>
          <button className={cropRatio === '1:1' ? 'selected' : ''} type="button" onClick={() => onRatioChange('1:1')}>
            1:1
          </button>
          <button className={cropRatio === 'free' ? 'selected' : ''} type="button" onClick={() => onRatioChange('free')}>
            自由
          </button>
        </div>
        <p>
          {cropRatio === 'free'
            ? '拖动裁剪框右下角可自由调整宽高，同时支持拖动图片或双指缩放。'
            : '请将人物等主体置于框内中央，可通过拖动或双指缩放裁剪图片。'}
        </p>
        {exportError && <p className="crop-error" role="alert">{exportError}</p>}
        <button className="sheet-secondary" type="button" onClick={onClose}>
          稍后再编辑
        </button>
      </section>
    </div>
  )
}

function CreationPanel({
  acceptedAgreement,
  activeMode,
  gender,
  imageReviewing,
  mode,
  preview,
  samples,
  selectedTemplate,
  templates,
  onAgreementChange,
  onClose,
  onCreate,
  onChooseMode,
  onGenderChange,
  onPreviewImage,
  onRemoveImage,
  onOpenUsageNotice,
  onRequestUpload,
  onSelectSample,
  onSelectTemplate,
}: {
  acceptedAgreement: boolean
  activeMode: ModeConfig
  gender: GenderId | null
  imageReviewing: boolean
  mode: ModeId
  preview: string
  samples: SampleImage[]
  selectedTemplate?: TemplateItem
  templates: TemplateItem[]
  onAgreementChange: (accepted: boolean) => void
  onClose: () => void
  onCreate: () => void
  onChooseMode: (mode: ModeId) => void
  onGenderChange: (gender: GenderId) => void
  onPreviewImage: (src: string) => void
  onRemoveImage: () => void
  onOpenUsageNotice: () => void
  onRequestUpload: () => void
  onSelectSample: (sample: SampleImage) => void
  onSelectTemplate: (id: string) => void
}) {
  const selectedSampleId = samples.find((sample) => sample.imageUrl === preview)?.id
  const hasUploadedPreview = Boolean(preview && !selectedSampleId)
  const templateIndex = Math.max(0, templates.findIndex((item) => item.id === selectedTemplate?.id))
  const contextualSample = samples[templateIndex % samples.length] || samples[0]

  return (
    <div className="sheet-backdrop panel-backdrop" role="presentation" onClick={onClose}>
      <section
        className={`bottom-sheet creation-panel mode-${mode}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="creation-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sheet-handle" />
        <div className="panel-mode-tabs">
          {modes.map((item) => {
            const Icon = item.icon
            return (
              <button key={item.id} className={item.id === mode ? 'active' : ''} type="button" onClick={() => onChooseMode(item.id)}>
                <Icon size={15} />
                {item.short}
              </button>
            )
          })}
        </div>
        <h2 id="creation-title">
          1. 请选择照片
          <small>提取照片，生成你的专属{activeMode.short}视频</small>
        </h2>
        <div className="asset-strip sample-image-strip">
          <button className="asset-tile upload" type="button" onClick={onRequestUpload}>
            {imageReviewing ? <Loader2 className="spin" size={20} /> : <ImageUp size={21} />}
            <span>上传图片</span>
          </button>
          {hasUploadedPreview && (
            <div className="asset-tile selected uploaded-photo">
              <button type="button" onClick={() => onPreviewImage(preview)} aria-label="查看上传图片">
                <img src={preview} alt="上传图片" />
              </button>
              <button className="asset-remove" type="button" onClick={onRemoveImage} aria-label="移除上传图片">
                <X size={12} />
              </button>
              <CheckBadge />
            </div>
          )}
          {contextualSample && (
            <button
              className={contextualSample.id === selectedSampleId ? 'asset-tile sample-tile selected' : 'asset-tile sample-tile'}
              type="button"
              title={contextualSample.title}
              aria-label={`选择${activeMode.short}示例图`}
              onClick={() => onSelectSample(contextualSample)}
            >
              <img src={contextualSample.thumbnailUrl} alt={contextualSample.title} width={240} height={240} decoding="async" />
              <span className="sample-label">示例</span>
              {contextualSample.id === selectedSampleId && <CheckBadge />}
            </button>
          )}
        </div>
        {mode === 'costume' && (
          <>
            <h2>
              2. 请选择性别
              <small>用于匹配服饰与人物造型</small>
            </h2>
            <div className="gender-choice" role="radiogroup" aria-label="请选择性别">
              <button
                className={gender === 'female' ? 'selected' : ''}
                type="button"
                role="radio"
                aria-checked={gender === 'female'}
                onClick={() => onGenderChange('female')}
              >
                女性
              </button>
              <button
                className={gender === 'male' ? 'selected' : ''}
                type="button"
                role="radio"
                aria-checked={gender === 'male'}
                onClick={() => onGenderChange('male')}
              >
                男性
              </button>
            </div>
          </>
        )}
        <h2>{mode === 'costume' ? '3. 模板随心选' : '2. 模板随心选'}</h2>
        <div className="asset-strip template-choice-strip">
          {templates.map((item) => (
            <button
              key={item.id}
              className={item.id === selectedTemplate?.id ? 'asset-tile template-choice-tile selected' : 'asset-tile template-choice-tile'}
              type="button"
              onClick={() => onSelectTemplate(item.id)}
            >
              <TemplateMedia item={item} />
              <span className="template-choice-label">{item.title}</span>
              {item.id === selectedTemplate?.id && <CheckBadge />}
            </button>
          ))}
        </div>
        <div className="panel-footer">
          <button className="panel-send" type="button" onClick={onCreate}>
            <small>消耗 3</small>
            发送
          </button>
          <AgreementRow
            accepted={acceptedAgreement}
            inputId="panel-usage-agreement"
            onChange={onAgreementChange}
            onOpenNotice={onOpenUsageNotice}
          />
        </div>
      </section>
    </div>
  )
}

function CheckBadge() {
  return (
    <span className="check-badge" aria-hidden="true">
      <Check size={13} />
    </span>
  )
}

function ImagePreviewModal({ src, onClose, onReplace }: { src: string; onClose: () => void; onReplace: () => void }) {
  return (
    <div className="image-preview-backdrop" role="presentation">
      <section className="image-preview-modal" role="dialog" aria-modal="true" aria-label="查看上传图片">
        <button className="image-preview-close" type="button" onClick={onClose} aria-label="关闭图片预览">
          <X size={20} />
        </button>
        <img src={src} alt="上传图片预览" />
        <div className="image-preview-actions">
          <button type="button" onClick={onReplace}>
            重新上传
          </button>
          <button type="button" onClick={onClose}>
            确定
          </button>
        </div>
      </section>
    </div>
  )
}

function InfoModal({
  loginTemporarilyDisabled,
  onClose,
  onViewUsageDetail,
}: {
  loginTemporarilyDisabled: boolean
  onClose: () => void
  onViewUsageDetail: () => void
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="info-modal" role="dialog" aria-modal="true" aria-labelledby="info-title">
        <button className="modal-close" type="button" onClick={onClose} aria-label="关闭">
          ×
        </button>
        <h2 id="info-title">应用说明</h2>
        <p>
          1、本服务由<strong>{serviceProviderName}</strong>提供，需要登录后方可使用。
        </p>
        <p>2、应用在标注“活动体验”期间无需支付使用费用。在没有标注“活动体验”时使用创作服务就会开始收费（收费标准结合AI研发和算力成本制定）。</p>
        {!loginTemporarilyDisabled && (
          <button className="usage-detail-link" type="button" onClick={onViewUsageDetail}>
            查看 Token 使用明细
          </button>
        )}
        <button type="button" onClick={onClose}>
          知道了
        </button>
      </section>
    </div>
  )
}

function BalanceModal({
  balance,
  visibleBalance,
  loginTemporarilyDisabled,
  onClose,
  onViewOfficial,
}: {
  balance: TokenRemainInfo | null
  visibleBalance: number | string
  loginTemporarilyDisabled: boolean
  onClose: () => void
  onViewOfficial: () => void
}) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section className="balance-modal" role="dialog" aria-modal="true" aria-labelledby="balance-title" onClick={(event) => event.stopPropagation()}>
        <button className="modal-close" type="button" onClick={onClose} aria-label="关闭">×</button>
        <h2 id="balance-title">分贝余额</h2>
        <strong className="balance-total">{visibleBalance}</strong>
        <dl>
          <div><dt>体验分贝</dt><dd>{balance?.experienceCount ?? '--'}</dd></div>
          <div><dt>权益次数</dt><dd>{balance?.rightsCount ?? '--'}</dd></div>
          <div><dt>已消耗分贝</dt><dd>{balance?.consumePointsCount ?? '--'}</dd></div>
        </dl>
        {loginTemporarilyDisabled ? (
          <p>当前为免登录测试模式，接入登录与计费接口后会显示实时明细。</p>
        ) : (
          <button className="balance-detail-link" type="button" onClick={onViewOfficial}>查看完整使用明细</button>
        )}
      </section>
    </div>
  )
}

function getVisibleTemplates(mode: ModeId, templates: TemplateData): TemplateItem[] {
  if (mode === 'costume') {
    return [...templates.ethnic, ...templates.dynasty].map(({ id, title, imageUrl, videoUrl }) => ({
      id,
      title,
      imageUrl: imageUrl || fallbackTemplateImage,
      videoUrl,
      subtitle: '非遗服饰模板',
    }))
  }
  if (mode === 'food') return templates.food
  return templates.paintings
}

function normalizeCostumeTitles(items: CostumeOption[]): CostumeOption[] {
  return items.map((item) => ({
    ...item,
    title: item.group === 'ethnic' && item.title.length <= 4 && !item.title.endsWith('风') ? `${item.title}风` : item.title,
  }))
}

function loadWorks() {
  try {
    const raw = window.localStorage.getItem(worksStorageKey)
    if (!raw) return []
    const parsed = JSON.parse(raw) as WorkItem[]
    return Array.isArray(parsed)
      ? parsed.filter((item) => item.videoUrl && item.taskId && isWithinRecentSixMonths(item.createdAt))
      : []
  } catch {
    return []
  }
}

async function fetchWorkPoster(item: WorkItem) {
  try {
    const taskResponse = await fetch(`/api/tasks/${encodeURIComponent(item.taskId)}?mode=${encodeURIComponent(item.mode)}`)
    if (taskResponse.ok) {
      const taskData = (await taskResponse.json()) as CreateResult
      if (taskData.posterUrl) return taskData.posterUrl
    }
  } catch {
    // Fall back to creating a poster from the saved video URL.
  }

  try {
    const posterResponse = await fetch('/api/video-poster', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: item.taskId, videoUrl: item.videoUrl }),
    })
    if (!posterResponse.ok) return ''
    const posterData = (await posterResponse.json()) as PosterResponse
    return posterData.posterUrl || ''
  } catch {
    return ''
  }
}

function buildCreationRecords(works: WorkItem[], drafts: Record<ModeId, ModeDraft>): CreationRecord[] {
  const workTaskIds = new Set(works.map((item) => item.taskId))
  const draftRecords = Object.entries(drafts).flatMap(([mode, draft]) => {
    const result = draft.result
    if (!result || result.status === 'succeeded' || (result.taskId && workTaskIds.has(result.taskId))) return []
    return [
      {
        id: `draft-${mode}`,
        taskId: result.taskId,
        code: result.code,
        mode: mode as ModeId,
        status: result.status,
        title: result.templateTitle || modeLabels[mode as ModeId],
        message: result.message,
        videoUrl: result.videoUrl || result.previewUrl,
        posterUrl: result.posterUrl,
        createdAt: new Date().toISOString(),
        source: 'draft' as const,
      },
    ]
  })

  const workRecords = works.filter((item) => isWithinRecentSixMonths(item.createdAt)).map((item) => ({
    id: item.id,
    taskId: item.taskId,
    mode: item.mode,
    status: 'succeeded' as const,
    title: item.title,
    message: item.message,
    videoUrl: item.videoUrl,
    posterUrl: item.posterUrl,
    createdAt: item.createdAt,
    source: 'work' as const,
  }))

  return [...draftRecords, ...workRecords]
}

function isWithinRecentSixMonths(value: string, now = new Date()) {
  const createdAt = new Date(value)
  if (Number.isNaN(createdAt.getTime())) return false
  const cutoff = new Date(now)
  cutoff.setMonth(cutoff.getMonth() - 6)
  return createdAt >= cutoff
}

function getRecordFailureMessage(message: string, code?: string) {
  return getFailureMessage(message, code, false)
}

function getChatFailureMessage(message: string, code?: string) {
  return getFailureMessage(message, code, true)
}

function getFailureMessage(message: string, code: string | undefined, detailed: boolean) {
  const combined = `${code || ''} ${message || ''}`.trim()

  if (/CREATE_RATE_LIMITED|请求过于频繁|生成请求过于频繁/.test(combined)) {
    return detailed ? '操作太频繁，请按提示稍后重试' : '操作太频繁，生成失败'
  }
  if (/MIGU_TASK_ALREADY_RUNNING|200001|仍在执行|仍在结算|已有正在执行/.test(combined)) {
    return '上一项创作仍在执行或结算中，请稍后再试'
  }
  // 审核服务故障不是内容违规，必须先于“审核/机审”关键词判断。
  if (/199999|TASK_STATUS_TEMPORARILY_UNAVAILABLE|审核服务.*(不可用|失败|异常|超时)|机审.*(不可用|失败|异常|超时)/.test(combined)) {
    return '服务暂时不可用，系统会继续处理，请稍后刷新状态'
  }
  if (/PolicyViolation|SensitiveContent|Copyright|违规|不适合|未通过.*审核|审核未通过|500027|300103/.test(combined)) {
    return '这个内容不适合展示哦'
  }
  if (/朗读|音频|准确率|500101/.test(combined)) {
    return detailed ? '朗读内容准确率低，请重新录制后重试' : '朗读内容准确率低'
  }
  if (/500012|500013|500014|500015|500016|500017|500018|500019|500002|500003|500004|500005|500007|500020|500021|500028|人数过多|功能过于火爆/.test(combined)) {
    return detailed ? '生成服务当前繁忙，可稍后重新生成' : '生成服务繁忙，生成失败'
  }
  if (/权益|Token|预扣|扣减|余额|402|TOKEN_PREDEDUCT_FAILED/.test(combined)) {
    return '创作权益校验未通过，请确认权益后重试'
  }
  if (/API_KEY|\.env|未配置|配置异常/.test(combined)) {
    return '生成服务配置异常，请联系工作人员'
  }
  if (/无法连接|网络|HTTP 5\d\d|fetch|timeout|超时/i.test(combined)) {
    return '生成服务连接异常，请稍后重试'
  }

  const cleaned = String(message || '')
    .replace(/https?:\/\/\S+/g, '上游服务')
    .replace(/[\r\n]+/g, ' ')
    .trim()
  return cleaned ? cleaned.slice(0, 120) : '生成失败，请稍后重试'
}

function getCreationPrompt(mode: ModeId, templateId?: string) {
  if (templateId && creationPromptByTemplateId[templateId]) return creationPromptByTemplateId[templateId]
  if (mode === 'costume') return '结合图片，生成一段非遗服饰变装视频'
  if (mode === 'food') return '结合图片，生成一段10秒Q版非遗美食微缩景观趣味讲解视频'
  return '结合图片，生成一段传统画作活化视频'
}

function getRecordStatusText(status: TaskStatus) {
  if (status === 'succeeded') return '生成成功'
  if (status === 'failed') return '生成失败'
  if (status === 'queued') return '排队中'
  return '生成中'
}

function formatFullTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '刚刚'
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

function getTaskProgress(result: Pick<CreateResult, 'status' | 'message'>) {
  if (result.status === 'succeeded') return 100
  if (result.status === 'failed') return 100
  const message = result.message || ''
  if (/提交|视频生成任务|Ark/.test(message)) return 72
  if (/参考图|换装/.test(message)) return 54
  if (/识别|提示词|分析/.test(message)) return 46
  if (/上传|素材/.test(message)) return 28
  if (result.status === 'running') return 62
  return 18
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

export default App
