export type CrawlSource = {
  id: string;
  name: string;
  url: string;
  kind: "MODEL_ARENA" | "NEWS_BROADCAST";
  category: string;
  trustLevel: "OFFICIAL" | "BENCHMARK" | "GITHUB" | "MEDIA" | "COMMUNITY";
  parser: "HTML_ARTICLE" | "SITEMAP" | "RSS" | "GITHUB_RELEASES" | "STATIC_JSON" | "LEADERBOARD_PAGE";
  enabled: boolean;
  maxItemsPerFetch: number;
  minFetchIntervalHours: number;
};

export const NEWS_BROADCAST_SOURCES: CrawlSource[] = [
  { id: "openai-news", name: "OpenAI News", url: "https://openai.com/news/rss.xml", kind: "NEWS_BROADCAST", category: "大厂AI动态", trustLevel: "OFFICIAL", parser: "RSS", enabled: true, maxItemsPerFetch: 12, minFetchIntervalHours: 24 },
  { id: "openai-changelog", name: "OpenAI Changelog", url: "https://platform.openai.com/docs/changelog", kind: "NEWS_BROADCAST", category: "大语言模型", trustLevel: "OFFICIAL", parser: "HTML_ARTICLE", enabled: true, maxItemsPerFetch: 8, minFetchIntervalHours: 24 },
  { id: "anthropic-news", name: "Anthropic News", url: "https://www.anthropic.com/news", kind: "NEWS_BROADCAST", category: "大语言模型", trustLevel: "OFFICIAL", parser: "HTML_ARTICLE", enabled: true, maxItemsPerFetch: 8, minFetchIntervalHours: 24 },
  { id: "anthropic-release-notes", name: "Anthropic Release Notes", url: "https://docs.anthropic.com/en/release-notes/overview", kind: "NEWS_BROADCAST", category: "大语言模型", trustLevel: "OFFICIAL", parser: "HTML_ARTICLE", enabled: true, maxItemsPerFetch: 8, minFetchIntervalHours: 24 },
  { id: "google-ai-blog", name: "Google AI Blog", url: "https://blog.google/technology/ai/rss/", kind: "NEWS_BROADCAST", category: "多模态模型", trustLevel: "OFFICIAL", parser: "RSS", enabled: true, maxItemsPerFetch: 12, minFetchIntervalHours: 24 },
  { id: "google-deepmind-blog", name: "Google DeepMind Blog", url: "https://deepmind.google/blog/rss.xml", kind: "NEWS_BROADCAST", category: "多模态模型", trustLevel: "OFFICIAL", parser: "RSS", enabled: true, maxItemsPerFetch: 12, minFetchIntervalHours: 24 },
  { id: "google-gemini-changelog", name: "Gemini API Changelog", url: "https://ai.google.dev/gemini-api/docs/changelog", kind: "NEWS_BROADCAST", category: "多模态模型", trustLevel: "OFFICIAL", parser: "HTML_ARTICLE", enabled: true, maxItemsPerFetch: 8, minFetchIntervalHours: 24 },
  { id: "meta-ai-blog", name: "Meta AI Blog", url: "https://ai.meta.com/blog/", kind: "NEWS_BROADCAST", category: "多模态模型", trustLevel: "OFFICIAL", parser: "HTML_ARTICLE", enabled: true, maxItemsPerFetch: 8, minFetchIntervalHours: 24 },
  { id: "mistral-news", name: "Mistral News", url: "https://mistral.ai/news/", kind: "NEWS_BROADCAST", category: "大语言模型", trustLevel: "OFFICIAL", parser: "HTML_ARTICLE", enabled: true, maxItemsPerFetch: 8, minFetchIntervalHours: 24 },
  { id: "mistral-changelog", name: "Mistral Changelog", url: "https://docs.mistral.ai/getting-started/changelog/", kind: "NEWS_BROADCAST", category: "大语言模型", trustLevel: "OFFICIAL", parser: "HTML_ARTICLE", enabled: true, maxItemsPerFetch: 8, minFetchIntervalHours: 24 },
  { id: "deepseek-news", name: "DeepSeek News", url: "https://api-docs.deepseek.com/news", kind: "NEWS_BROADCAST", category: "大语言模型", trustLevel: "OFFICIAL", parser: "HTML_ARTICLE", enabled: false, maxItemsPerFetch: 8, minFetchIntervalHours: 24 },
  { id: "qwen-blog", name: "Qwen Blog", url: "https://qwenlm.github.io/blog/index.xml", kind: "NEWS_BROADCAST", category: "开源工具", trustLevel: "OFFICIAL", parser: "RSS", enabled: true, maxItemsPerFetch: 12, minFetchIntervalHours: 24 },
  { id: "moonshot-changelog", name: "Moonshot Changelog", url: "https://platform.moonshot.cn/docs/guide/changelog", kind: "NEWS_BROADCAST", category: "大语言模型", trustLevel: "OFFICIAL", parser: "HTML_ARTICLE", enabled: true, maxItemsPerFetch: 8, minFetchIntervalHours: 24 },
  { id: "volcengine-doubao", name: "Volcengine Doubao Docs", url: "https://www.volcengine.com/docs/82379", kind: "NEWS_BROADCAST", category: "大语言模型", trustLevel: "OFFICIAL", parser: "HTML_ARTICLE", enabled: true, maxItemsPerFetch: 8, minFetchIntervalHours: 24 },
  { id: "runway-research", name: "Runway Research", url: "https://runwayml.com/research/", kind: "NEWS_BROADCAST", category: "生视频模型", trustLevel: "OFFICIAL", parser: "HTML_ARTICLE", enabled: true, maxItemsPerFetch: 8, minFetchIntervalHours: 24 },
  { id: "runway-blog", name: "Runway Blog", url: "https://runwayml.com/blog/", kind: "NEWS_BROADCAST", category: "生视频模型", trustLevel: "OFFICIAL", parser: "HTML_ARTICLE", enabled: true, maxItemsPerFetch: 8, minFetchIntervalHours: 24 },
  { id: "luma-news", name: "Luma AI News", url: "https://lumalabs.ai/news", kind: "NEWS_BROADCAST", category: "生视频模型", trustLevel: "OFFICIAL", parser: "HTML_ARTICLE", enabled: true, maxItemsPerFetch: 8, minFetchIntervalHours: 24 },
  { id: "kling-news", name: "Kling News", url: "https://www.klingai.com/global/news", kind: "NEWS_BROADCAST", category: "生视频模型", trustLevel: "OFFICIAL", parser: "HTML_ARTICLE", enabled: true, maxItemsPerFetch: 8, minFetchIntervalHours: 24 },
  { id: "stability-news", name: "Stability AI News", url: "https://stability.ai/news", kind: "NEWS_BROADCAST", category: "生图模型", trustLevel: "OFFICIAL", parser: "HTML_ARTICLE", enabled: true, maxItemsPerFetch: 8, minFetchIntervalHours: 24 },
  { id: "black-forest-labs-news", name: "Black Forest Labs News", url: "https://blackforestlabs.ai/news/", kind: "NEWS_BROADCAST", category: "生图模型", trustLevel: "OFFICIAL", parser: "HTML_ARTICLE", enabled: false, maxItemsPerFetch: 8, minFetchIntervalHours: 24 },
  { id: "replicate-blog", name: "Replicate Blog", url: "https://replicate.com/blog", kind: "NEWS_BROADCAST", category: "AI插件和网站", trustLevel: "OFFICIAL", parser: "HTML_ARTICLE", enabled: true, maxItemsPerFetch: 8, minFetchIntervalHours: 24 },
  { id: "fal-blog", name: "Fal.ai Blog", url: "https://fal.ai/blog", kind: "NEWS_BROADCAST", category: "生图模型", trustLevel: "OFFICIAL", parser: "HTML_ARTICLE", enabled: false, maxItemsPerFetch: 8, minFetchIntervalHours: 24 },
  { id: "elevenlabs-blog", name: "ElevenLabs Blog", url: "https://elevenlabs.io/blog", kind: "NEWS_BROADCAST", category: "音频生成", trustLevel: "OFFICIAL", parser: "HTML_ARTICLE", enabled: true, maxItemsPerFetch: 8, minFetchIntervalHours: 24 },
  { id: "suno-blog", name: "Suno Blog", url: "https://suno.com/blog", kind: "NEWS_BROADCAST", category: "音频生成", trustLevel: "OFFICIAL", parser: "HTML_ARTICLE", enabled: true, maxItemsPerFetch: 8, minFetchIntervalHours: 24 },
  { id: "openrouter-announcements", name: "OpenRouter Announcements", url: "https://openrouter.ai/announcements", kind: "NEWS_BROADCAST", category: "大语言模型", trustLevel: "OFFICIAL", parser: "HTML_ARTICLE", enabled: true, maxItemsPerFetch: 8, minFetchIntervalHours: 24 },
  { id: "huggingface-blog", name: "Hugging Face Blog", url: "https://huggingface.co/blog/feed.xml", kind: "NEWS_BROADCAST", category: "开源工具", trustLevel: "OFFICIAL", parser: "RSS", enabled: true, maxItemsPerFetch: 12, minFetchIntervalHours: 24 },
  { id: "huggingface-papers", name: "Hugging Face Papers", url: "https://huggingface.co/papers", kind: "NEWS_BROADCAST", category: "开源工具", trustLevel: "COMMUNITY", parser: "HTML_ARTICLE", enabled: true, maxItemsPerFetch: 8, minFetchIntervalHours: 24 },
  { id: "arxiv-ai", name: "arXiv cs.AI", url: "https://arxiv.org/list/cs.AI/recent", kind: "NEWS_BROADCAST", category: "开源工具", trustLevel: "COMMUNITY", parser: "HTML_ARTICLE", enabled: true, maxItemsPerFetch: 8, minFetchIntervalHours: 24 },
  { id: "the-verge-ai", name: "The Verge AI", url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml", kind: "NEWS_BROADCAST", category: "主流 AI 媒体", trustLevel: "MEDIA", parser: "RSS", enabled: true, maxItemsPerFetch: 12, minFetchIntervalHours: 24 },
  { id: "techcrunch-ai", name: "TechCrunch AI", url: "https://techcrunch.com/category/artificial-intelligence/feed/", kind: "NEWS_BROADCAST", category: "主流 AI 媒体", trustLevel: "MEDIA", parser: "RSS", enabled: true, maxItemsPerFetch: 12, minFetchIntervalHours: 24 },
  { id: "venturebeat-ai", name: "VentureBeat AI", url: "https://venturebeat.com/category/ai/feed/", kind: "NEWS_BROADCAST", category: "主流 AI 媒体", trustLevel: "MEDIA", parser: "RSS", enabled: true, maxItemsPerFetch: 12, minFetchIntervalHours: 24 },
  { id: "mit-tech-ai", name: "MIT Technology Review AI", url: "https://www.technologyreview.com/topic/artificial-intelligence/feed/", kind: "NEWS_BROADCAST", category: "主流 AI 媒体", trustLevel: "MEDIA", parser: "RSS", enabled: true, maxItemsPerFetch: 12, minFetchIntervalHours: 24 },
  { id: "infoq-ai", name: "InfoQ AI", url: "https://www.infoq.com/ai-ml-data-eng/", kind: "NEWS_BROADCAST", category: "主流 AI 媒体", trustLevel: "MEDIA", parser: "HTML_ARTICLE", enabled: false, maxItemsPerFetch: 8, minFetchIntervalHours: 24 },
  { id: "jiqizhixin", name: "机器之心", url: "https://www.jiqizhixin.com/", kind: "NEWS_BROADCAST", category: "中文 AI 媒体", trustLevel: "MEDIA", parser: "HTML_ARTICLE", enabled: true, maxItemsPerFetch: 8, minFetchIntervalHours: 24 },
  { id: "qbitai", name: "量子位", url: "https://www.qbitai.com/feed", kind: "NEWS_BROADCAST", category: "中文 AI 媒体", trustLevel: "MEDIA", parser: "RSS", enabled: true, maxItemsPerFetch: 12, minFetchIntervalHours: 24 },
  { id: "ithome-ai", name: "IT之家 AI", url: "https://www.ithome.com/tag/ai", kind: "NEWS_BROADCAST", category: "中文 AI 媒体", trustLevel: "MEDIA", parser: "HTML_ARTICLE", enabled: true, maxItemsPerFetch: 8, minFetchIntervalHours: 24 }
];

export const MODEL_ARENA_SOURCES: CrawlSource[] = [
  { id: "artificial-analysis-models", name: "Artificial Analysis Models", url: "https://artificialanalysis.ai/leaderboards/models", kind: "MODEL_ARENA", category: "模型综合评测", trustLevel: "BENCHMARK", parser: "LEADERBOARD_PAGE", enabled: true, maxItemsPerFetch: 80, minFetchIntervalHours: 24 },
  { id: "artificial-analysis-image", name: "Artificial Analysis Image Leaderboard", url: "https://artificialanalysis.ai/image/leaderboard/text-to-image", kind: "MODEL_ARENA", category: "生图模型", trustLevel: "BENCHMARK", parser: "LEADERBOARD_PAGE", enabled: true, maxItemsPerFetch: 50, minFetchIntervalHours: 24 },
  { id: "artificial-analysis-video", name: "Artificial Analysis Video Leaderboard", url: "https://artificialanalysis.ai/video/leaderboard/text-to-video", kind: "MODEL_ARENA", category: "生视频模型", trustLevel: "BENCHMARK", parser: "LEADERBOARD_PAGE", enabled: true, maxItemsPerFetch: 50, minFetchIntervalHours: 24 },
  { id: "lmarena", name: "LMArena", url: "https://lmarena.ai/leaderboard", kind: "MODEL_ARENA", category: "人类偏好评测", trustLevel: "BENCHMARK", parser: "LEADERBOARD_PAGE", enabled: true, maxItemsPerFetch: 120, minFetchIntervalHours: 24 },
  { id: "openrouter-models", name: "OpenRouter Models", url: "https://openrouter.ai/api/v1/models", kind: "MODEL_ARENA", category: "模型价格与参数", trustLevel: "OFFICIAL", parser: "STATIC_JSON", enabled: true, maxItemsPerFetch: 400, minFetchIntervalHours: 24 },
  { id: "huggingface-models", name: "Hugging Face Models", url: "https://huggingface.co/api/models?sort=trendingScore&limit=200", kind: "MODEL_ARENA", category: "开源模型", trustLevel: "COMMUNITY", parser: "STATIC_JSON", enabled: true, maxItemsPerFetch: 200, minFetchIntervalHours: 24 },
  { id: "opencompass", name: "OpenCompass", url: "https://opencompass.org.cn/", kind: "MODEL_ARENA", category: "中文模型评测", trustLevel: "BENCHMARK", parser: "LEADERBOARD_PAGE", enabled: false, maxItemsPerFetch: 100, minFetchIntervalHours: 24 },
  { id: "stanford-helm", name: "Stanford HELM", url: "https://crfm.stanford.edu/helm/", kind: "MODEL_ARENA", category: "学术评测", trustLevel: "BENCHMARK", parser: "LEADERBOARD_PAGE", enabled: false, maxItemsPerFetch: 100, minFetchIntervalHours: 24 },
  { id: "livebench", name: "LiveBench", url: "https://livebench.ai/", kind: "MODEL_ARENA", category: "动态语言模型评测", trustLevel: "BENCHMARK", parser: "LEADERBOARD_PAGE", enabled: false, maxItemsPerFetch: 100, minFetchIntervalHours: 24 },
  { id: "livecodebench", name: "LiveCodeBench", url: "https://livecodebench.github.io/", kind: "MODEL_ARENA", category: "代码能力评测", trustLevel: "BENCHMARK", parser: "LEADERBOARD_PAGE", enabled: false, maxItemsPerFetch: 100, minFetchIntervalHours: 24 },
  { id: "swebench", name: "SWE-bench", url: "https://www.swebench.com/", kind: "MODEL_ARENA", category: "软件工程评测", trustLevel: "BENCHMARK", parser: "LEADERBOARD_PAGE", enabled: false, maxItemsPerFetch: 100, minFetchIntervalHours: 24 },
  { id: "litellm-prices", name: "LiteLLM model prices", url: "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json", kind: "MODEL_ARENA", category: "模型价格与上下文", trustLevel: "COMMUNITY", parser: "STATIC_JSON", enabled: true, maxItemsPerFetch: 500, minFetchIntervalHours: 24 }
];
