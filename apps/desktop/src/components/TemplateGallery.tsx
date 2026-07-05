import { listIndustries, templatesForIndustry, type IndustryTemplate } from "../templatesModel";

export interface TemplateGalleryProps {
  onApply(template: IndustryTemplate): void;
}

const modeLabels: Record<IndustryTemplate["mode"], string> = {
  text: "文本",
  image: "图片",
  video: "视频"
};

export function TemplateGallery({ onApply }: TemplateGalleryProps) {
  return (
    <div aria-label="灵感模板" role="region">
      <div className="canvas-empty" style={{ flex: "0 0 auto", paddingBottom: 18 }}>
        <h2>从一个行业场景开始</h2>
        <p>挑一个模板，提示词会自动填入下方输入框。</p>
      </div>
      {listIndustries().map((industry) => (
        <div key={industry} className="template-industry">
          <h3>{industry}</h3>
          <div className="template-grid">
            {templatesForIndustry(industry).map((template) => (
              <button
                key={template.id}
                type="button"
                className="template-card"
                aria-label={template.title}
                onClick={() => onApply(template)}
              >
                <h4>{template.title}</h4>
                <p aria-hidden="true">
                  {modeLabels[template.mode]} · {template.prompt.slice(0, 42)}…
                </p>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
