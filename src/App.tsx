import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  Camera,
  Check,
  Crop,
  Download,
  EllipsisVertical,
  Film,
  Gift,
  Grid2X2,
  ImageUp,
  Info,
  Library,
  Loader2,
  MessageCircle,
  Palette,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  Utensils,
  Volume2,
  VolumeX,
  Wand2,
  X,
} from 'lucide-react'
import './App.css'

type ModeId = 'costume' | 'food' | 'painting'
type GenderId = 'female' | 'male'
type CostumeGroupId = 'ethnic' | 'dynasty'
type TaskStatus = 'queued' | 'running' | 'succeeded' | 'failed'
type AppView = 'home' | 'library' | 'chat' | 'detail'
type CropRatio = '9:16' | '1:1'

type CreateResult = {
  taskId?: string
  status: TaskStatus
  mode: ModeId
  message: string
  templateTitle?: string
  previewUrl?: string
  videoUrl?: string
  posterUrl?: string
}

type ModeDraft = {
  file: File | null
  preview: string
  result: CreateResult | null
  busy: boolean
  polling: boolean
}

type TemplateItem = {
  id: string
  title: string
  imageUrl: string
  videoUrl?: string
  subtitle?: string
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
  loading?: boolean
}

type ChatResponse = {
  reply?: string
  source?: 'llm' | 'fallback'
}

type PosterResponse = {
  posterUrl?: string
}

type MiguEnv = {
  isInMiguAPP: boolean
  isInMiniprogram: boolean
}

const worksStorageKey = 'ai-yitu-zhenying-works'
const pendingStorageKey = 'ai-yitu-zhenying-pending'
const usageAcceptedStorageKey = 'ai-yitu-zhenying-usage-accepted'
const mediaPermissionStorageKey = 'ai-yitu-zhenying-media-permission'

