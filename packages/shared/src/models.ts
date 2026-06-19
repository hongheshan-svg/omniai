export type ModelCapability = "text" | "image" | "video";

export type CreationMode = "text" | "image" | "video";

export type ModelVisibility = "visible" | "hidden" | "maintenance";

export type PlanCode = "free" | "pro" | "studio";

export interface ProductModel {
  id: string;
  displayName: string;
  capability: ModelCapability;
  tags: string[];
  visibility: ModelVisibility;
  minimumPlan: PlanCode;
  creditUnitCost: number;
}

export interface PromptTemplate {
  id: string;
  mode: CreationMode;
  name: string;
  description: string;
  tags: string[];
}

export interface PromptOptimizationRequest {
  mode: CreationMode;
  prompt: string;
  templateId?: string;
}

export interface PromptSection {
  label: string;
  value: string;
}

export interface PresetSuggestion {
  modelId: string;
  parameters: Record<string, string | number | boolean>;
  creditEstimate: CreditAmount;
}

export interface PromptOptimization {
  id: string;
  mode: CreationMode;
  originalPrompt: string;
  optimizedPrompt: string;
  sections: PromptSection[];
  preset: PresetSuggestion;
  createdAt: string;
}

export type GenerationTaskStatus = "queued" | "running" | "succeeded" | "failed";

export interface GenerationTask {
  id: string;
  capability: ModelCapability;
  status: GenerationTaskStatus;
  modelId: string;
  createdAt: string;
  updatedAt: string;
  creditEstimate: CreditAmount;
}

export interface CreditAmount {
  credits: number;
  unit: "credit";
}
