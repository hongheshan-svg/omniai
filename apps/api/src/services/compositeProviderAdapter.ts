import {
  ProviderAdapterError,
  type ProviderAdapter,
  type ProviderGenerationRequest,
  type ProviderGenerationResult,
  type ProviderPollRequest
} from "./gatewayClient";

export interface CompositeProviders {
  text: ProviderAdapter;
  image: ProviderAdapter;
  video: ProviderAdapter;
}

export class CompositeProviderAdapter implements ProviderAdapter {
  constructor(private readonly providers: CompositeProviders) {}

  submitGeneration(request: ProviderGenerationRequest): Promise<ProviderGenerationResult> {
    return this.providerFor(request.mode).submitGeneration(request);
  }

  pollGeneration(request: ProviderPollRequest): Promise<ProviderGenerationResult> {
    const provider = this.providerFor(request.mode);
    if (!provider.pollGeneration) {
      throw new ProviderAdapterError("Provider does not support polling", 502);
    }
    return provider.pollGeneration(request);
  }

  private providerFor(mode: ProviderGenerationRequest["mode"]): ProviderAdapter {
    if (mode === "image") {
      return this.providers.image;
    }
    if (mode === "video") {
      return this.providers.video;
    }
    return this.providers.text;
  }
}