const modes = [
  {
    id: 'costume' as const,
    name: '图秀千年华裳',
    short: '民族变装',
    icon: Sparkles,
    desc: '上传人物照，智能匹配民族服饰或华夏朝代造型，生成一支有音乐、有镜头、有传统风韵的竖版短片。',
    placeholder: '上传人物正脸照片，选择服饰模板',
  },
  {
    id: 'food' as const,
    name: '图萌舌尖美味',
    short: '美食萌化',
    icon: Utensils,
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

const uploadHints: Record<ModeId, string> = {
  costume: '请上传包含人物正脸的照片',
  food: '请上传清晰美食照片',
  painting: '请上传年画、壁画、剪纸等照片',
}

const genderOptions = [
  { id: 'female' as const, label: '女性' },
  { id: 'male' as const, label: '男性' },
]

type GenderOption = (typeof genderOptions)[number]

const costumeGroups = [
  { id: 'ethnic' as const, label: '民族服饰' },
  { id: 'dynasty' as const, label: '华夏朝代' },
]

type CostumeGroupOption = (typeof costumeGroups)[number]

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

const inspirationBubbles = [
  { id: 'chat-random', label: '随机开启一场闲聊', mode: null, icon: MessageCircle },
  { id: 'costume-main', label: '制作非遗换装短片', mode: 'costume' as const, icon: Sparkles },
  { id: 'food-main', label: '让美食变成动画', mode: 'food' as const, icon: Utensils },
  { id: 'painting-main', label: '让画作动起来', mode: 'painting' as const, icon: Palette },
  { id: 'festival', label: '生成节日祝福视频', mode: 'costume' as const, icon: Gift },
]

const chatTopics = [
  {
    prompt: '早上好，新的一天加油呀',
  },
  {
    prompt: '讲个冷笑话',
  },
  {
    prompt: '我今天的幸运数是什么',
  },
]

const usageNoticeTitle = 'AI应用照片采集使用须知'
const usageNoticeParagraphs = [
  'AI非遗文化skill服务由AI非遗文化skill提供，您同意使用本服务并上传图片，视为您授权本服务在本次AI创意视频生成中使用。您需对上传图片或文字内容的版权负责。',
  '系统将通过后期技术在页面上生成新的AI创意视频。您上传的图片或视频仅用于本服务。如上传内容出现版权纠纷，平台可删除您上传的素材及制作内容。',
  '请上传清晰图片，不得上传涉及隐私、违规披露个人信息、淫秽色情、暴力血腥、违反国家法律法规及可能带来潜在威胁的内容。您保证拥有上传内容的合法权利或已取得合法授权。',
]

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
  const [works, setWorks] = useState<WorkItem[]>(loadWorks)
  const [mode, setMode] = useState<ModeId>('costume')
  const [gender, setGender] = useState<GenderId>('female')
  const [costumeGroup, setCostumeGroup] = useState<CostumeGroupId>('ethnic')
  const [costumeStyle, setCostumeStyle] = useState('ethnic-miao')
  const [paintingStyle, setPaintingStyle] = useState(paintingStyles[0].id)
  const [foodShowcase, setFoodShowcase] = useState('茶点')
  const [acceptedAgreement, setAcceptedAgreement] = useState(() => window.localStorage.getItem(usageAcceptedStorageKey) === 'true')
  const [showInfo, setShowInfo] = useState(false)
  const [showUsageNotice, setShowUsageNotice] = useState(false)
  const [showPermissionDialog, setShowPermissionDialog] = useState(false)
  const [showCreationPanel, setShowCreationPanel] = useState(false)
  const [showCropSheet, setShowCropSheet] = useState(false)
  const [previewImageUrl, setPreviewImageUrl] = useState('')
  const [uploadFlowPending, setUploadFlowPending] = useState(false)
  const [mediaPermissionGranted, setMediaPermissionGranted] = useState(() => window.localStorage.getItem(mediaPermissionStorageKey) === 'true')
  const [imageReviewing, setImageReviewing] = useState(false)
  const [cropRatio, setCropRatio] = useState<CropRatio>('9:16')
  const [toast, setToast] = useState('')
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatBusy, setChatBusy] = useState(false)
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

  const activeMode = useMemo(() => modes.find((item) => item.id === mode)!, [mode])
  const costumeOptions = costumeGroup === 'ethnic' ? templates.ethnic : templates.dynasty
  const visibleTemplates = useMemo(() => getVisibleTemplates(mode, costumeOptions, templates), [costumeOptions, mode, templates])
  const selectedTemplate = useMemo(() => {
    const selectedId = mode === 'costume' ? costumeStyle : mode === 'food' ? foodShowcase : paintingStyle
    return visibleTemplates.find((item) => item.id === selectedId) || visibleTemplates[0]
  }, [costumeStyle, foodShowcase, mode, paintingStyle, visibleTemplates])
  const { file, preview, result, busy, polling } = drafts[mode]
  const isWaiting = busy || polling
  const hasRunningTask = Object.values(drafts).some((draft) => draft.busy || draft.polling)
  const videoUrl = result?.videoUrl || result?.previewUrl

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

  useEffect(() => {
    window.localStorage.setItem(worksStorageKey, JSON.stringify(works))
  }, [works])

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
    window.localStorage.setItem(mediaPermissionStorageKey, String(mediaPermissionGranted))
  }, [mediaPermissionGranted])

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
    setView('home')
  }

  function chooseCostumeGroup(nextGroup: CostumeGroupId) {
    setCostumeGroup(nextGroup)
    setCostumeStyle(nextGroup === 'ethnic' ? 'ethnic-miao' : 'dynasty-song')
  }

  function chooseTemplate(templateId: string) {
    if (mode === 'costume') setCostumeStyle(templateId)
    if (mode === 'food') setFoodShowcase(templateId)
    if (mode === 'painting') setPaintingStyle(templateId)
  }

  function requestUpload() {
    setUploadFlowPending(true)
    setShowCreationPanel(false)
    setPreviewImageUrl('')
    if (!acceptedAgreement) {
      setShowPermissionDialog(false)
      setShowCropSheet(false)
      setShowUsageNotice(true)
      return
    }
    if (miguEnv.isInMiguAPP) {
      setMediaPermissionGranted(true)
    } else if (!mediaPermissionGranted) {
      setShowUsageNotice(false)
      setShowCropSheet(false)
      setShowPermissionDialog(true)
      return
    }
    setShowUsageNotice(false)
    setShowPermissionDialog(false)
    fileRef.current?.click()
  }

  function confirmUsageNotice() {
    setAcceptedAgreement(true)
    setShowUsageNotice(false)
    if (uploadFlowPending && !mediaPermissionGranted) {
      window.setTimeout(() => setShowPermissionDialog(true), 120)
    } else if (uploadFlowPending) {
      window.setTimeout(() => fileRef.current?.click(), 120)
    }
  }

  function confirmMediaPermission() {
    setMediaPermissionGranted(true)
    setShowPermissionDialog(false)
    if (uploadFlowPending) {
      window.setTimeout(() => fileRef.current?.click(), 120)
    }
  }

  function closeUsageNotice() {
    setShowUsageNotice(false)
    setUploadFlowPending(false)
  }

  function closePermissionDialog() {
    setShowPermissionDialog(false)
    setUploadFlowPending(false)
  }

  async function chooseFile(nextFile?: File) {
    if (!nextFile) return
    if (preview.startsWith('blob:')) URL.revokeObjectURL(preview)
    setImageReviewing(true)
    setUploadFlowPending(false)
    updateDraft(mode, {
      file: nextFile,
      result: null,
      preview: URL.createObjectURL(nextFile),
    })
    await wait(450)
    setImageReviewing(false)
    setShowCreationPanel(false)
    setShowUsageNotice(false)
    setShowPermissionDialog(false)
    setShowCropSheet(true)
  }

  function removeUploadedImage() {
    if (preview.startsWith('blob:')) URL.revokeObjectURL(preview)
    updateDraft(mode, {
      file: null,
      preview: '',
      result: null,
    })
    setPreviewImageUrl('')
  }

  function handleBubbleClick(item: (typeof inspirationBubbles)[number]) {
    if (!item.mode) {
      startNonCreativeChat()
      return
    }
    setMode(item.mode)
    setView('home')
  }

  function startNonCreativeChat(topic?: (typeof chatTopics)[number]) {
    if (topic) {
      void sendChatMessage(topic.prompt)
      return
    }
    setChatMessages([{ id: `assistant-${Date.now()}`, role: 'assistant', text: '想聊点什么？我在这里。' }])
    setView('chat')
  }

  async function sendChatMessage(message: string) {
    const trimmed = message.trim()
    if (!trimmed || chatBusy) return
    const stamp = Date.now()
    const loadingId = `assistant-${stamp}`
    setChatBusy(true)
    setChatMessages((current) => [
      ...current.filter((item) => !item.loading),
      { id: `user-${stamp}`, role: 'user', text: trimmed },
      { id: loadingId, role: 'assistant', text: '正在连接语言模型...', loading: true },
    ])
    setView('chat')

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ message: trimmed }),
      })
      const data = (await response.json()) as ChatResponse
      const reply = data.reply || getLocalChatFallback(trimmed)
      setChatMessages((current) => current.map((item) => (item.id === loadingId ? { ...item, text: reply, loading: false } : item)))
    } catch {
      setChatMessages((current) =>
        current.map((item) => (item.id === loadingId ? { ...item, text: getLocalChatFallback(trimmed), loading: false } : item)),
      )
    } finally {
      setChatBusy(false)
    }
  }

  function shuffleTemplates() {
    const list = visibleTemplates
    if (list.length <= 1) return
    const selectedIndex = list.findIndex((item) => item.id === selectedTemplate?.id)
    const next = list[(selectedIndex + 3 + list.length) % list.length] || list[0]
    chooseTemplate(next.id)
  }

  function openTemplateDetail(template: TemplateItem) {
    chooseTemplate(template.id)
    setView('detail')
  }

  function useSameTemplate() {
    setView('home')
    window.setTimeout(() => {
      if (!drafts[mode].file) {
        setToast('请上传你的创意图片或选择参考图')
        requestUpload()
        return
      }
      void createVideo()
    }, 0)
  }

  async function createVideo() {
    if (hasRunningTask && !isWaiting) {
      setToast('当前仅支持创作1个任务，请等待当前任务完成')
      return
    }

    if (!file) {
      setToast('请上传你的创意图片或选择参考图')
      requestUpload()
      return
    }

    if (!acceptedAgreement) {
      setShowUsageNotice(true)
      return
    }

    const targetMode = mode
    updateDraft(targetMode, { busy: true, result: null })

    const formData = new FormData()
    formData.append('image', file)
    formData.append('mode', targetMode)
    if (targetMode === 'costume') formData.append('template', costumeStyle)
    if (targetMode === 'painting') formData.append('template', paintingStyle)
    formData.append('gender', gender)

    try {
      const response = await fetch('/api/create', {
        method: 'POST',
        body: formData,
      })
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
      data = { ...data, mode: targetMode }
      updateDraft(targetMode, { result: data })
      saveWork(data)
      setView('chat')
      setChatMessages([
        { id: `user-${Date.now()}`, role: 'user', text: `使用「${selectedTemplate?.title || modeLabels[targetMode]}」发起创作` },
        { id: `assistant-${Date.now()}`, role: 'assistant', text: data.message || '任务已提交，正在为你生成专属视频。' },
      ])

      if (response.ok && data.taskId && ['queued', 'running'].includes(data.status)) {
        savePendingTask(targetMode, data)
        void pollTask(data, targetMode)
      }
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

  async function pollTask(initial: CreateResult, targetMode: ModeId) {
    if (!initial.taskId) return
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
          return
        }

        if (current.status === 'failed') {
          clearPendingTask(targetMode)
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
      updateDraft(targetMode, { polling: false })
    }
  }

  return (
    <main className={`app-shell${miguEnv.isInMiguAPP ? ' in-migu' : ''}${miguEnv.isInMiniprogram ? ' in-miniprogram' : ''}`}>
      <header className="app-topbar">
        <button className="icon-button" type="button" onClick={() => (view === 'home' ? undefined : setView('home'))} aria-label="返回首页">
          <ArrowLeft size={20} />
        </button>
        <button className="title-button" type="button" onClick={() => setShowInfo(true)}>
          <strong>AI非遗文化skill</strong>
          <Info size={14} />
        </button>
        <div className="topbar-actions">
          <span className="credit-badge">
            <Sparkles size={13} />
            999
          </span>
          <button className="works-pill" type="button" onClick={() => setView(view === 'library' ? 'home' : 'library')}>
            我的作品
          </button>
        </div>
      </header>

      {view === 'home' && (
        <HomeView
          acceptedAgreement={acceptedAgreement}
          activeMode={activeMode}
          busy={busy}
          costumeGroup={costumeGroup}
          costumeGroupItems={costumeGroups}
          file={file}
          fileRef={fileRef}
          gender={gender}
          genderItems={genderOptions}
          hasHistory={works.length > 0}
          imageReviewing={imageReviewing}
          isWaiting={isWaiting}
          mode={mode}
          modeItems={modes}
          preview={preview}
          selectedTemplate={selectedTemplate}
          templates={visibleTemplates}
          uploadHint={uploadHints[mode]}
          onAgreementChange={(accepted) => {
            if (accepted) {
              setUploadFlowPending(false)
              setShowUsageNotice(true)
            } else {
              setAcceptedAgreement(false)
            }
          }}
          onBubbleClick={handleBubbleClick}
          onChooseCostumeGroup={chooseCostumeGroup}
          onChooseFile={chooseFile}
          onChooseGender={setGender}
          onChooseMode={setMode}
          onChooseTemplate={chooseTemplate}
          onCreate={() => void createVideo()}
          onOpenCreationPanel={() => setShowCreationPanel(true)}
          onOpenTemplate={openTemplateDetail}
          onOpenLibrary={() => setView('library')}
          onRequestUpload={requestUpload}
          onShuffle={shuffleTemplates}
        />
      )}

      {view === 'detail' && selectedTemplate && (
        <TemplateDetail activeMode={activeMode} template={selectedTemplate} onBack={() => setView('home')} onUse={useSameTemplate} />
      )}

      {view === 'chat' && (
        <ChatView
          messages={chatMessages}
          mode={mode}
          result={result}
          videoUrl={videoUrl}
          polling={polling}
          topics={chatTopics}
          chatBusy={chatBusy}
          onRefresh={() => result?.taskId && void pollTask(result, mode)}
          onTopic={startNonCreativeChat}
          onSendMessage={sendChatMessage}
          onUnlockHome={() => setView('home')}
        />
      )}

      {view === 'library' && (
        <LibraryView
          drafts={drafts}
          onDelete={deleteWork}
          onClearDraft={clearDraftResult}
          onPickMode={chooseMode}
          onPublish={() => setToast('发布视频页待接入')}
          onUnlockHome={() => setView('home')}
          works={works}
        />
      )}

      {showInfo && <InfoModal onClose={() => setShowInfo(false)} />}
      {showUsageNotice && <UsageNoticeSheet onAccept={confirmUsageNotice} onClose={closeUsageNotice} />}
      {showPermissionDialog && <PermissionDialog onCancel={closePermissionDialog} onConfirm={confirmMediaPermission} />}
      {showCropSheet && (
        <CropSheet
          cropRatio={cropRatio}
          preview={preview}
          onClose={() => setShowCropSheet(false)}
          onConfirm={() => {
            setShowCropSheet(false)
            if (mode === 'costume') setToast('人脸校验已通过')
          }}
          onRatioChange={setCropRatio}
          onRequestUpload={requestUpload}
        />
      )}
      {showCreationPanel && (
        <CreationPanel
          activeMode={activeMode}
          imageReviewing={imageReviewing}
          mode={mode}
          preview={preview}
          selectedTemplate={selectedTemplate}
          templates={visibleTemplates}
          onClose={() => setShowCreationPanel(false)}
          onCreate={() => {
            setShowCreationPanel(false)
            void createVideo()
          }}
          onChooseMode={setMode}
          onPreviewImage={setPreviewImageUrl}
          onRemoveImage={removeUploadedImage}
          onRequestUpload={requestUpload}
          onSelectTemplate={chooseTemplate}
        />
      )}
      {previewImageUrl && <ImagePreviewModal src={previewImageUrl} onClose={() => setPreviewImageUrl('')} onReplace={requestUpload} />}
      {toast && <div className="toast">{toast}</div>}
    </main>
  )
}

