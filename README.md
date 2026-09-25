<a id="readme-top"></a>

<!-- [![Contributors][contributors-shield]][contributors-url] -->
[![Forks][forks-shield]][forks-url]
[![Stargazers][stars-shield]][stars-url]
[![Issues][issues-shield]][issues-url]
[![MIT License][license-shield]][license-url]
<!-- [![LinkedIn][linkedin-shield]][linkedin-url] -->


<!-- PROJECT LOGO -->
<br />
<div align="center">
  <a href="https://github.com/lfnovo/open-notebook">
    <img src="docs/assets/hero.svg" alt="Logo">
  </a>

  <h3 align="center">Open Notebook</h3>

  <p align="center">
    An open source, privacy-focused alternative to Google's Notebook LM!
    <br /><strong>Join our <a href="https://discord.gg/37XJPXfz2w">Discord server</a> for help, to share workflow ideas, and suggest features!</strong>
    <br />
    <a href="https://www.open-notebook.ai"><strong>Checkout our website »</strong></a>
    <br />
    Follow <a href="https://x.com/lfnovo">@lfnovo on X</a> for updates
    <br />
    <br />
    <a href="docs/0-START-HERE/index.md">📚 Get Started</a>
    ·
    <a href="docs/3-USER-GUIDE/index.md">📖 User Guide</a>
    ·
    <a href="docs/2-CORE-CONCEPTS/index.md">✨ Features</a>
    ·
    <a href="docs/1-INSTALLATION/index.md">🚀 Deploy</a>
  </p>
</div>

<p align="center">
<a href="https://trendshift.io/repositories/14536" target="_blank"><img src="https://trendshift.io/api/badge/repositories/14536" alt="lfnovo%2Fopen-notebook | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>
</p>

<div align="center">
  <!-- Keep these links. Translations will automatically update with the README. -->
  <a href="https://zdoc.app/de/lfnovo/open-notebook">Deutsch</a> | 
  <a href="https://zdoc.app/es/lfnovo/open-notebook">Español</a> | 
  <a href="https://zdoc.app/fr/lfnovo/open-notebook">français</a> | 
  <a href="https://zdoc.app/ja/lfnovo/open-notebook">日本語</a> | 
  <a href="https://zdoc.app/ko/lfnovo/open-notebook">한국어</a> | 
  <a href="https://zdoc.app/pt/lfnovo/open-notebook">Português</a> | 
  <a href="https://zdoc.app/ru/lfnovo/open-notebook">Русский</a> | 
  <a href="https://zdoc.app/zh/lfnovo/open-notebook">中文</a>
</div>

## A private, multi-model, 100% local, full-featured alternative to Notebook LM

![New Notebook](docs/assets/asset_list.png)

In a world dominated by Artificial Intelligence, having the ability to think 🧠 and acquire new knowledge 💡, is a skill that should not be a privilege for a few, nor restricted to a single provider.

**Open Notebook empowers you to:**
- 🔒 **Control your data** - Keep your research private and secure
- 🤖 **Choose your AI models** - Support for 18+ providers including OpenAI, Anthropic, Ollama, LM Studio, and more
- 📚 **Organize multi-modal content** - PDFs, videos, audio, web pages, and more
- 🎙️ **Generate professional podcasts** - Advanced multi-speaker podcast generation
- 🔍 **Search intelligently** - Full-text and vector search across all your content
- 💬 **Chat with context** - AI conversations powered by your research
- 🌐 **Multi-language UI** - English, Portuguese, Chinese (Simplified & Traditional), Japanese, Russian, and Bengali support

