import type { CreationMode, PromptOptimization, PromptTemplate } from "@gw-link-omniai/shared";

export interface StudioModeContent {
  mode: CreationMode;
  title: string;
  description: string;
  promptLabel: string;
  promptPlaceholder: string;
}

const studioModes: StudioModeContent[] = [
  {
    mode: "text",
    title: "文本创作",
    description: "把创作需求整理成清晰、可执行的文本提示词。",
    promptLabel: "文本创作需求",
    promptPlaceholder: "例如：帮我写一个咖啡店新品发布文案"
  },
  {
    mode: "image",
    title: "图片创作",
    description: "把视觉目标拆解为主体、场景、风格和构图。",
    promptLabel: "图片创作需求",
    promptPlaceholder: "例如：做一张咖啡店新品海报"
  },
  {
    mode: "video",
    title: "视频创作",
    description: "把短视频想法拆解为主体、动作、镜头和约束。",
    promptLabel: "视频创作需求",
    promptPlaceholder: "例如：生成一段咖啡拉花短视频"
  }
];

const promptTemplates: PromptTemplate[] = [
  {
    id: "text-copywriting",
    mode: "text",
    name: "文案创作",
    description: "整理目标、受众、语气、格式和约束",
    tags: ["copywriting", "brief"]
  },
  {
    id: "image-poster",
    mode: "image",
    name: "商业海报",
    description: "拆解主体、场景、风格、构图和负向提示词",
    tags: ["poster", "visual"]
  },
  {
    id: "video-short",
    mode: "video",
    name: "短视频镜头",
    description: "拆解主体、动作、镜头运动、场景变化和负向约束",
    tags: ["short-video", "motion"]
  }
];

const fixtureOptimizations: Record<CreationMode, PromptOptimization> = {
  text: {
    id: "fixture-text-optimization",
    mode: "text",
    originalPrompt: "帮我写一个咖啡店新品发布文案",
    optimizedPrompt: "请围绕咖啡店新品发布，生成一段面向年轻消费者的新品推广文案，语气温暖、有画面感。",
    sections: [
      { label: "写作目标", value: "发布咖啡店新品并吸引到店尝试" },
      { label: "目标受众", value: "喜欢精品咖啡与社交分享的年轻消费者" },
      { label: "语气风格", value: "温暖、轻盈、有生活感" },
      { label: "输出格式", value: "标题、短正文和行动引导" },
      { label: "关键约束", value: "避免夸张承诺，保留新品卖点" }
    ],
    preset: {
      modelId: "recommended-text",
      parameters: {
        outputFormat: "markdown",
        tone: "warm"
      },
      creditEstimate: { credits: 1, unit: "credit" }
    },
    createdAt: "2026-06-19T00:00:00.000Z"
  },
  image: {
    id: "fixture-image-optimization",
    mode: "image",
    originalPrompt: "做一张咖啡店新品海报",
    optimizedPrompt: "制作一张咖啡店新品商业海报，主体为新品咖啡，场景干净明亮，构图预留标题和卖点空间。",
    sections: [
      { label: "主体", value: "新品咖啡杯与精致拉花，作为视觉焦点" },
      { label: "场景", value: "明亮咖啡店吧台或木质桌面，背景整洁" },
      { label: "风格", value: "商业海报、清爽、适合社媒发布" },
      { label: "构图", value: "主体居中偏下，顶部预留标题区域" },
      { label: "负向提示词", value: "低清晰度、杂乱背景、文字变形、过曝、主体缺失" }
    ],
    preset: {
      modelId: "recommended-image",
      parameters: {
        aspectRatio: "4:3",
        quality: "high",
        count: 1
      },
      creditEstimate: { credits: 2, unit: "credit" }
    },
    createdAt: "2026-06-19T00:00:00.000Z"
  },
  video: {
    id: "fixture-video-optimization",
    mode: "video",
    originalPrompt: "生成一段咖啡拉花短视频",
    optimizedPrompt: "生成一段咖啡拉花短视频，展示牛奶注入、图案形成和成品呈现，镜头平滑推进。",
    sections: [
      { label: "主体", value: "咖啡师双手、咖啡杯与拉花图案" },
      { label: "动作", value: "牛奶缓慢注入，拉花图案自然形成" },
      { label: "镜头运动", value: "从杯口近景缓慢推进，最后轻微上移展示成品" },
      { label: "场景变化", value: "从拉花过程过渡到成品定格" },
      { label: "负向约束", value: "画面闪烁、主体变形、动作断裂、过度模糊、低清晰度" }
    ],
    preset: {
      modelId: "recommended-video",
      parameters: {
        durationSeconds: 6,
        aspectRatio: "16:9",
        resolution: "1080p"
      },
      creditEstimate: { credits: 3, unit: "credit" }
    },
    createdAt: "2026-06-19T00:00:00.000Z"
  }
};

export function getStudioModes(): StudioModeContent[] {
  return studioModes.map(cloneModeContent);
}

export function getStudioModeContent(mode: CreationMode): StudioModeContent {
  return cloneModeContent(studioModes.find((candidate) => candidate.mode === mode) ?? studioModes[0]);
}

export function getStudioTemplates(mode: CreationMode): PromptTemplate[] {
  return promptTemplates.filter((template) => template.mode === mode).map(cloneTemplate);
}

export function getFixtureOptimization(mode: CreationMode): PromptOptimization {
  return cloneOptimization(fixtureOptimizations[mode] ?? fixtureOptimizations.text);
}

function cloneModeContent(content: StudioModeContent): StudioModeContent {
  return { ...content };
}

function cloneTemplate(template: PromptTemplate): PromptTemplate {
  return {
    ...template,
    tags: [...template.tags]
  };
}

function cloneOptimization(optimization: PromptOptimization): PromptOptimization {
  return {
    ...optimization,
    sections: optimization.sections.map((section) => ({ ...section })),
    preset: {
      ...optimization.preset,
      parameters: { ...optimization.preset.parameters },
      creditEstimate: { ...optimization.preset.creditEstimate }
    }
  };
}