function HomeView({
  acceptedAgreement,
  activeMode,
  busy,
  costumeGroup,
  costumeGroupItems,
  file,
  fileRef,
  gender,
  genderItems,
  hasHistory,
  imageReviewing,
  isWaiting,
  mode,
  modeItems,
  preview,
  selectedTemplate,
  templates,
  uploadHint,
  onAgreementChange,
  onBubbleClick,
  onChooseCostumeGroup,
  onChooseFile,
  onChooseGender,
  onChooseMode,
  onChooseTemplate,
  onCreate,
  onOpenCreationPanel,
  onOpenLibrary,
  onOpenTemplate,
  onRequestUpload,
  onShuffle,
}: {
  acceptedAgreement: boolean
  activeMode: ModeConfig
  busy: boolean
  costumeGroup: CostumeGroupId
  costumeGroupItems: CostumeGroupOption[]
  file: File | null
  fileRef: React.RefObject<HTMLInputElement | null>
  gender: GenderId
  genderItems: GenderOption[]
  hasHistory: boolean
  imageReviewing: boolean
  isWaiting: boolean
  mode: ModeId
  modeItems: ModeConfig[]
  preview: string
  selectedTemplate?: TemplateItem
  templates: TemplateItem[]
  uploadHint: string
  onAgreementChange: (accepted: boolean) => void
  onBubbleClick: (item: (typeof inspirationBubbles)[number]) => void
  onChooseCostumeGroup: (group: CostumeGroupId) => void
  onChooseFile: (file?: File) => void | Promise<void>
  onChooseGender: (gender: GenderId) => void
  onChooseMode: (mode: ModeId) => void
  onChooseTemplate: (id: string) => void
  onCreate: () => void
  onOpenCreationPanel: () => void
  onOpenLibrary: () => void
  onOpenTemplate: (template: TemplateItem) => void
  onRequestUpload: () => void
  onShuffle: () => void
}) {
  return (
    <section className="home-view">
      <FloatingBubbles />
      <div className="welcome-copy">
        <h1>Hi，欢迎来到AI非遗文化skill</h1>
        <p>用AI活化非遗影像，上传图片生成专属创意视频</p>
      </div>

      <button className="campaign-banner" type="button" onClick={() => window.open('#activity', '_self')}>
        <span className="gift-mark">
          <Gift size={18} />
        </span>
        <span>
          <strong>AI奇遇体验礼</strong>
          <small>活动体验期免费生成，节日模板可快速配置</small>
        </span>
        <em>立即参与</em>
      </button>

      <div className="bubble-row" aria-label="灵感气泡">
        {inspirationBubbles.map((item) => {
          const Icon = item.icon
          return (
            <button key={item.id} type="button" onClick={() => onBubbleClick(item)} className={item.mode === mode ? 'selected' : ''}>
              <Icon size={16} />
              {item.label}
            </button>
          )
        })}
      </div>

      <div className="template-section">
        <div className="section-heading">
          <span>{activeMode.name}</span>
          <button type="button" onClick={onShuffle}>
            <RefreshCw size={13} />
            换一批
          </button>
        </div>
        <TemplateCarousel
          items={templates}
          selectedId={selectedTemplate?.id || ''}
          onOpenTemplate={onOpenTemplate}
          onSelect={onChooseTemplate}
        />
      </div>

      {hasHistory && (
        <button className="history-toggle" type="button" onClick={onOpenLibrary}>
          <Library size={14} />
          点击展示历史创作
        </button>
      )}

      <div className="creation-dock">
        <div className="dock-handle" />
        <div className="mode-tabs" role="tablist" aria-label="创作类型">
          {modeItems.map((item) => {
            const Icon = item.icon
            return (
              <button key={item.id} className={item.id === mode ? 'active' : ''} onClick={() => onChooseMode(item.id)} type="button">
                <Icon size={17} />
                <span>{item.short}</span>
              </button>
            )
          })}
        </div>

        {mode === 'costume' && (
          <div className="inline-options">
            <SegmentedControl items={genderItems} selectedId={gender} onSelect={onChooseGender} />
            <SegmentedControl items={costumeGroupItems} selectedId={costumeGroup} onSelect={onChooseCostumeGroup} />
          </div>
        )}

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          onChange={(event) => {
            void onChooseFile(event.target.files?.[0])
            event.currentTarget.value = ''
          }}
          hidden
        />

        <div className="upload-preview">
          <button className="camera-button" type="button" onClick={onRequestUpload} aria-label="上传照片">
            {imageReviewing ? <Loader2 className="spin" size={20} /> : <Camera size={21} />}
          </button>
          <button className="prompt-input" type="button" onClick={onOpenCreationPanel}>
            <span>{file ? file.name : uploadHint}</span>
            {preview && <img src={preview} alt="上传预览" />}
          </button>
          <button className="send-button" type="button" onClick={onCreate} disabled={isWaiting}>
            {isWaiting ? <Loader2 className="spin" size={17} /> : <Upload size={17} />}
            {busy ? '提交中' : isWaiting ? '生成中' : '创作'}
          </button>
        </div>

        <label className="agreement-row">
          <input type="checkbox" checked={acceptedAgreement} onChange={(event) => onAgreementChange(event.target.checked)} />
          <span>已阅读并同意创作协议，确认上传内容可用于本次生成</span>
        </label>
      </div>
    </section>
  )
}

