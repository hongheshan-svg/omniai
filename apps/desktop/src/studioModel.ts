import type { CreationMode, PromptTemplate } from "@gw-link-omniai/shared";

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

export function getStudioModes(): StudioModeContent[] {
  return studioModes.map(cloneModeContent);
}

export function getStudioModeContent(mode: CreationMode): StudioModeContent {
  return cloneModeContent(studioModes.find((candidate) => candidate.mode === mode) ?? studioModes[0]);
}

export function getStudioTemplates(mode: CreationMode): PromptTemplate[] {
  return promptTemplates.filter((template) => template.mode === mode).map(cloneTemplate);
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
