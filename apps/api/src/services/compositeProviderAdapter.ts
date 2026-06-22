import type { ProviderAdapter, ProviderGenerationRequest, ProviderGenerationResult } from "./gatewayClient";

export interface CompositeProviders {
  text: ProviderAdapter;
  image: ProviderAdapter;
}

export class CompositeProviderAdapter implements ProviderAdapter {
  constructor(private readonly providers: CompositeProviders) {}

  submitGeneration(request: ProviderGenerationRequest): Promise<ProviderGenerationResult> {
    const provider = request.mode === "image" ? this.providers.image : this.providers.text;
    return provider.submitGeneration(request);
  }
}