function FloatingBubbles() {
  const bubbles = ['年画', '苗绣', '宋韵', '敦煌', '茶点', '鼓楼', '壁画']

  return (
    <div className="floating-bubbles" aria-hidden="true">
      {bubbles.map((label, index) => {
        const bubbleStyle = {
          '--bubble-top': `${8 + index * 18}px`,
          '--bubble-delay': `${index * -2.2}s`,
          '--bubble-duration': `${16 + index * 1.1}s`,
        } as React.CSSProperties

        return (
          <span key={label} style={bubbleStyle}>
            {label}
          </span>
        )
      })}
    </div>
  )
}

function TemplateCarousel({
  items,
  selectedId,
  onOpenTemplate,
  onSelect,
}: {
  items: TemplateItem[]
  selectedId: string
  onOpenTemplate: (template: TemplateItem) => void
  onSelect: (id: string) => void
}) {
  const activeRef = useRef<HTMLButtonElement | null>(null)
  const railRef = useRef<HTMLDivElement | null>(null)
  const selectedIndex = Math.max(0, items.findIndex((item) => item.id === selectedId))

  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }, [selectedId])

  function step(delta: number) {
    if (!items.length) return
    const next = items[(selectedIndex + delta + items.length) % items.length]
    onSelect(next.id)
  }

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
        {items.map((item) => {
          const selected = item.id === selectedId
          return (
            <button
              key={item.id}
              ref={selected ? activeRef : undefined}
              type="button"
              className={selected ? 'template-card selected' : 'template-card'}
              onMouseEnter={() => onSelect(item.id)}
              onClick={() => {
                if (!selected) {
                  onSelect(item.id)
                  return
                }
                onOpenTemplate(item)
              }}
            >
              <TemplateMedia item={item} />
              <span>{item.subtitle || modeLabels.costume}</span>
              <strong>{item.title}</strong>
              <em>做同款</em>
            </button>
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
  activeMode,
  template,
  onBack,
  onUse,
}: {
  activeMode: ModeConfig
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
          <span>AI生成 · {activeMode.short}</span>
        </div>
      </div>
      <div className="detail-meta">
        <span>模板ID：{template.id}</span>
        <span>视频彩铃ID：ring-{template.id}</span>
        <span>模型：Seedance</span>
        <span>时长：约10秒</span>
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

function TemplateMedia({ item, className = '' }: { item: TemplateItem; className?: string }) {
  if (item.imageUrl) return <img className={className} src={item.imageUrl} alt="" />
  if (item.videoUrl) return <VideoPosterFrame src={item.videoUrl} className={className} />
  return <img className={className} src={fallbackTemplateImage} alt="" />
}

function ChatView({
  messages,
  mode,
  result,
  videoUrl,
  polling,
  topics,
  chatBusy,
  onRefresh,
  onTopic,
  onSendMessage,
  onUnlockHome,
}: {
  messages: ChatMessage[]
  mode: ModeId
  result: CreateResult | null
  videoUrl?: string
  polling: boolean
  topics: typeof chatTopics
  chatBusy: boolean
  onRefresh: () => void
  onTopic: (topic: (typeof chatTopics)[number]) => void | Promise<void>
  onSendMessage: (message: string) => void | Promise<void>
  onUnlockHome: () => void
}) {
  const [input, setInput] = useState('')
  const taskProgress = result ? getTaskProgress(result) : 0

  function submitMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const next = input.trim()
    if (!next) return
    setInput('')
    void onSendMessage(next)
  }

  return (
    <section className={result ? 'chat-view generation-view' : 'chat-view'}>
      <div className="message-list">
        {messages.map((message) => (
          <div key={message.id} className={`message ${message.role}${message.loading ? ' loading' : ''}`}>
            {message.text}
          </div>
        ))}

        {result && (
          <article className="task-card">
            <div className="task-thumb">
              {videoUrl ? (
                <PreviewVideo src={videoUrl} poster={result.posterUrl || ''} />
              ) : (
                <>
                  <Loader2 className="spin" size={24} />
                  <span>{result.status === 'failed' ? '生成失败' : 'AI视频创作中...'}</span>
                </>
              )}
            </div>
            <div className="task-info">
              <strong>{result.templateTitle || modeLabels[mode]}</strong>
              <p>{getStatusDescription(result)}</p>
              {result.status !== 'failed' && (
                <div className="task-progress" aria-label={`生成进度 ${taskProgress}%`}>
                  <span style={{ width: `${taskProgress}%` }} />
                </div>
              )}
              <p className="task-wait-hint">
                {result.status === 'succeeded' ? '视频已生成，可以预览和下载。' : '视频生成需要一定时间，请稍等。'}
              </p>
              <div className="task-actions">
                {videoUrl && (
                  <a href={videoUrl} download target="_blank" rel="noreferrer">
                    <Download size={15} />
                    下载
                  </a>
                )}
                {!videoUrl && result.taskId && (
                  <button type="button" onClick={onRefresh} disabled={polling}>
                    <RefreshCw size={15} />
                    刷新
                  </button>
                )}
              </div>
            </div>
          </article>
        )}

        <div className="try-divider">试试新创意</div>
        {topics.map((topic) => (
          <button key={topic.prompt} className="topic-chip" type="button" onClick={() => void onTopic(topic)} disabled={chatBusy}>
            {topic.prompt}
          </button>
        ))}
      </div>

      <button className="unlock-home" type="button" onClick={onUnlockHome}>
        <Wand2 size={14} />
        点击解锁更多玩法
      </button>

      <form className="chat-composer" onSubmit={submitMessage}>
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="输入你想聊的话题"
          disabled={chatBusy}
          aria-label="输入聊天内容"
        />
        <button type="submit" disabled={!input.trim() || chatBusy}>
          {chatBusy ? <Loader2 className="spin" size={17} /> : <MessageCircle size={17} />}
          发送
        </button>
      </form>
    </section>
  )
}

function VideoPosterFrame({
  src,
  poster = '',
  className = '',
  showPlay = false,
}: {
  src: string
  poster?: string
  className?: string
  showPlay?: boolean
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
          <VideoPosterFrame src={src} poster={poster} className={className} showPlay />
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
    </div>
  )
}

type SegmentItem<T extends string> = {
  id: T
  label: string
}

function SegmentedControl<T extends string>({
  items,
  selectedId,
  onSelect,
}: {
  items: SegmentItem<T>[]
  selectedId: T
  onSelect: (id: T) => void
}) {
  return (
    <div className="segmented-control">
      {items.map((item) => (
        <button key={item.id} type="button" className={selectedId === item.id ? 'selected' : ''} onClick={() => onSelect(item.id)}>
          {item.label}
        </button>
      ))}
    </div>
  )
}

function LibraryView({
  drafts,
  works,
  onClearDraft,
  onDelete,
  onPickMode,
  onPublish,
  onUnlockHome,
}: {
  drafts: Record<ModeId, ModeDraft>
  works: WorkItem[]
  onClearDraft: (mode: ModeId) => void
  onDelete: (id: string) => void
  onPickMode: (mode: ModeId) => void
  onPublish: () => void
  onUnlockHome: () => void
}) {
  const [actionRecord, setActionRecord] = useState<CreationRecord | null>(null)
  const [detailRecord, setDetailRecord] = useState<CreationRecord | null>(null)
  const [playRecord, setPlayRecord] = useState<CreationRecord | null>(null)
  const [redoRecord, setRedoRecord] = useState<CreationRecord | null>(null)
  const [deleteRecord, setDeleteRecord] = useState<CreationRecord | null>(null)
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

  return (
    <section className="library-view">
      <div className="library-titlebar">
        <button type="button" onClick={onUnlockHome} aria-label="返回首页">
          <ArrowLeft size={20} />
        </button>
        <h1>我的作品</h1>
        <span className="usage-detail">+ 100&nbsp;&nbsp;使用明细</span>
      </div>

      <div className="retention-banner">预览的AI内容保留6个月，请及时发布</div>

      <div className="library-grid-tools">
        <button type="button" aria-label="宫格视图">
          <Grid2X2 size={18} />
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
              record={record}
              onDelete={() => setDeleteRecord(record)}
              onMore={() => setActionRecord(record)}
              onOpenVideo={() => setPlayRecord(record)}
              onPublish={onPublish}
              onRedo={() => setRedoRecord(record)}
            />
          ))}
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
      {playRecord && <RecordVideoModal record={playRecord} onClose={() => setPlayRecord(null)} />}
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
    </section>
  )
}

