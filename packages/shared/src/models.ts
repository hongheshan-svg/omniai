export type ModelCapability = "text" | "image" | "video";

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
