import type {
  CreationMode,
  PromptOptimization,
  PromptOptimizationRequest,
  PromptSection,
  PromptTemplate
} from "@gw-link-omniai/shared";

export class PromptOptimizationError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = "PromptOptimizationError";
  }
}

export interface PromptOptimizerClock {
  now(): Date;
}

export interface PromptOptimizerOptions {
  clock?: PromptOptimizerClock;
  idGenerator?: () => string;
}

export interface PromptOptimizer {
  listTemplates(mode?: CreationMode): PromptTemplate[];
  optimizePrompt(request: PromptOptimizationRequest): PromptOptimization;
}

const promptTemplates: PromptTemplate[] = [
  {
    id: "text-copywriting",
    mode: "text",
    name: "文案创作",
    description: "把一句需求扩展为可发布的文本 brief",
    tags: ["copywriting", "brief"]
  },
  {
    id: "text-social-title",
    mode: "text",
    name: "社媒标题",
    description: "生成适合社媒传播的标题方向",
    tags: ["social", "title"]
  },
  {
    id: "image-poster",
    mode: "image",
    name: "商业海报",
    description: "生成包含主体、场景、风格和负向词的图片提示词",
    tags: ["poster", "visual"]
  },
  {
    id: "video-short",
    mode: "video",
    name: "短视频镜头",
    description: "生成包含动作、镜头和时长的短视频提示词",
    tags: ["short-video", "motion"]
  }
];

export class LocalPromptOptimizer implements PromptOptimizer {
  private readonly clock: PromptOptimizerClock;
  private readonly idGenerator: () => string;

  constructor(options: PromptOptimizerOptions = {}) {
    this.clock = options.clock ?? { now: () => new Date() };
    this.idGenerator = options.idGenerator ?? createPromptOptimizationId;
  }

  listTemplates(mode?: CreationMode): PromptTemplate[] {
    if (mode !== undefined && !isCreationMode(mode)) {
      throw new PromptOptimizationError("Unsupported creation mode", 400);
    }

    return promptTemplates.filter((template) => !mode || template.mode === mode).map(cloneTemplate);
  }

  optimizePrompt(request: PromptOptimizationRequest): PromptOptimization {
    if (!isCreationMode(request.mode)) {
      throw new PromptOptimizationError("Unsupported creation mode", 400);
    }

    const prompt = request.prompt.trim();
    if (!prompt) {
      throw new PromptOptimizationError("Prompt is required", 400);
    }

    const template = this.resolveTemplate(request.mode, request.templateId);
    const strategy = modeStrategies[request.mode];

    return {
      id: this.idGenerator(),
      mode: request.mode,
      originalPrompt: prompt,
      optimizedPrompt: strategy.optimizedPrompt(prompt),
      sections: strategy.sections(prompt),
      preset: {
        modelId: strategy.modelId,
        parameters: {
          template: template.id,
          ...strategy.parameters
        },
        creditEstimate: { ...strategy.creditEstimate }
      },
      createdAt: this.clock.now().toISOString()
    };
  }

  private resolveTemplate(mode: CreationMode, templateId: string | undefined): PromptTemplate {
    const template = promptTemplates.find((candidate) => candidate.id === (templateId ?? defaultTemplateByMode[mode]));

    if (!template || template.mode !== mode) {
      throw new PromptOptimizationError("Prompt template was not found", 404);
    }

    return template;
  }
}

interface ModeStrategy {
  modelId: string;
  parameters: Record<string, string | number | boolean>;
  creditEstimate: { credits: number; unit: "credit" };
  optimizedPrompt(prompt: string): string;
  sections(prompt: string): PromptSection[];
}

const defaultTemplateByMode: Record<CreationMode, string> = {
  text: "text-copywriting",
  image: "image-poster",
  video: "video-short"
};

const modeStrategies: Record<CreationMode, ModeStrategy> = {
  text: {
    modelId: "recommended-text",
    parameters: {
      outputFormat: "markdown",
      tone: "clear"
    },
    creditEstimate: { credits: 1, unit: "credit" },
    optimizedPrompt: (prompt) =>
      `请围绕“${prompt}”生成清晰、可直接使用的文本内容，明确目标、受众、语气、格式和约束。`,
    sections: (prompt) => [
      { label: "写作目标", value: "围绕用户需求完成可发布的文本创作" },
      { label: "目标受众", value: "个人创作者、运营人员或内容生产者" },
      { label: "语气风格", value: "清晰、具体、可执行，避免空泛表达" },
      { label: "输出格式", value: "使用分段结构，必要时包含标题、要点和行动引导" },
      { label: "关键约束", value: `保留用户原始意图：${prompt}` }
    ]
  },
  image: {
    modelId: "recommended-image",
    parameters: {
      aspectRatio: "4:3",
      quality: "high",
      count: 1
    },
    creditEstimate: { credits: 2, unit: "credit" },
    optimizedPrompt: (prompt) => `为“${prompt}”制作一张商业级视觉图，突出主体、场景氛围、构图和清晰传播信息。`,
    sections: (prompt) => [
      { label: "主体", value: `${prompt} 的核心主体与视觉焦点` },
      { label: "场景", value: "干净、有生活感、符合商业传播的真实场景" },
      { label: "风格", value: "精致、清晰、适合社媒和营销物料使用" },
      { label: "构图", value: "主体明确，保留标题、卖点或品牌信息空间" },
      { label: "光照和色彩", value: "自然光或柔和棚拍光，色彩统一且不过度饱和" },
      { label: "负向提示词", value: "低清晰度、杂乱背景、文字变形、过曝、主体缺失" }
    ]
  },
  video: {
    modelId: "recommended-video",
    parameters: {
      durationSeconds: 6,
      aspectRatio: "16:9",
      resolution: "1080p"
    },
    creditEstimate: { credits: 3, unit: "credit" },
    optimizedPrompt: (prompt) => `围绕“${prompt}”生成一段短视频，明确主体、动作、镜头运动、场景变化和负向约束。`,
    sections: (prompt) => [
      { label: "主体", value: `${prompt} 的主要人物、物体或视觉中心` },
      { label: "动作", value: "动作连续、节奏明确，适合短视频观看" },
      { label: "镜头运动", value: "缓慢推进或平滑横移，避免剧烈抖动" },
      { label: "场景变化", value: "场景保持连贯，突出开始、过程和结束状态" },
      { label: "时长和比例", value: "约 6 秒，16:9 横版，1080p 输出" },
      { label: "负向约束", value: "画面闪烁、主体变形、动作断裂、过度模糊、低清晰度" }
    ]
  }
};

function isCreationMode(value: unknown): value is CreationMode {
  return value === "text" || value === "image" || value === "video";
}

function cloneTemplate(template: PromptTemplate): PromptTemplate {
  return {
    ...template,
    tags: [...template.tags]
  };
}

function createPromptOptimizationId(): string {
  return `prompt_opt_${Date.now().toString(36)}`;
}
