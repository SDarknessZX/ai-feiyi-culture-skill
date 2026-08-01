# AI一图珍影

面向手机端的非遗图片活化与短视频生成平台，包含三个独立创作模块：

- 非遗换装：人物照片先经 Seedream 生成人物参考图，再由 Seedance 生成服饰短视频。
- 萌系美食：多模态语言模型识别美食并编写视频提示词，再由 Seedance 生成视频。
- 画作动起来：用户画作与统一画作提示词直接提交给 Seedance，生成约 10 秒动态视频。

## 本地运行

首次运行：

```powershell
npm.cmd install
npm.cmd run dev
```

打开 `http://localhost:5188`。后端健康检查为 `http://localhost:8790/api/health`。

生产构建：

```powershell
npm.cmd run lint
npm.cmd run build
```

双击 `一键启动公网.cmd` 会构建前端、启动 API，并通过 Serveo 临时公开 8790 端口。

## 配置

1. 将 `.env.example` 复制为 `.env`。
2. 填写 Ark 视频、图片、语言模型 API Key。
3. 填写 TOS 存储桶配置，保证模型可以访问上传图片，并长期保存生成视频。
4. 将 `MODEL_PROVIDER` 改为 `ark`。

真实密钥只放在 `.env`，不要写入源码或提交到版本库。

## 民族变装人脸检测

民族变装在发起创作前强制进行 OpenCV YuNet 人脸检测。只有返回至少一个人脸框的图片才会进入生成流程；未检测到人脸或检测服务不可用时，前后端都会阻止任务创建。

本地安装一次 Python 依赖：

```powershell
# 安装了 Python 3.11 时
py -3.11 -m pip install -r requirements-face-detect.txt

# 只有 Python 3.10 时
py -3.10 -m pip install -r requirements-face-detect.txt
```

Node 默认调用 `server/yunetFaceDetect.py`，模型使用项目内的 OpenCV 官方 `server/models/face_detection_yunet_2023mar.onnx`。Windows 会依次自动尝试 64 位 Python 3.11、3.10 和系统默认 Python 3，Linux/macOS 会尝试 `python3` 和 `python`；需要强制指定时再配置 `FACE_DETECT_PYTHON` 和 `FACE_DETECT_PYTHON_ARGS`。

同一图片的检测结果会短时缓存，前端校验通过后，`/api/create` 的服务端强校验不会重复运行模型。阈值和模型路径配置见 `.env.example`。

## AI 生成标识

生成任务成功后，后端会先完成合规处理，再归档或返回视频：

- 左下角叠加 `server/assets/migu-ai-watermark.png`，按视频宽度等比例缩放和定位；
- 在 MP4 文件头写入 `AIGC` JSON 元数据和独立的 `WATERMARKFLAG=3`；
- 从已加标识的视频生成封面，前端预览页另在右下角显示“内容由AI生成”；
- 合规处理失败时不会回退返回 Ark 的未标识临时视频。

历史归档视频可执行以下命令迁移。迁移会写入新对象并在成功后更新索引，不覆盖旧对象：

```powershell
npm.cmd run migrate:compliance
```

前端公司名称、隐私政策链接和 AIGC 生产者编号在 `.env` 中配置，字段示例见 `.env.example`。

## 提示词

- 民族服饰：`prompts/costume/*.txt`
- 华夏朝代：`prompts/dynasty/*.txt`
- 美食分析：`prompts/food/food.txt`
- 画作活化：`prompts/painting/paint.txt`
- 提示词装配与模板映射：`server/promptLibrary.js`

修改以上文件后，开发服务会自动重启。

## 主要目录

- `src/`：React 手机端界面
- `server/`：Express API、Ark/TOS 调用与作品归档
- `public/templates/`：前端模板展示图，仅保留实际使用的 WebP
- `prompts/`：后台提示词
- `generated-videos/`：TOS 归档失败时的本地视频缓存
- `server/data/works.db`：已归档作品索引
- `server/data/migu-tasks.db`：咪咕 taskId、任务状态及 Token 结算状态持久化记录，用于问题排查

`uploads/` 是运行时临时目录，图片上传完成后后端会自动删除。

## 接口

- `GET /api/health`：配置和服务状态
- `GET /api/templates`：前端模板数据
- `POST /api/face-detect`：上传图片并返回人脸框，仅民族变装使用
- `POST /api/create`：上传图片并创建后台任务
- `GET /api/tasks/:taskId`：查询生成任务和作品地址