Learn more about our project at [https://www.open-notebook.ai](https://www.open-notebook.ai)

---

## 🆚 Open Notebook vs Google Notebook LM

| Feature | Open Notebook | Google Notebook LM | Advantage |
|---------|---------------|--------------------|-----------|
| **Privacy & Control** | Self-hosted, your data | Google cloud only | Complete data sovereignty |
| **AI Provider Choice** | 18+ providers (OpenAI, Anthropic, Ollama, LM Studio, etc.) | Google models only | Flexibility and cost optimization |
| **Podcast Speakers** | 1-4 speakers with custom profiles | 2 speakers only | Extreme flexibility |
| **Content Transformations** | Custom and built-in | Limited options | Unlimited processing power |
| **API Access** | Full REST API | No API | Complete automation |
| **Deployment** | Docker, cloud, or local | Google hosted only | Deploy anywhere |
| **Citations** | Basic references (will improve) | Comprehensive with sources | Research integrity |
| **Customization** | Open source, fully customizable | Closed system | Unlimited extensibility |
| **Cost** | Pay only for AI usage | Free tier + Monthly subscription | Transparent and controllable |

**Why Choose Open Notebook?**
- 🔒 **Privacy First**: Your sensitive research stays completely private
- 💰 **Cost Control**: Choose cheaper AI providers or run locally with Ollama
- 🎙️ **Better Podcasts**: Full script control and multi-speaker flexibility vs limited 2-speaker deep-dive format
- 🔧 **Unlimited Customization**: Modify, extend, and integrate as needed
- 🌐 **No Vendor Lock-in**: Switch providers, deploy anywhere, own your data

### Built With

[![Python][Python]][Python-url] [![Next.js][Next.js]][Next-url] [![React][React]][React-url] [![SurrealDB][SurrealDB]][SurrealDB-url] [![LangChain][LangChain]][LangChain-url]

## 🚀 Quick Start (2 Minutes)

### Prerequisites
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed
- That's it! (API keys configured later in the UI)

### Step 1: Get docker-compose.yml

**Option A:** Download directly
```bash
curl -o docker-compose.yml https://raw.githubusercontent.com/lfnovo/open-notebook/main/docker-compose.yml
```

**Option B:** Create the file manually
Copy this into a new file called `docker-compose.yml`:

```yaml
services:
  surrealdb:
    image: surrealdb/surrealdb:v2
    # Credentials default to root:root for a zero-config local setup. Before
    # exposing this instance to a network, set SURREAL_USER / SURREAL_PASSWORD
    # in a .env file (see .env.example) — they are applied here and to the
    # open_notebook service below, so the two always stay in sync.
    # List (exec) form so each interpolated value stays a single argument —
    # a password containing spaces would otherwise be split into several.
    command: ["start", "--log", "info", "--user", "${SURREAL_USER:-root}", "--pass", "${SURREAL_PASSWORD:-root}", "rocksdb:/mydata/mydatabase.db"]
    user: root  # Required for bind mounts on Linux
    ports:
      # Bound to localhost only: the open_notebook service reaches this over
      # the internal compose network regardless, so the host port is purely
      # for local debugging (e.g. Surrealist, `surreal sql`). Exposing this
      # on 0.0.0.0 would let anyone who can reach the host connect with the
      # default root:root credentials.
      - "127.0.0.1:8000:8000"
    volumes:
      - ./surreal_data:/mydata
    environment:
      - SURREAL_EXPERIMENTAL_GRAPHQL=true
    restart: always
    pull_policy: always

  open_notebook:
    image: lfnovo/open_notebook:v1-latest
    ports:
      - "8502:8502"  # Web UI
      - "5055:5055"  # REST API
    environment:
      # REQUIRED: Change this to your own secret string
      # This encrypts your API keys in the database
      - OPEN_NOTEBOOK_ENCRYPTION_KEY=change-me-to-a-secret-string

      # Database connection. SURREAL_USER / SURREAL_PASSWORD default to root:root
      # for local use; override them in a .env file before exposing the instance
      # (the same values configure the surrealdb service above).
      - SURREAL_URL=ws://surrealdb:8000/rpc
      - SURREAL_USER=${SURREAL_USER:-root}
      - SURREAL_PASSWORD=${SURREAL_PASSWORD:-root}
      - SURREAL_NAMESPACE=open_notebook
      - SURREAL_DATABASE=open_notebook
    volumes:
      - ./notebook_data:/app/data
    depends_on:
      - surrealdb
    restart: always
    pull_policy: always
```

### Step 2: Set Your Encryption Key
Edit `docker-compose.yml` and change this line:
```yaml
- OPEN_NOTEBOOK_ENCRYPTION_KEY=change-me-to-a-secret-string
```
to any secret value (e.g., `my-super-secret-key-123`)

### Step 3: Start Services
```bash
docker compose up -d
```

Wait 15-20 seconds, then open: **http://localhost:8502**

### Step 4: Configure AI Provider
1. Go to **Models** and choose your provider (OpenAI, Anthropic, Google, etc.)
2. Click **+ Add Configuration**
3. Paste your API key and other info as needed and click **Add Configuration**
4. Click **Test** to test connection
5. Click **Sync Models** and check models to include
6. Under **Default Model Assignments**, click **Auto-Assign Defaults** or manually specify which models to use for what 

Done! You're ready to create your first notebook.

> **Need an API key?** Get one from:
> [OpenAI](https://platform.openai.com/api-keys) · [Anthropic](https://console.anthropic.com/) · [Google](https://aistudio.google.com/) · [Groq](https://console.groq.com/) (free tier)

> **Want free local AI?** See [examples/docker-compose-ollama.yml](examples/) for Ollama setup

---

### 📚 More Installation Options

- **[With Ollama (Free Local AI)](examples/docker-compose-ollama.yml)** - Run models locally without API costs
- **[From Source (Developers)](docs/1-INSTALLATION/from-source.md)** - For development and contributions
- **[Complete Installation Guide](docs/1-INSTALLATION/index.md)** - All deployment scenarios

---

### 📖 Need Help?

- **🤖 AI Installation Assistant**: [CustomGPT to help you install](https://chatgpt.com/g/g-68776e2765b48191bd1bae3f30212631-open-notebook-installation-assistant)
- **🆘 Troubleshooting**: [5-minute troubleshooting guide](docs/6-TROUBLESHOOTING/quick-fixes.md)
- **💬 Community Support**: [Discord Server](https://discord.gg/37XJPXfz2w)
- **🐛 Report Issues**: [GitHub Issues](https://github.com/lfnovo/open-notebook/issues)

---

## Star History

[![Star History Chart](https://star-history.dera.page/svg?repos=lfnovo/open-notebook&type=date&legend=top-left)](https://star-history.dera.page/#lfnovo/open-notebook&type=date&legend=top-left)


## Provider Support Matrix

Thanks to the [Esperanto](https://github.com/lfnovo/esperanto) library, we support this providers out of the box!

| Provider     | LLM Support | Embedding Support | Speech-to-Text | Text-to-Speech |
|--------------|-------------|------------------|----------------|----------------|
| OpenAI       | ✅          | ✅               | ✅             | ✅             |
| Anthropic    | ✅          | ❌               | ❌             | ❌             |
| Groq         | ✅          | ❌               | ✅             | ❌             |
| Google (GenAI) | ✅          | ✅               | ✅             | ✅             |
| Vertex AI    | ✅          | ✅               | ❌             | ✅             |
| Ollama       | ✅          | ✅               | ❌             | ❌             |
| oMLX         | ✅          | ✅               | ❌             | ❌             |
| Perplexity   | ✅          | ❌               | ❌             | ❌             |
| ElevenLabs   | ❌          | ❌               | ✅             | ✅             |
| Deepgram     | ❌          | ❌               | ✅             | ✅             |
| Azure OpenAI | ✅          | ✅               | ✅             | ✅             |
| Mistral      | ✅          | ✅               | ✅             | ✅             |
| DeepSeek     | ✅          | ❌               | ❌             | ❌             |
| Cohere       | ✅          | ✅               | ❌             | ❌             |
| Voyage       | ❌          | ✅               | ❌             | ❌             |
| xAI          | ✅          | ❌               | ❌             | ✅             |
| OpenRouter   | ✅          | ✅               | ✅             | ✅             |
| DashScope (Qwen) | ✅          | ❌               | ❌             | ❌             |
| MiniMax      | ✅          | ❌               | ❌             | ❌             |
| Novita       | ✅          | ❌               | ❌             | ❌             |
| PayPerQ (PPQ) | ✅          | ✅               | ✅             | ✅             |
| OpenAI Compatible* | ✅          | ✅               | ✅             | ✅             |

*Supports LM Studio and any OpenAI-compatible endpoint. Prefer the native **oMLX** provider for [oMLX](https://omlx.ai/) (Apple Silicon); see [docs/5-CONFIGURATION/omlx.md](docs/5-CONFIGURATION/omlx.md).

## ✨ Key Features

### Core Capabilities
- **🔒 Privacy-First**: Your data stays under your control - no cloud dependencies
- **🎯 Multi-Notebook Organization**: Manage multiple research projects seamlessly
- **📚 Universal Content Support**: PDFs, videos, audio, web pages, Office docs, and more
- **🤖 Multi-Model AI Support**: 18+ providers including OpenAI, Anthropic, Ollama, Google, LM Studio, and more
- **🎙️ Professional Podcast Generation**: Advanced multi-speaker podcasts with Episode Profiles
- **🔍 Intelligent Search**: Full-text and vector search across all your content
- **💬 Context-Aware Chat**: AI conversations powered by your research materials
- **📝 AI-Assisted Notes**: Generate insights or write notes manually

### Advanced Features
- **⚡ Reasoning Model Support**: Full support for thinking models like DeepSeek-R1 and Qwen3
- **🔧 Content Transformations**: Powerful customizable actions to summarize and extract insights
- **🌐 Comprehensive REST API**: Full programmatic access for custom integrations [![API Docs](https://img.shields.io/badge/API-Documentation-blue?style=flat-square)](http://localhost:5055/docs)
- **🔐 Optional Password Protection**: Secure public deployments with authentication
- **📊 Fine-Grained Context Control**: Choose exactly what to share with AI models
- **📎 Citations**: Get answers with proper source citations


## Podcast Feature

[![Check out our podcast sample](https://img.youtube.com/vi/D-760MlGwaI/0.jpg)](https://www.youtube.com/watch?v=D-760MlGwaI)

## 📚 Documentation

### Getting Started
- **[📖 Introduction](docs/0-START-HERE/index.md)** - Learn what Open Notebook offers
- **[⚡ Quick Start with OpenAI](docs/0-START-HERE/quick-start-openai.md)** - Get up and running in 5 minutes
- **[🔧 Installation](docs/1-INSTALLATION/index.md)** - Comprehensive setup guide
- **[🎯 Run It Fully Local](docs/0-START-HERE/quick-start-local.md)** - Ollama/LM Studio, completely private

### User Guide
- **[📱 Interface Overview](docs/3-USER-GUIDE/interface-overview.md)** - Understanding the layout
- **[📚 Notebooks, Sources & Notes](docs/2-CORE-CONCEPTS/notebooks-sources-notes.md)** - Organizing your research
- **[📄 Adding Sources](docs/3-USER-GUIDE/adding-sources.md)** - Managing content types
- **[📝 Working with Notes](docs/3-USER-GUIDE/working-with-notes.md)** - Creating and managing notes
- **[💬 Chatting Effectively](docs/3-USER-GUIDE/chat-effectively.md)** - AI conversations
- **[🔍 Search](docs/3-USER-GUIDE/search.md)** - Finding information

### Advanced Topics
- **[🎙️ Podcast Generation](docs/2-CORE-CONCEPTS/podcasts-explained.md)** - Create professional podcasts
- **[🔧 Content Transformations](docs/3-USER-GUIDE/transformations.md)** - Customize content processing
- **[🤖 AI Models](docs/4-AI-PROVIDERS/index.md)** - AI model configuration
- **[🔌 MCP Integration](docs/5-CONFIGURATION/mcp-integration.md)** - Connect with Claude Desktop, VS Code and other MCP clients
- **[🔧 REST API Reference](docs/7-DEVELOPMENT/api-reference.md)** - Complete API documentation
- **[🔐 Security](docs/5-CONFIGURATION/security.md)** - Password protection and privacy
- **[🚀 Deployment](docs/1-INSTALLATION/index.md)** - Complete deployment guides for all scenarios
- **[🧭 Vision & Principles](VISION.md)** - What Open Notebook is, and where it's going
- **[🛠️ Developer Docs](docs/7-DEVELOPMENT/index.md)** - Architecture, setup, contributing, decision records

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## 🗺️ Roadmap

### Upcoming Features
- **Live Front-End Updates**: Real-time UI updates for smoother experience
- **Async Processing**: Faster UI through asynchronous content processing
- **Cross-Notebook Sources**: Reuse research materials across projects
- **Bookmark Integration**: Connect with your favorite bookmarking apps

### Recently Completed ✅
- **Next.js Frontend**: Modern React-based frontend with improved performance
- **Comprehensive REST API**: Full programmatic access to all functionality
- **Multi-Model Support**: 18+ AI providers including OpenAI, Anthropic, Ollama, LM Studio
- **Advanced Podcast Generator**: Professional multi-speaker podcasts with Episode Profiles
- **Content Transformations**: Powerful customizable actions for content processing
- **Enhanced Citations**: Improved layout and finer control for source citations
- **Multiple Chat Sessions**: Manage different conversations within notebooks

Explore [GitHub Discussions](https://github.com/lfnovo/open-notebook/discussions/categories/ideas) for proposed features and product ideas, and [open Issues](https://github.com/lfnovo/open-notebook/issues) for known bugs and approved work.

<p align="right">(<a href="#readme-top">back to top</a>)</p>


## 📖 Need Help?
- **🤖 AI Installation Assistant**: We have a [CustomGPT built to help you install Open Notebook](https://chatgpt.com/g/g-68776e2765b48191bd1bae3f30212631-open-notebook-installation-assistant) - it will guide you through each step!
- **New to Open Notebook?** Start with our [Getting Started Guide](docs/0-START-HERE/index.md)
- **Need installation help?** Check our [Installation Guide](docs/1-INSTALLATION/index.md)
- **Want to see it in action?** Try our [Quick Start Tutorial](docs/0-START-HERE/index.md)

## 🤝 Community & Contributing

### Join the Community
- 💬 **[Discord Server](https://discord.gg/37XJPXfz2w)** - Get help, share ideas, and connect with other users
- 𝕏 **[Follow @lfnovo on X](https://x.com/lfnovo)** - Project updates and news from the maintainer
- 💡 **[GitHub Discussions](https://github.com/lfnovo/open-notebook/discussions)** - Ask questions and shape features, product direction, design, and architecture
- 🐛 **[GitHub Issues](https://github.com/lfnovo/open-notebook/issues)** - Report reproducible bugs and find approved work
- ⭐ **Star this repo** - Show your support and help others discover Open Notebook

### Contributing
We welcome contributions! We're especially looking for help with:
- **Frontend Development**: Help improve our modern Next.js/React UI
- **Testing & Bug Fixes**: Make Open Notebook more robust
- **Feature Development**: Build the coolest research tool together
- **Documentation**: Improve guides and tutorials

**Current Tech Stack**: Python, FastAPI, Next.js, React, SurrealDB
**Future Roadmap**: Real-time updates, enhanced async processing

See our [Contributing Guide](CONTRIBUTING.md) for detailed information on how to get started, including our guidelines for [AI-assisted contributions](docs/7-DEVELOPMENT/contributing.md#ai-assisted-and-agent-generated-prs). To understand what we're building (and what we'll say no to), read [VISION.md](VISION.md).

<p align="right">(<a href="#readme-top">back to top</a>)</p>


## 📄 License

Open Notebook is MIT licensed. See the [LICENSE](LICENSE) file for details.


**Community Support**:
- 💬 [Discord Server](https://discord.gg/37XJPXfz2w) - Get help, share ideas, and connect with users
- 𝕏 [Follow @lfnovo on X](https://x.com/lfnovo) - Project updates and news from the maintainer
- 💡 [GitHub Discussions](https://github.com/lfnovo/open-notebook/discussions) - Ask questions and shape ideas
- 🐛 [GitHub Issues](https://github.com/lfnovo/open-notebook/issues) - Report reproducible bugs and find approved work
- 🌐 [Website](https://www.open-notebook.ai) - Learn more about the project

<p align="right">(<a href="#readme-top">back to top</a>)</p>


<!-- MARKDOWN LINKS & IMAGES -->
<!-- https://www.markdownguide.org/basic-syntax/#reference-style-links -->
[contributors-shield]: https://img.shields.io/github/contributors/lfnovo/open-notebook.svg?style=for-the-badge
[contributors-url]: https://github.com/lfnovo/open-notebook/graphs/contributors
[forks-shield]: https://img.shields.io/github/forks/lfnovo/open-notebook.svg?style=for-the-badge
[forks-url]: https://github.com/lfnovo/open-notebook/network/members
[stars-shield]: https://img.shields.io/github/stars/lfnovo/open-notebook.svg?style=for-the-badge
[stars-url]: https://github.com/lfnovo/open-notebook/stargazers
[issues-shield]: https://img.shields.io/github/issues/lfnovo/open-notebook.svg?style=for-the-badge
[issues-url]: https://github.com/lfnovo/open-notebook/issues
[license-shield]: https://img.shields.io/github/license/lfnovo/open-notebook.svg?style=for-the-badge
[license-url]: https://github.com/lfnovo/open-notebook/blob/master/LICENSE.txt
[linkedin-shield]: https://img.shields.io/badge/-LinkedIn-black.svg?style=for-the-badge&logo=linkedin&colorB=555
[linkedin-url]: https://linkedin.com/in/lfnovo
[product-screenshot]: images/screenshot.png
[Next.js]: https://img.shields.io/badge/Next.js-000000?style=for-the-badge&logo=next.js&logoColor=white
[Next-url]: https://nextjs.org/
[React]: https://img.shields.io/badge/React-61DAFB?style=for-the-badge&logo=react&logoColor=black
[React-url]: https://reactjs.org/
[Python]: https://img.shields.io/badge/Python-3776AB?style=for-the-badge&logo=python&logoColor=white
[Python-url]: https://www.python.org/
[LangChain]: https://img.shields.io/badge/LangChain-3A3A3A?style=for-the-badge&logo=chainlink&logoColor=white
[LangChain-url]: https://www.langchain.com/
[SurrealDB]: https://img.shields.io/badge/SurrealDB-FF5E00?style=for-the-badge&logo=databricks&logoColor=white
[SurrealDB-url]: https://surrealdb.com/

---

## 本地定制记录

> 本节为本地 fork 的定制改动记录，合并上游时请保留本节。每批改动完成后在此追加一条。

### 2026-09-22：向量化参数设置页
设置页"嵌入与搜索"新增 4 个向量化参数（分块大小/重叠/最小块/批量），DB>环境变量>默认值动态生效，改后免重启。涉及：open_notebook/utils/embedding_config.py、api/routers/settings.py、SettingsForm.tsx。

### 2026-09-22：智谱 provider 与 DashScope 域名支持
新增智谱（Zhipu BigModel）供应商（国内版，credential base_url 可切 Coding Plan 域名）；DashScope 百炼专属域名文档与 credential 模型发现修复。涉及：open_notebook/ai/provider_registry.py、open_notebook/ai/__init__.py、api/credentials_service.py。

### 2026-09-22：嵌入进度与 Token 统计
source 嵌入改为按批落库，详情页实时进度（x/y 块）+失败可见；新增全模型 token 用量统计（设置页 Usage 子页，LLM 全计+embedding 估算，可关闭可清空）。涉及：commands/embedding_commands.py、open_notebook/ai/usage.py、SourceEmbeddingProgress.tsx、settings/usage/。

### 2026-09-22：处理管道分步可视化
源详情页新增 4 步处理管道 stepper（提取/嵌入/洞察转换/完成），各步独立状态与进度，失败步可就地重试。涉及：api/routers/sources.py、api/models.py、SourceProcessingSteps.tsx。

### 2026-09-22：外观主题切换
设置页新增外观卡片，支持主题切换（会话前已有的本地定制，补记录）。涉及：AppearanceCard.tsx、theme-store.ts、theme-script.ts、ThemeProvider.tsx。

### 2026-09-22：Token 用量页仪表盘化
设置页 Usage 子页改为仪表盘风格（参考 Claude 用量页）：引入 recharts，新增按模型分色的每日趋势折线、模型占比环形图（中心总量+百分比图例）、近半年 GitHub 风格热力图、大数字汇总卡（智能单位）、7/30/90 天范围切换；后端 summary 接口新增日×模型聚合。涉及：api/usage_service.py、frontend/src/components/usage/、settings/usage/page.tsx。

### 2026-09-22：对话回车发送开关与嵌入未完成提醒
对话输入区新增「回车发送」持久化开关（默认关；开启后 Enter 发送、Shift+Enter 换行，含中文输入法/Safari 选词防误发），关闭时维持 Cmd/Ctrl+Enter 发送且页面写明；笔记来源卡片在嵌入失败/部分/未嵌入时右侧显示红色提醒，点击跳转详情页重新嵌入。涉及：ChatPanel.tsx、chat-preferences-store.ts、SourceCard.tsx。

### 2026-09-22：转换规则双语显示与聊天引用显示标题
6 条预置转换规则显示为「英文（中文）」（如 Dense Summary（稠密摘要），自建规则原样）；AI 回复底部引用列表由 source:id 改为显示来源标题（无标题回退文件名），新增 GET /api/sources/titles 批量查询端点。涉及：transformation-display.ts、source-references.tsx、api/routers/sources.py。

### 2026-09-23：一键重新嵌入与来源多视图分组
来源页新增「一键嵌入全部未完成」（missing 模式原子认领防重复提交，下方实时排队进度，可捞回卡死状态）；来源新增多视图分组体系（迁移 29）：文件类型（按文件后缀分组 PDF/DOCX/EXCEL 等，固定只读）/ AI 内容分类（向量聚类+一次 LLM 命名，约 2k token）/ AI 文件名分类 / 自定义四个独立视图，分组可嵌套（深度 5），支持多选批量移动/复制（深拷贝含向量零 token）/级联删除，笔记本来源列同步分组导航。涉及：embedding_commands.py、classification_commands.py、clustering.py、source_group_service.py、SourceViewTabs/GroupTree/BulkActionBar。

### 2026-09-23：数据导出/导入
新增整库打包导出与导入（`/settings/data` 入口）：笔记本/来源/笔记/洞察/转换规则/视图分组/向量/上传文件导出为单个 zip（manifest 严格校验+sha256，凭据与 command 表物理排除），导入按 id 整条跳过实现幂等（同包连导两次零写入，绝不覆盖已有数据），文件流式解压+哈希校验后重写 asset 路径，进度走 data_transfer_state 表（迁移 30）实时轮询。注意：新增命令模块 data_transfer_commands.py 需重启 surreal-commands-worker 才会注册。涉及：commands/data_transfer_commands.py、api/data_transfer_service.py、api/routers/data_transfer.py。

### 2026-09-23：来源文件夹操作补全与术语更名、笔记本新增来源可选目标文件夹
来源页补全文件管理器操作全集：行内重命名/移动/复制/移出/删除菜单、批量规则重命名（前缀/后缀/查找替换）与批量删除、当前位置面包屑、行拖拽入夹与文件夹拖拽调层级、Shift 范围勾选；「分组」术语统一更名「文件夹」（14 语言）；添加来源对话框新增可选目标文件夹（创建后两步入组，非原子由前端警示兜底）。后端经逐一对照零改动：所需端点与深度/环/重名校验均已存在（无迁移、无新命令、无需重启 worker）。涉及：frontend/src/app/(dashboard)/sources/page.tsx、frontend/src/components/sources/、frontend/src/lib/locales/。

### 2026-09-24：来源/文件夹右键菜单（重命名、新建文件夹、移动到文件夹）
笔记本详情页来源卡片、/sources 页表格行、GroupTree 文件夹节点三处新增右键菜单（打开/重命名/移动到文件夹/新建文件夹等，一套内容组件复用）；移动弹窗 GroupPickerDialog 支持内联即时新建文件夹并自动选中（顺带修复零文件夹时确认键永久禁用的死局）；SourceCard ⋮ 菜单同步补齐三项防两入口能力漂移；引入 @radix-ui/react-context-menu。后端零改动：所需端点（PUT /sources/{id}、views/groups CRUD、POST /groups/{gid}/members|copy、POST /views/{vid}/ungroup）均已存在且测试覆盖，source.title 的 BM25 索引随写入自动维护。涉及：frontend/src/components/ui/context-menu.tsx、frontend/src/components/sources/、frontend/src/app/(dashboard)/notebooks/components/SourcesColumn.tsx、frontend/src/lib/locales/。

### 2026-09-24：来源视图家族化与笔记本页文件夹条目区（文件浏览器范式统一）
「视图」术语从用户可见文案退场：/sources 页标签区改三段家族（我的文件夹/✨AI 自动分类/按文件类型，段下常驻解释 hint，AI 段前置"重新分类会覆盖手动调整"警示）；笔记本页来源列「视图+文件夹」双下拉简化为单下拉「整理方式」（选项按家族分组），选定后卡片列表上方新增文件夹条目区 FolderRail（空文件夹也显示、计数徽章含 0，位于滚动容器外不影响分页/无限滚动）+ 面包屑，与 /sources 页共享 GroupTree 数据层、右键菜单、弹窗状态机（use-group-dialogs）；新建文件夹弹窗显示落点路径与同级夹列表、重名即时禁用；未选视图时新建自动落 custom 视图并切入高亮（修复此前静默落进 AI Content、Re-classify 一跑即被覆盖）；同级重名的后端英文报错映射为中文提示；AI 视图显示名改「按内容/按文件名」（走 displayViewName i18n 间接层，DB 名不动）。后端零改动（本批逐一复核）：views/groups CRUD、move/copy/ungroup、classify 与防环/深度≤5/重名校验均已存在，重名错误串在 create/update 两处一致（api/source_group_service.py:234,266），group_id 筛选为直接成员精确匹配（api/routers/sources.py:582-586）；无迁移、无新命令、无需重启 worker。涉及：frontend/src/app/(dashboard)/notebooks/components/SourcesColumn.tsx、frontend/src/app/(dashboard)/sources/page.tsx、frontend/src/components/sources/（FolderRail/GroupBadge/use-group-dialogs/SourceViewTabs/GroupTree/GroupNameDialog）、frontend/src/lib/utils/error-handler.ts、frontend/src/lib/locales/。

### 2026-09-23：Token 用量页改版（后端口径修正）
用量汇总接口按请求时区切日：summary 新增 tz_offset 参数（分钟，JS 符号，UTC+8 传 480），day 桶与窗口边界从 UTC 日改为本地日（写入侧 day 字段仍按 UTC，明细展示用 created 本地化，两种日界自此统一）；新增 previous_totals 上一等长周期聚合（环比）与 totals/by_model 的 estimated_tokens（embedding 估算量在聚合位可见）；WHERE 条件由 day 字符串比较改为 created 时间戳阈值。写入侧、明细与清空接口、worker 均无改动。涉及：api/usage_service.py、api/routers/usage.py、api/models.py、tests/test_usage_api.py。

### 2026-09-24：字体自托管（构建离线化）
next build 生产构建需联网拉 Google Fonts，本机直连不通导致构建失败（门禁无代理环境必挂）。5 个字体（Instrument Sans/Bricolage Grotesque/Spline Sans Mono/Geist/Geist Mono）改为本地 latin variable woff2 自托管，layout.tsx 从 next/font/google 切到 next/font/local，variable 名与权重范围保持不变（视觉零变化，display 补显式 swap 与原默认一致），构建从此离线可跑。涉及：frontend/src/app/layout.tsx、frontend/src/app/fonts/。

### 2026-09-24：文件夹体验第 1 轮评审修复（两页范式对齐）
修复评审发现：命名弹窗 onConfirm 现真正返回 Promise（后端拒绝时保持打开可重试，两页建夹/重命名改 mutateAsync）；右键内联新建子夹成功后有落点 toast（「已在『父夹』内创建…」）；笔记本页浏览中的视图/文件夹被他页删除时自动回退根层/全部视图（不再卡幽灵位置）；深度上限前端三道防线（建夹入口限深禁用、移动弹窗按"目标深度+子树高>5"预置灰、后端 400 映射中文）+ MAX_GROUP_DEPTH 前端常量统一到 group-tree.ts；/sources 新建文件夹落点改为当前浏览文件夹（与笔记本页文件浏览器语义一致，弹窗落点提示/同级列表同步）；笔记本来源列表加 keepPreviousData（进出文件夹不再整列闪 loading）；移动弹窗空文件夹也显示 0 计数；无自定义视图的全新用户右键建夹自动先创建「我的文件夹」视图（绝不落进会被 AI 重分类覆盖的视图）；高亮计时改为新夹渲染出来后才开始；zh-CN/zh-TW/en-US 清掉 aiOverwriteHint 与重分类确认里的「视图」措辞（改「文件夹集」）。后端零改动。涉及：frontend/src/components/sources/（GroupDialogs/FolderRail/GroupTree/GroupPickerDialog/folder-parity.test）、frontend/src/app/(dashboard)/notebooks/components/SourcesColumn.tsx、frontend/src/app/(dashboard)/sources/page.tsx、frontend/src/lib/（hooks/use-sources.ts、utils/group-tree.ts、utils/error-handler.ts、locales/×14）。

### 2026-09-25：笔记本页双列文件管理器交互与添加来源文件夹预填
彻底重构笔记本详情页交互：废除原来源列内下拉框与大瓷砖网格遮盖卡片的繁琐交互，改为经典双列文件管理器范式。左侧新增独立可折叠的文件夹侧栏列 FoldersColumn（树形层级、数量徽章、增删改查菜单、视图切换、支持 w-60/w-12 独立收起），右侧来源列 SourcesColumn 始终直观展示对应来源卡片，点击左侧文件夹即时联动过滤并展示面包屑导航；添加来源对话框第 1 步前置曝光折叠条 FolderTargetSection，直观展示目标文件夹并支持直接修改，在特定文件夹下添加时自动预填上下文，填完 URL/文件后在第 1 步直接点完成即可落盘归档；空文件夹显示空态引导按钮。涉及：frontend/src/app/(dashboard)/notebooks/components/（FoldersColumn.tsx、SourcesColumn.tsx）、frontend/src/components/sources/（FolderTargetSection.tsx、AddSourceDialog.tsx）、notebook-columns-store.ts。

### 2026-09-25：数据导出包包含系统设置与提示词配置
完善数据备份与容灾：将通用系统设置 `open_notebook:content_settings`（处理引擎、向量化切块参数、Docling OCR/公式/视觉开关、Token 审计开关等）与全局自定义提示词 `open_notebook:default_prompts` 纳入数据导出与导入链路（分别生成 data/content_settings.ndjson 与 data/default_prompts.ndjson），导入时通过 UPSERT MERGE 安全还原合并，保持向后兼容老版本导出包，且物理隔离私有凭据。涉及：commands/data_transfer_commands.py、tests/test_data_transfer_commands.py。

---

## 后续体验优化与新功能规划路线图 (Roadmap)

> 基于多维度工程与交互体检提炼，聚焦本地优先、隐私友好与知识研读体验，待后续逐步落地实现。

### 1. 数据管理与备份体验增强
- [ ] **导出包体积预估与文件明细预览（Export Size Estimation）**：在点击开始导出前，自动扫描统计当前项目附件大小、向量总数与文本体积，实时展示“预估压缩包体积（如 ~18.5 MB）”与文件清单，让备份心中有底。
- [ ] **流式分块下载与实时百分比进度（Progressive Download with Percentage）**：解决大文件导出包下载时仅有转圈菊花的问题，通过流式进度监听展示实时下载速率、已下载字节与百分比进度条（如 `已下载 12.4 MB / 18.5 MB (67%)`）。
- [ ] **按笔记本维度的模块化导出/分享（.onbook 课题包）**：支持勾选单个或多个笔记本进行针对性导出（包含对应的来源、笔记、向量和自定义文件夹结构），便于不同设备间迁移特定研究课题、分享轻量知识包或执行项目休眠归档。
- [ ] **大包断点续传与解除 100MB 限制（Chunked Upload & Resume）**：重构大包导入逻辑，引入分片哈希校验与断点续传接口，彻底解除 100MB 单请求体限制，提升在弱网与超大知识库场景下的导入成功率。

### 2. 深度研读与知识探索体验
- [ ] **精确段落引用高亮与原文跳跃（Deep Citation Highlighting）**：将 AI 回答底部的文档级粗粒度引用升级为段落级引文锚点，点击引用标签直接在原 PDF 或文本对应页码精准高亮显示依据，大幅降低长文查证成本。
- [ ] **多来源对比研读与结构化脑图生成（Source Comparison & Mindmap）**：支持多选指定来源一键提取核心异同点、自动提炼结构化思维导图（Mindmap）与大纲，辅助论文精读与考试备考。
- [ ] **音频速记与播客转写批注增强**：提升音频/播客转写文字的段落结构化排版，支持在播放时词句级高亮联动与一键摘录进笔记。
