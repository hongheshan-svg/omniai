import type { CreationMode } from "@gw-link-omniai/shared";

export interface IndustryTemplate {
  id: string;
  industry: string;
  title: string;
  prompt: string;
  mode: CreationMode;
}

const industryTemplates: IndustryTemplate[] = [
  {
    id: "ecommerce-product-shot",
    industry: "电商",
    title: "产品主图",
    mode: "image",
    prompt: "为一款陶瓷咖啡杯拍摄电商主图：纯色浅灰背景，柔和顶光，45 度俯拍，突出釉面质感，构图居中留白，适合电商平台展示。"
  },
  {
    id: "ecommerce-detail-copy",
    industry: "电商",
    title: "详情页卖点文案",
    mode: "text",
    prompt: "为一款便携式榨汁杯写电商详情页文案：提炼 3 个核心卖点，每个卖点一句主标题加两行说明，语气清新有活力，结尾附一句促购语。"
  },
  {
    id: "ad-summer-poster",
    industry: "广告",
    title: "品牌活动海报",
    mode: "image",
    prompt: "设计一张夏日冰咖啡促销海报：冷色调蓝绿背景，杯身结霜特写，冰块飞溅动感，顶部留出标题区域，整体风格清爽通透。"
  },
  {
    id: "ad-15s-spot",
    industry: "广告",
    title: "15 秒广告短片",
    mode: "video",
    prompt: "生成一段 15 秒运动鞋广告短片：清晨城市街道，跑者由远及近，特写鞋底缓震形变，镜头随步伐节奏切换，结尾定格产品侧面。"
  },
  {
    id: "arch-exterior-render",
    industry: "建筑",
    title: "建筑外观效果图",
    mode: "image",
    prompt: "渲染一栋滨水文化中心的外观效果图：流线型白色曲面屋顶，大面积玻璃幕墙，黄昏暖光，水面倒影，写实建筑摄影风格。"
  },
  {
    id: "arch-interior-walkthrough",
    industry: "建筑",
    title: "室内漫游镜头",
    mode: "video",
    prompt: "生成一段现代美术馆室内漫游视频：镜头缓慢推进穿过挑高中庭，自然天光从天窗洒下，白色墙面与木质地板，运镜平稳克制。"
  },
  {
    id: "game-character-art",
    industry: "游戏",
    title: "角色原画",
    mode: "image",
    prompt: "绘制一名东方玄幻风格的剑客角色原画：青灰长袍，腰间古剑，姿态沉静立于山崖，水墨质感笔触，背景大面积留白。"
  },
  {
    id: "game-scene-concept",
    industry: "游戏",
    title: "场景概念图",
    mode: "image",
    prompt: "绘制一张废弃太空站内部的游戏场景概念图：冷蓝应急灯光，漂浮杂物，远处舷窗外是星云，氛围紧张神秘，电影感构图。"
  },
  {
    id: "film-storyboard-script",
    industry: "影视",
    title: "分镜头脚本",
    mode: "text",
    prompt: "为一支 60 秒城市夜景短片写分镜头脚本：按镜号列出景别、运镜、画面内容和时长，共 8 个镜头，风格孤独而温柔。"
  },
  {
    id: "film-concept-clip",
    industry: "影视",
    title: "概念场景短片",
    mode: "video",
    prompt: "生成一段雨夜霓虹街道的电影概念短片：手持镜头缓慢横移，雨滴在镜头前虚化成光斑，行人撑伞剪影，赛博朋克色调。"
  },
  {
    id: "fashion-lookbook",
    industry: "时尚",
    title: "服装大片",
    mode: "image",
    prompt: "拍摄一组秋冬羊绒大衣时尚大片：模特站在清晨雾气弥漫的街头，驼色大衣配同色系围巾，胶片颗粒质感，低饱和色调。"
  },
  {
    id: "fashion-launch-copy",
    industry: "时尚",
    title: "新品发布文案",
    mode: "text",
    prompt: "为一个小众设计师品牌的秋冬新品系列写发布文案：主题围绕「城市漫游者」，一段品牌叙事加三句单品亮点，语气克制高级。"
  }
];

export function getIndustryTemplates(): IndustryTemplate[] {
  return industryTemplates.map((template) => ({ ...template }));
}

export function listIndustries(): string[] {
  return [...new Set(industryTemplates.map((template) => template.industry))];
}

export function templatesForIndustry(industry: string): IndustryTemplate[] {
  return industryTemplates
    .filter((template) => template.industry === industry)
    .map((template) => ({ ...template }));
}