function CreationRecordCard({
  record,
  onDelete,
  onMore,
  onOpenVideo,
  onPublish,
  onRedo,
}: {
  record: CreationRecord
  onDelete: () => void
  onMore: () => void
  onOpenVideo: () => void
  onPublish: () => void
  onRedo: () => void
}) {
  const statusClass = record.status === 'succeeded' ? 'success' : record.status === 'failed' ? 'failed' : 'running'

  return (
    <article className={`creation-record-card ${statusClass}`}>
      <div
        className="record-media"
        onClick={record.status === 'succeeded' ? onOpenVideo : undefined}
        onKeyDown={(event) => {
          if (record.status === 'succeeded' && ['Enter', ' '].includes(event.key)) onOpenVideo()
        }}
        role={record.status === 'succeeded' ? 'button' : undefined}
        tabIndex={record.status === 'succeeded' ? 0 : undefined}
      >
        {record.status === 'succeeded' && record.videoUrl ? (
          <>
            <VideoPosterFrame src={record.videoUrl} poster={record.posterUrl || ''} />
            <span className="record-play">
              <Play size={20} fill="currentColor" />
            </span>
          </>
        ) : record.status === 'failed' ? (
          <div className="record-failed-state">
            <Film size={35} />
            <strong>生成失败</strong>
            <span>{getRecordFailureMessage(record.message)}</span>
          </div>
        ) : (
          <div className="record-running-state">
            <Sparkles size={28} />
            <strong>88.8%</strong>
          </div>
        )}
        <div className="record-gradient" />
        <strong className="record-title">{record.title}</strong>
        <button
          className="record-more"
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            onMore()
          }}
          aria-label="更多操作"
        >
          <EllipsisVertical size={18} />
        </button>
      </div>

      {record.status === 'succeeded' ? (
        <div className="record-actions">
          <button type="button" onClick={onPublish}>
            发布视频
          </button>
          <button type="button" onClick={onRedo}>
            再次创作
          </button>
        </div>
      ) : record.status === 'failed' ? (
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

function RecordVideoModal({ record, onClose }: { record: CreationRecord; onClose: () => void }) {
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
    <div className="sheet-backdrop notice-backdrop" role="presentation">
      <section className="bottom-sheet notice-sheet" role="dialog" aria-modal="true" aria-labelledby="usage-notice-title">
        <div className="sheet-handle" />
        <button className="sheet-close" type="button" onClick={onClose} aria-label="关闭须知">
          <X size={18} />
        </button>
        <h2 id="usage-notice-title">{usageNoticeTitle}</h2>
        <div className="notice-copy">
          {usageNoticeParagraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
        <button className="sheet-primary" type="button" onClick={onAccept}>
          我已阅读并同意
        </button>
      </section>
    </div>
  )
}

function PermissionDialog({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="modal-backdrop soft permission-backdrop" role="presentation">
      <section className="permission-dialog" role="dialog" aria-modal="true" aria-labelledby="permission-title">
        <ShieldCheck size={24} />
        <h2 id="permission-title">请您选择照片</h2>
        <p>访问您的相机/存储，用于AI应用内容创作服务。</p>
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
  onConfirm: () => void
  onRatioChange: (ratio: CropRatio) => void
  onRequestUpload: () => void
}) {
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 })
  const pointersRef = useRef(new Map<number, { x: number; y: number }>())
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

  return (
    <div className="sheet-backdrop crop-backdrop" role="presentation">
      <section className="bottom-sheet crop-sheet" role="dialog" aria-modal="true" aria-labelledby="crop-title">
        <div className="sheet-handle" />
        <div className="crop-header">
          <button type="button" onClick={onRequestUpload}>
            重新选择
          </button>
          <h2 id="crop-title">编辑图片</h2>
          <button type="button" onClick={onConfirm}>
            确定
          </button>
        </div>
        <div
          className="crop-stage"
          onPointerCancel={handlePointerEnd}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
        >
          {preview ? (
            <img
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
          <div className={`crop-frame ratio-${cropRatio.replace(':', '-')}`}>
            <Crop size={20} />
          </div>
        </div>
        <div className="crop-options">
          <button className={cropRatio === '9:16' ? 'selected' : ''} type="button" onClick={() => onRatioChange('9:16')}>
            9:16
          </button>
          <button className={cropRatio === '1:1' ? 'selected' : ''} type="button" onClick={() => onRatioChange('1:1')}>
            1:1
          </button>
        </div>
        <p>请将人物等主体置于框内中央，可通过拖动或双指缩放裁剪图片。</p>
        <button className="sheet-secondary" type="button" onClick={onClose}>
          稍后再编辑
        </button>
      </section>
    </div>
  )
}

function CreationPanel({
  activeMode,
  imageReviewing,
  mode,
  preview,
  selectedTemplate,
  templates,
  onClose,
  onCreate,
  onChooseMode,
  onPreviewImage,
  onRemoveImage,
  onRequestUpload,
  onSelectTemplate,
}: {
  activeMode: ModeConfig
  imageReviewing: boolean
  mode: ModeId
  preview: string
  selectedTemplate?: TemplateItem
  templates: TemplateItem[]
  onClose: () => void
  onCreate: () => void
  onChooseMode: (mode: ModeId) => void
  onPreviewImage: (src: string) => void
  onRemoveImage: () => void
  onRequestUpload: () => void
  onSelectTemplate: (id: string) => void
}) {
  return (
    <div className="sheet-backdrop panel-backdrop" role="presentation">
      <section className="bottom-sheet creation-panel" role="dialog" aria-modal="true" aria-labelledby="creation-title">
        <div className="sheet-handle" />
        <button className="sheet-close" type="button" onClick={onClose} aria-label="关闭创作面板">
          <X size={18} />
        </button>
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
        <h2 id="creation-title">1. 请选择照片</h2>
        <p>提取照片，生成你的专属{activeMode.short}视频。</p>
        <div className="asset-strip">
          <button className="asset-tile upload" type="button" onClick={onRequestUpload}>
            {imageReviewing ? <Loader2 className="spin" size={20} /> : <ImageUp size={21} />}
            <span>上传图片</span>
          </button>
          {preview && (
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
          {preview && (
            <button className="asset-tile reupload" type="button" onClick={onRequestUpload}>
              <RefreshCw size={18} />
              <span>重新上传</span>
            </button>
          )}
        </div>
        <h2>2. 模板随心选</h2>
        <div className="asset-strip">
          {templates.map((item) => (
            <button
              key={item.id}
              className={item.id === selectedTemplate?.id ? 'asset-tile selected' : 'asset-tile'}
              type="button"
              onClick={() => onSelectTemplate(item.id)}
            >
              <TemplateMedia item={item} />
              {item.id === selectedTemplate?.id && <CheckBadge />}
            </button>
          ))}
        </div>
        <button className="panel-send" type="button" onClick={onCreate}>
          发送
        </button>
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

function InfoModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="info-modal" role="dialog" aria-modal="true" aria-labelledby="info-title">
        <button className="modal-close" type="button" onClick={onClose} aria-label="关闭">
          ×
        </button>
        <h2 id="info-title">应用说明</h2>
        <p>1、本服务由AI非遗文化skill提供，需要登录后方可使用。</p>
        <p>2、应用在标注“活动体验”期间无需支付使用费用；未标注“活动体验”时，使用创作服务将按AI研发与算力成本规则收费。</p>
        <button type="button" onClick={onClose}>
          知道了
        </button>
      </section>
    </div>
  )
}

function getVisibleTemplates(mode: ModeId, costumeOptions: CostumeOption[], templates: TemplateData): TemplateItem[] {
  if (mode === 'costume') {
    return costumeOptions.map(({ id, title, imageUrl, videoUrl }) => ({
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
    return Array.isArray(parsed) ? parsed.filter((item) => item.videoUrl && item.taskId) : []
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

  const workRecords = works.map((item) => ({
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

function getRecordFailureMessage(message: string) {
  if (/审核|PolicyViolation|SensitiveContent|Copyright|违规|不适合/.test(message)) return '这个内容不适合展示哦'
  if (/人数过多|火爆|500012|500013|500014|500015|500016|500017|500018|500019/.test(message)) {
    return '使用人数过多，生成失败'
  }
  if (/朗读|音频|准确率|500101/.test(message)) return '朗读内容准确率低'
  return '使用人数过多，生成失败'
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

function getStatusDescription(result: CreateResult) {
  if (result.status === 'failed') return result.message
  if (result.status === 'succeeded') return '作品已经准备好，可以预览、下载或在历史创作中再次查看。'
  if (result.status === 'running') return result.message || 'AI 正在生成约 10 秒的动态视频，关闭页面后回来也可以继续查询进度。'
  return result.message || '图片已提交，AI 正在准备创作，请稍候。'
}

function getTaskProgress(result: CreateResult) {
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

function getLocalChatFallback(message: string) {
  if (/早|上午|早上好/.test(message)) return '早上好！今天适合从一张照片开始，把非遗记忆做成会动的小短片。'
  if (/笑话|冷笑话/.test(message)) return '为什么可乐从不吵架？因为它一开口就冒泡。轻松一下，灵感也会跟着冒出来。'
  if (/幸运|数字|颜色|色/.test(message)) return '今天的幸运数是 9，幸运色是晴空蓝，刚好适合做一支 9:16 竖版视频。'
  return '收到，这个话题可以先轻松聊聊；也可以上传一张图片，我来帮你生成非遗创意短片。'
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

export default App
